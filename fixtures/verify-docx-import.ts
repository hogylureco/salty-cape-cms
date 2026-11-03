// Imports fixtures/test-spot.docx through the Word doc importer's real write path, twice, and
// prints what was written. Run with:
//   npx sanity exec fixtures/verify-docx-import.ts --with-user-token
//   npx sanity exec fixtures/verify-docx-import.ts --with-user-token -- --cleanup   (deletes the test draft)
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import {createSchema} from 'sanity'
import {getCliClient} from 'sanity/cli'
import {richTablePlugin} from 'sanity-plugin-rich-table'
import {schemaTypes} from '../schemaTypes'
import {API_VERSION, mintDocId} from '../tools/shared/importDocuments.ts'
import {parseDocx} from '../tools/docxImport/parseDocx.ts'
import {buildFieldMap, NARRATIVE_FIELDS, splitSections} from '../tools/docxImport/splitSections.ts'
import {convertField, convertTypesFor} from '../tools/docxImport/htmlToPortableText.ts'
import {validateBlocks} from '../tools/docxImport/validate.ts'
import {toRecord} from '../tools/docxImport/records.ts'
import {importSpots} from '../tools/docxImport/importSpots.ts'

const client = getCliClient({apiVersion: API_VERSION})
const drafts = client.withConfig({perspective: 'drafts'})
const parseHtml = (h: string) => new JSDOM(h).window.document
const schema = createSchema({name: 'default', types: [...(richTablePlugin({}) as any).schema.types, ...schemaTypes]})
const COUNTS = NARRATIVE_FIELDS.map((f) => `"${f}": count(${f})`).join(', ')
const show = (label: string, value: unknown) => console.log(`\n--- ${label}\n${JSON.stringify(value, null, 2)}`)

async function convertFixture(extraNote?: string) {
  const buf = await readFile(new URL('./test-spot.docx', import.meta.url))
  const {html} = await parseDocx(new Blob([buf]))
  const [doc] = splitSections(html, buildFieldMap(), parseHtml(html))
  if (extraNote) doc.sections.captMikeNotes += `<p>${extraNote}</p>`
  const fields: Record<string, any[]> = {}
  for (const [f, fhtml] of Object.entries(doc.sections)) {
    fields[f] = convertField(fhtml, convertTypesFor(schema, 'spot', f)!, console.warn, parseHtml)
    const v = validateBlocks(f, fields[f])
    if (v.errors.length) throw new Error(v.errors.join('\n'))
  }
  const meta = {name: 'Docx Import Fixture', slug: 'zz-docx-import-fixture', spotType: 'fs-featured-spot', version: 'v3.1'}
  return toRecord(doc.id, meta, fields, true)
}

async function run() {
  const record = await convertFixture()
  const id = record.match
  if (process.argv.includes('--cleanup')) {
    const docs = await client.withConfig({perspective: 'raw'}).fetch(`*[_type == "spot" && id == $id]{_id, "assets": captMikeNotes[_type == "image"].asset._ref}`, {id})
    const tx = client.transaction()
    for (const d of docs) tx.delete(d._id)
    await tx.commit()
    for (const a of [...new Set(docs.flatMap((d: any) => d.assets ?? []))] as string[]) {
      await client.delete(a).catch((e) => console.warn(`asset ${a} kept: ${e.message}`))
    }
    console.log(`Deleted ${docs.map((d: any) => d._id).join(', ') || 'nothing'}`)
    return
  }
  const docType = schema.get('spot')
  const query = `*[_type == "spot" && id == $id]{_id, id, name, "slug": slug.current, spotType, version, ${COUNTS}}`

  show('before', await drafts.fetch(query, {id}))
  const first = await importSpots(client, {docType, type: 'spot', records: [record], onStatus: console.log})
  show('first import', {decision: first.decisions[0], done: first.done, made: first.made})
  const afterFirst = await drafts.fetch(query, {id})
  show(`after first import (perspective: drafts)`, afterFirst)

  const changed = await convertFixture('Re-import check: this paragraph was added.')
  const second = await importSpots(client, {docType, type: 'spot', records: [changed], onStatus: console.log})
  show('second import', {decision: second.decisions[0], done: second.done, made: second.made})
  const afterSecond = await drafts.fetch(query, {id})
  show('after second import (perspective: drafts)', afterSecond)
  show('count(*[_type=="spot" && id==$id]) (raw: drafts + published)', await client.withConfig({perspective: 'raw'}).fetch(`count(*[_type == "spot" && id == $id])`, {id}))
  show('_id before / after re-import', {before: afterFirst[0]?._id, after: afterSecond[0]?._id, expected: `drafts.${mintDocId(id)}`})
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

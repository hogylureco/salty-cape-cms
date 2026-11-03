// Run with: npm run test:docx-import
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {JSDOM} from 'jsdom'
import {createSchema} from 'sanity'
import {richTablePlugin} from 'sanity-plugin-rich-table'
import {parseDocx} from './parseDocx.ts'
import {buildFieldMap, fkey, NARRATIVE_FIELDS, parseHeadingId, splitSections} from './splitSections.ts'
import {convertField, convertTypesFor} from './htmlToPortableText.ts'
import {validateBlocks} from './validate.ts'
import {defaultSlug, slugify, spotTypeFromId, toRecord} from './records.ts'

const parseHtml = (h: string) => new JSDOM(h).window.document

// The spot narrative fields exactly as schemaTypes/spotType.ts declares them, plus the plugin's types.
const narrative = (name: string) => ({
  name,
  type: 'array',
  of: [{type: 'block'}, {type: 'image', options: {hotspot: true}}, {type: 'richTableBlock'}],
})
const pluginTypes = (richTablePlugin({}) as any).schema.types
const schema = createSchema({
  name: 'test',
  types: [...pluginTypes, {name: 'spot', type: 'document', fields: [{name: 'id', type: 'string'}, ...NARRATIVE_FIELDS.map(narrative)]}],
})

async function parseFixture() {
  const buf = await readFile(new URL('../../fixtures/test-spot.docx', import.meta.url))
  const {html, messages} = await parseDocx(new Blob([buf]))
  const docs = splitSections(html, buildFieldMap(), parseHtml(html))
  const warnings: string[] = []
  const fields: Record<string, any[]> = {}
  for (const [field, fhtml] of Object.entries(docs[0].sections)) {
    fields[field] = convertField(fhtml, convertTypesFor(schema, 'spot', field)!, (m) => warnings.push(m), parseHtml)
  }
  return {html, messages, docs, fields, warnings}
}

test('fkey strips punctuation and does not NFKC-normalise', () => {
  assert.equal(fkey('Gear and Technique™'), 'gearandtechnique')
  assert.equal(fkey("Capt. Mike's Notes"), 'captmikesnotes')
  assert.equal(buildFieldMap().get(fkey('Step 4 – Structure & Approach')), 'structureApproach')
  assert.equal(buildFieldMap({QAcaptMike: 'Q&A with Capt Mike'}).get(fkey('Q & A with Capt. Mike')), 'QAcaptMike')
})

test('heading id parsing', () => {
  assert.deepEqual(parseHeadingId('BB.WE.fs – West End of the Canal'), {
    id: 'BB.WE.fs - West End of the Canal',
    code: 'BB.WE.fs',
    label: 'West End of the Canal',
  })
  assert.equal(parseHeadingId('West End of the Canal'), null)
  assert.equal(spotTypeFromId('NS.TS.fx.M.C1 - Blind Cast'), 'fx-spot-playbook-approach')
  assert.equal(spotTypeFromId('ZZ - nothing'), '')
  assert.equal(slugify("Tom's Shoal: Blind & Long"), 'tom-s-shoal-blind-and-long')
  assert.equal(defaultSlug('CCB.BF.fs - Brewster Flats', 'Brewster Flats', new Map([['CCB', 'cape-cod-bay']])), 'cape-cod-bay-brewster-flats')
})

test('several H1s become several spots; content before a field heading is kept', () => {
  const html = '<p>stray</p><h1>AA.B.fs - One</h1><h2>Capt Mikes Notes</h2><p>x</p><h1>Not coded</h1><p>early</p><h2>Gear &amp; Technique</h2><p>y</p>'
  const docs = splitSections(html, buildFieldMap(), parseHtml(html))
  assert.equal(docs.length, 3)
  assert.equal(docs[0].title, '')
  assert.equal(docs[0].unmatched[0].html, '<p>stray</p>')
  assert.equal(docs[1].id, 'AA.B.fs - One')
  assert.deepEqual(Object.keys(docs[1].sections), ['captMikeNotes'])
  assert.equal(docs[2].id, '')
  assert.equal(docs[2].unmatched[0].heading, '(before the first section heading)')
  assert.equal(docs[2].sections.gearTechnique, '<p>y</p>')
})

test('fixture: all seven fields matched, one unmatched heading', async () => {
  const {docs, messages} = await parseFixture()
  assert.equal(docs.length, 1)
  assert.equal(docs[0].id, 'ZZ.TEST.fs - Docx Import Fixture')
  assert.deepEqual(Object.keys(docs[0].sections).sort(), [...NARRATIVE_FIELDS].sort())
  assert.deepEqual(docs[0].unmatched.map((u) => u.heading), ['Tide Notes'])
  assert.deepEqual(messages, [])
})

test('fixture: tables become richTableBlocks with the right header handling', async () => {
  const {fields} = await parseFixture()
  const grid = fields.historicalAnalysis.find((b) => b._type === 'richTableBlock')
  const kv = fields.environmentalFactors.find((b) => b._type === 'richTableBlock')
  assert.equal(grid.hasColumnTitles, true)
  assert.equal(grid.hasRowTitles, false)
  assert.deepEqual(grid.columnHeaders.map((h: any) => [h.title, h.cellIndex]), [['Month', 0], ['Species', 1], ['Size', 2]])
  assert.equal(grid.rows.length, 2)
  assert.equal(kv.hasColumnTitles, false)
  assert.deepEqual(kv.columnHeaders.map((h: any) => h.cellIndex), [0, 1])
  assert.equal(kv.rows.length, 3) // the would-be header row is data row 0
  assert.deepEqual(kv.rows[0].cells[0].content[0].children[0].marks, ['strong'])
  for (const t of [grid, kv]) for (const r of t.rows) assert.equal(r.cells.length, t.columnHeaders.length)
})

test('fixture: marks, lists and the embedded image', async () => {
  const {fields} = await parseFixture()
  const notes = fields.captMikeNotes
  assert.deepEqual(notes[0].children.map((s: any) => s.marks), [[], ['strong'], [], ['em'], []])
  assert.deepEqual(notes.filter((b) => b.listItem).map((b) => b.listItem), ['bullet', 'bullet'])
  assert.ok(notes.some((b) => b._type === 'image' && String(b._pendingUpload).startsWith('data:image/png;base64,')))
  assert.deepEqual(fields.observationalFactors.filter((b) => b.listItem).map((b) => b.listItem), ['number', 'number'])
})

test('fixture validates clean; corrupted copies are caught', async () => {
  const {fields} = await parseFixture()
  for (const [f, blocks] of Object.entries(fields)) assert.deepEqual(validateBlocks(f, blocks), {errors: [], warnings: []}, f)

  const bad = structuredClone(fields.historicalAnalysis)
  const table = bad.find((b: any) => b._type === 'richTableBlock')
  table.rows[1]._key = table.rows[0]._key // duplicate _key
  table.columnHeaders[2].cellIndex = 3 // skipped cellIndex
  table.rows[0].cells.pop() // ragged row
  bad[0].children[0].marks = ['nope'] // dangling mark
  bad[0].children[0].text = '**bold** in markdown'
  const {errors, warnings} = validateBlocks('historicalAnalysis', bad)
  assert.equal(errors.length, 4, errors.join('\n'))
  assert.match(errors.join('\n'), /duplicate _key/)
  assert.match(errors.join('\n'), /cellIndex is 3, expected 2/)
  assert.match(errors.join('\n'), /not rectangular/)
  assert.match(errors.join('\n'), /mark "nope"/)
  assert.equal(warnings.length, 1)
})

test('records: metadata only for new spots', () => {
  const meta = {name: 'N', slug: 'n', spotType: 'fs-featured-spot', version: 'v3.1'}
  assert.deepEqual(Object.keys(toRecord('A.B.fs - N', meta, {captMikeNotes: []}, true).fields), [
    'name',
    'slug',
    'spotType',
    'version',
    'captMikeNotes',
  ])
  assert.deepEqual(Object.keys(toRecord('A.B.fs - N', meta, {captMikeNotes: []}, false).fields), ['captMikeNotes'])
})

if (process.env.DUMP_TABLES) {
  test('dump', async () => {
    const {fields} = await parseFixture()
    const tables = [fields.historicalAnalysis, fields.environmentalFactors].map((f) => f.find((b) => b._type === 'richTableBlock'))
    console.log(JSON.stringify(tables, null, 2))
  })
}

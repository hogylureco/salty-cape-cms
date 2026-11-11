// Run with: npm run test:html-import
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {JSDOM} from 'jsdom'
import {createSchema} from 'sanity'
import {richTablePlugin} from 'sanity-plugin-rich-table'
import {buildFieldMap, NARRATIVE_FIELDS} from '../docxImport/splitSections.ts'
import {buildLabelMap} from '../docxImport/fieldTable.ts'
import {convertField, convertTypesFor} from '../docxImport/htmlToPortableText.ts'
import {validateBlocks} from '../docxImport/validate.ts'
import {parseHtmlDoc, HTML_JSON_FORMAT} from './parseHtml.ts'
import {mapHtmlDoc, normaliseRows} from './mapHtmlDoc.ts'

const parse = (h: string) => new JSDOM(h).window.document

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

async function fixture() {
  const html = await readFile(new URL('../../fixtures/west-end-of-the-canal.html', import.meta.url), 'utf8')
  const json = parseHtmlDoc(html, 'west-end-of-the-canal.html', parse)
  return {json, doc: mapHtmlDoc(json, buildFieldMap())}
}

test('step 1: HTML -> JSON keeps head metadata, the field table and every H2 section', async () => {
  const {json} = await fixture()
  assert.equal(json.format, HTML_JSON_FORMAT)
  assert.equal(json.title, 'West End of the Canal')
  assert.equal(json.meta['sc-id'], 'BB.WE.fs - West End of the Canal')
  assert.equal(json.meta['sc-version'], 'v19')
  assert.equal(json.fieldTable?.heading, 'Meta Block')
  assert.deepEqual(
    json.fieldTable?.rows.map((r) => r.label),
    ['Spot ID', 'Region', 'Lat/Long (centroid)', 'Platform', 'Structure Types', 'Depth Range', 'Target Species', 'Micro Seasons', 'Hazards'],
  )
  assert.equal(json.sections.length, 7)
  assert.equal(json.preamble, '')
  // the field table and its "Meta Block" caption are taken out of the narrative
  assert.ok(!json.sections[0].html.includes('Meta Block'))
  assert.ok(!json.sections[0].html.includes('Lat/Long (centroid)'))
  assert.ok(json.sections[0].html.includes('Nearby Spots'))
  assert.ok(json.sections[1].outline.some((o) => o.level === 4 && o.heading === 'May'))
  // the JSON is plain data
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json)
})

test('step 2: JSON -> spot: id, field rows and all seven narrative fields', async () => {
  const {doc} = await fixture()
  assert.equal(doc.id, 'BB.WE.fs - West End of the Canal')
  assert.equal(doc.title, 'West End of the Canal')
  assert.deepEqual(Object.keys(doc.sections).sort(), [...NARRATIVE_FIELDS].sort())
  assert.deepEqual(doc.unmatched, [])
  const rows = Object.fromEntries(doc.meta.map((r) => [r.label, r.text]))
  assert.equal(rows.Version, 'v19')
  assert.equal(rows.Latitude, '41.7285')
  assert.equal(rows.Longitude, '-70.6369')
  assert.ok(rows.Structure.startsWith('S103 - Open Water'))
  assert.ok(!('Spot ID' in rows) && !('ID' in rows))

  // every row lands on a real spot field name/title
  const labelMap = buildLabelMap([
    {name: 'version', title: 'Version'},
    {name: 'region', title: 'Region'},
    {name: 'latitude', title: 'Latitude'},
    {name: 'longitude', title: 'Longitude'},
    {name: 'platform', title: 'Platform'},
    {name: 'structure', title: 'Structure'},
    {name: 'depthRange', title: 'Depth Range (deprecated)'},
    {name: 'targetSpecies', title: 'Target Species'},
    {name: 'microSeason', title: 'Micro Season'},
    {name: 'hazards', title: 'Hazards (deprecated)'},
  ])
  const unmapped = doc.meta.filter((r) => !labelMap.get(r.label.toLowerCase().replace(/[^a-z0-9]+/g, '')))
  assert.deepEqual(unmapped.map((r) => r.label), [])
})

test('step 2: sections convert to valid Portable Text with rich tables', async () => {
  const {doc} = await fixture()
  for (const [field, html] of Object.entries(doc.sections)) {
    const warnings: string[] = []
    const blocks = convertField(html, convertTypesFor(schema, 'spot', field)!, (m) => warnings.push(m), parse)
    assert.ok(blocks.length > 0, field)
    assert.deepEqual(warnings, [], field)
    const v = validateBlocks(field, blocks)
    assert.deepEqual(v.errors, [], field)
  }
  const notes = convertField(doc.sections.captMikeNotes, convertTypesFor(schema, 'spot', 'captMikeNotes')!, () => undefined, parse)
  const tables = notes.filter((b) => b._type === 'richTableBlock')
  assert.equal(tables.length, 2) // Nearby Spots, Boat Ramps — the Meta Block is not among them
  assert.deepEqual(tables[0].columnHeaders.map((h: any) => h.title), ['Spot', 'Lat/Long', 'Distance', 'Profile'])
})

test('lat/long rows split; unknown sections are kept as unmatched', () => {
  assert.deepEqual(
    normaliseRows([{num: '', label: 'Coordinates', required: false, text: '41.1, -70.2'}]).map((r) => [r.label, r.text]),
    [['Latitude', '41.1'], ['Longitude', '-70.2']],
  )
  const html =
    '<html><head><title>X</title><meta name="sc-id" content="AA.B.fs – Thing"></head><body><p>intro</p><h2>Tide Notes</h2><p>t</p><h2>Gear &amp; Technique</h2><p>g</p></body></html>'
  const doc = mapHtmlDoc(parseHtmlDoc(html, '', parse), buildFieldMap())
  assert.equal(doc.id, 'AA.B.fs - Thing')
  assert.deepEqual(doc.unmatched.map((u) => u.heading), ['(before the first section heading)', 'Tide Notes'])
  assert.equal(doc.sections.gearTechnique, '<p>g</p>')
  assert.deepEqual(doc.meta, [])
})

test('linked images become pending uploads, are downloaded and uploaded once each', async () => {
  const {PENDING_UPLOAD} = await import('../docxImport/htmlToPortableText.ts')
  const {uploadPendingImages} = await import('../docxImport/importSpots.ts')
  const url = 'https://ik.imagekit.io/hogylures/NOAA-Charts/BB.WE.5.NOAA.Chart.png'
  const html = `<p>Chart:</p><p><img src="${url}" alt="chart"></p><p><img src="${url}"></p><p><img src="/relative.png"></p><p><img src="https://x.test/missing.png"></p>`
  const warnings: string[] = []
  const blocks = convertField(html, convertTypesFor(schema, 'spot', 'captMikeNotes')!, (m) => warnings.push(m), parse)
  const pending = blocks.filter((b) => b[PENDING_UPLOAD])
  assert.deepEqual(pending.map((b) => b[PENDING_UPLOAD]), [url, url, 'https://x.test/missing.png'])
  assert.equal(warnings.length, 1) // only the relative one
  assert.match(warnings[0], /relative\.png/)

  const realFetch = globalThis.fetch
  const fetched: string[] = []
  globalThis.fetch = (async (u: string) => {
    fetched.push(u)
    if (u.includes('missing')) return new Response('nope', {status: 404})
    return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], {type: 'image/png'}))
  }) as any
  const uploads: string[] = []
  const client = {assets: {upload: async (_t: string, _b: Blob, o: any) => (uploads.push(o.filename), {_id: `image-${uploads.length}`})}}
  const item: any = {match: 'BB.WE.fs - West End of the Canal', fields: {captMikeNotes: blocks}}
  try {
    const problems = await uploadPendingImages(client as any, [item])
    assert.deepEqual(fetched, [url, 'https://x.test/missing.png'])
    assert.deepEqual(uploads, ['BB.WE.5.NOAA.Chart.png'])
    assert.equal(problems.length, 1)
    assert.match(problems[0], /missing\.png.*HTTP 404/)
    const images = item.fields.captMikeNotes.filter((b: any) => b._type === 'image')
    assert.equal(images.length, 2)
    assert.ok(images.every((b: any) => b.asset._ref === 'image-1' && !b[PENDING_UPLOAD]))
  } finally {
    globalThis.fetch = realFetch
  }
})

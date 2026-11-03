// Run with: npm run test:docx-import
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {JSDOM} from 'jsdom'
import {createSchema} from 'sanity'
import {richTablePlugin} from 'sanity-plugin-rich-table'
import {parseDocx} from './parseDocx.ts'
import {buildFieldMap, fkey, matchHeading, NARRATIVE_FIELDS, parseHeadingId, splitSections} from './splitSections.ts'
import {
  buildLabelMap,
  convertValue,
  fieldInfo,
  isPlaceholder,
  looseCode,
  resolveRef,
  splitList,
  withTypeSegment,
} from './fieldTable.ts'
import {buildRefIndex, readFieldSpecs} from '../shared/importDocuments.ts'
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

test('records: the chosen fields, then the narratives', () => {
  const rec = toRecord('A.B.fs - N', {name: 'N', latitude: 41.5}, {captMikeNotes: []})
  assert.equal(rec.match, 'A.B.fs - N')
  assert.deepEqual(Object.keys(rec.fields), ['name', 'latitude', 'captMikeNotes'])
})

/* ------------------------------------------------------------------ */
/* field table docs                                                    */
/* ------------------------------------------------------------------ */

// The layout of Mike's current spot docs: the field table first, section banners in one-cell
// tables, the H1 inside the first section.
const FIELD_TABLE_DOC = `
<table><thead><tr><th><p><strong>Field</strong></p></th><th><p><strong>Value (Ian Sanity schema)</strong></p></th></tr></thead><tbody>
<tr><td colspan="2"><p><em>— Identity —</em></p></td></tr>
<tr><td><p><strong>★ 1.  ID</strong></p></td><td><p>BB.WE.B.C1 - Chasing Spring Birds at the West End</p></td></tr>
<tr><td><p><strong>★ 2.  Version</strong></p></td><td><p>v2.3</p></td></tr>
<tr><td><p><strong>★ 3.  Name</strong></p></td><td><p><strong>Chasing Spring Birds</strong></p></td></tr>
<tr><td><p><strong>5.  Publish Date</strong></p></td><td><p>x</p></td></tr>
<tr><td><p><strong>★ 6.  Latitude</strong></p></td><td><p>41.7369</p></td></tr>
<tr><td><p><strong>12.  Post Type</strong></p></td><td><p>Approach</p></td></tr>
<tr><td><p><strong>13.  Platform</strong></p></td><td><p>Boat</p></td></tr>
<tr><td><p><strong>14.  Related Spots</strong></p></td><td><p>BB.WE.fs - West End of the Canal</p></td></tr>
<tr><td><p><strong>15a.  Boat Ramps</strong></p></td><td><p>BR.BB.MON.BR - Monument Beach Ramp</p></td></tr>
<tr><td><p><strong>34.  Approach Diagrams</strong></p></td><td><p>x  (auto-resolved from approaches refs)</p></td></tr>
</tbody></table>
<table><tr><td><h2>Capt. Mike's Notes</h2></td></tr></table>
<h1>Buzzards Bay: Chasing Spring Birds</h1>
<p>Classic Approach</p>
<table><tr><td><h2>Salty System Part 1: The Pattern Layer™ — Historical Analysis</h2></td></tr></table>
<p>Peak window.</p>
<table><tr><td><p><strong>Peak Window</strong></p></td><td><p>Late April</p></td></tr><tr><td><p><strong>Peak Tide</strong></p></td><td><p>Outgoing</p></td></tr></table>
<table><tr><td><h2>Salty System Part 4: Structure &amp; Approach</h2></td></tr></table>
<p>Boat handling.</p>
<table><tr><td><h2>Q&amp;A with Capt Mike</h2></td></tr></table>
<p>Q?</p>
<table><tr><td><h2>Asset Registry</h2></td></tr></table>
`

test('field table doc: one spot, its fields, and every section', () => {
  const docs = splitSections(FIELD_TABLE_DOC, buildFieldMap(), parseHtml(FIELD_TABLE_DOC))
  assert.equal(docs.length, 1)
  const d = docs[0]
  assert.equal(d.id, 'BB.WE.B.C1 - Chasing Spring Birds at the West End')
  assert.equal(d.title, 'Buzzards Bay: Chasing Spring Birds')
  assert.deepEqual(
    d.meta.map((m) => [m.num, m.label, m.required, m.text]),
    [
      ['2', 'Version', true, 'v2.3'],
      ['3', 'Name', true, 'Chasing Spring Birds'],
      ['5', 'Publish Date', false, ''],
      ['6', 'Latitude', true, '41.7369'],
      ['12', 'Post Type', false, 'Approach'],
      ['13', 'Platform', false, 'Boat'],
      ['14', 'Related Spots', false, 'BB.WE.fs - West End of the Canal'],
      ['15a', 'Boat Ramps', false, 'BR.BB.MON.BR - Monument Beach Ramp'],
      ['34', 'Approach Diagrams', false, ''],
    ],
  )
  assert.deepEqual(Object.keys(d.sections), ['captMikeNotes', 'historicalAnalysis', 'structureApproach', 'QAcaptMike'])
  // the H1 inside Capt Mike's Notes stays in its text; the key/value table stays a table
  assert.match(d.sections.captMikeNotes, /^<h1>Buzzards Bay: Chasing Spring Birds<\/h1><p>Classic Approach<\/p>$/)
  assert.match(d.sections.historicalAnalysis, /<table>/)
  assert.deepEqual(d.unmatched, [{heading: 'Asset Registry', html: ''}])
})

test('field table doc: two field tables are two spots', () => {
  const two = FIELD_TABLE_DOC + FIELD_TABLE_DOC.replace('BB.WE.B.C1', 'BB.WE.B.C2')
  const docs = splitSections(two, buildFieldMap(), parseHtml(two))
  assert.deepEqual(docs.map((d) => d.id.split(' ')[0]), ['BB.WE.B.C1', 'BB.WE.B.C2'])
})

test('section headings match by their known ending', () => {
  const map = buildFieldMap()
  assert.equal(matchHeading('Salty System Part 2: The Conditions Layer™ — Environmental Factors', map), 'environmentalFactors')
  assert.equal(matchHeading('Salty System Part 5: Gear & Technique', map), 'gearTechnique')
  assert.equal(matchHeading('Q&A with Capt Mike', map), 'QAcaptMike')
  assert.equal(matchHeading('Quick Reference', map), undefined) // "qa" only matches exactly
  assert.equal(matchHeading('Asset Registry', map), undefined)
})

test('field table values: placeholders, lists, labels', () => {
  assert.ok(isPlaceholder('x'))
  assert.ok(isPlaceholder('x  (auto-resolved from approaches refs)'))
  assert.ok(!isPlaceholder('xenon'))
  assert.deepEqual(splitList('A - a; B - b'), ['A - a', 'B - b'])
  assert.deepEqual(splitList('BB.CL.fs - Cleveland Ledge, Bird Island (BB.MM.fs - Marion, Mattapoisett), Onset Bay'), [
    'BB.CL.fs - Cleveland Ledge',
    'Bird Island (BB.MM.fs - Marion, Mattapoisett)',
    'Onset Bay',
  ])
  const labels = buildLabelMap([
    {name: 'microSeason', title: 'Micro Season'},
    {name: 'microSeasons', title: 'Micro Seasons (deprecated)'},
    {name: 'spotType', title: 'Spot Type'},
    {name: 'postType', title: 'Post Type'},
    {name: 'lureCatalog', title: 'Lure Catalog Field'},
  ])
  assert.equal(labels.get(fkey('Micro Season')), 'microSeason')
  assert.equal(labels.get(fkey('Post Type')), 'spotType')
  assert.equal(labels.get(fkey('Lure Catalog Field')), 'lureCatalog')
  assert.equal(labels.get(fkey('Related Spots')), undefined)
})

test('spot ids: the type segment', () => {
  assert.equal(looseCode('BB.WE.fx.B.C1 - Chasing Spring Birds'), looseCode('BB.WE.B.C1 - Chasing Spring Birds at the West End'))
  assert.equal(withTypeSegment('BB.WE.B.C1 - Chasing', 'fx'), 'BB.WE.fx.B.C1 - Chasing')
  assert.equal(withTypeSegment('BB.WE.fs - West End', 'fx'), 'BB.WE.fs - West End')
})

const REF_DOCS = [
  {_id: 'ms-bb', _type: 'microSeason', id: '703.BB.ms - Large River System Stripers: Buzzards Bay'},
  {_id: 'ms-ccb', _type: 'microSeason', id: '703.CCB.ms - Large River System Stripers: Cape Cod Bay'},
  {_id: 'ms705', _type: 'microSeason', id: '705.ms - Early Season Pogy Bass'},
  {_id: 'ms705-bb', _type: 'microSeason', id: '705.BB.ms - Early Season Pogy Bass: Buzzards Bay'},
  {_id: 'ramp', _type: 'spot', id: 'BB.MB.br - Monument Beach Ramp', name: 'Monument Beach Ramp'},
  {_id: 'mm', _type: 'spot', id: 'BB.MM.fs - Marion Mattapoisett Western Shore', name: 'Marion & Mattapoisett'},
  {_id: 'we', _type: 'spot', id: 'BB.WE.fs - West End of the Canal'},
  {_id: 'vid', _type: 'video', id: 'ScYuvRO9sig', name: 'Casting Protail Paddles'},
  {_id: 'stb', _type: 'targetSpecies', id: 'STB - Striped Bass'},
  {_id: 'lc1', _type: 'lureCatalog', id: 'EPOIL - Hogy In-Line Epoxy Jig (7/8oz, Olive)'},
  {_id: 'lc2', _type: 'lureCatalog', id: 'EPOIL - Hogy In-Line Epoxy Jig (7/8oz, Albie Crack)'},
  {_id: 'spring', _type: 'season', id: 'Spring', name: 'Spring'},
]

test('references resolve the way the doc writes them', () => {
  const index = buildRefIndex(REF_DOCS)
  const hit = (tok: string, to: string, region = 'BB') => resolveRef(tok, [to], index, region).target?.baseId
  assert.equal(hit('STB - Striped Bass', 'targetSpecies'), 'stb')
  assert.equal(hit('ScYuvRO9sig - 2024 Salty Cape TV: Early Season Striped Bass | Hogy Protail', 'video'), 'vid')
  assert.equal(hit('703 - Large River System Stripers', 'microSeason'), 'ms-bb')
  assert.equal(hit('703 - Large River System Stripers', 'microSeason', 'CCB'), 'ms-ccb')
  assert.equal(hit('705 - Early Season Pogy Bass', 'microSeason'), 'ms705-bb') // the region's own beats the generic
  assert.equal(hit('705 - Early Season Pogy Bass', 'microSeason', 'NI'), 'ms705')
  assert.equal(hit('BR.BB.MON.BR - Monument Beach Ramp', 'spot'), 'ramp')
  assert.equal(hit('Bird Island (BB.MM.fs - Marion Mattapoisett Western Shore)', 'spot'), 'mm')
  assert.equal(hit('Spring', 'season'), 'spring')
  assert.equal(hit('Onset Bay', 'spot'), undefined)
  const lure = resolveRef('EPOIL - Hogy In-Line Epoxy Jig', ['lureCatalog'], index, 'BB')
  assert.equal(lure.target, undefined)
  assert.deepEqual(lure.candidates.map((c) => c.baseId).sort(), ['lc1', 'lc2'])
})

test('convertValue writes what each field type stores', () => {
  const spotSchema = createSchema({
    name: 'conv',
    types: [
      {name: 'video', type: 'document', fields: [{name: 'id', type: 'string'}]},
      {name: 'lureCatalog', type: 'document', fields: [{name: 'id', type: 'string'}]},
      {
        name: 'spot',
        type: 'document',
        fields: [
          {name: 'latitude', type: 'number'},
          {name: 'publishDate', type: 'datetime'},
          {name: 'slug', type: 'slug'},
          {name: 'platform', type: 'array', of: [{type: 'string'}], options: {list: [{title: 'Boat', value: 'boat'}, {title: 'Shore', value: 'shore'}]}},
          {
            name: 'spotType',
            type: 'string',
            options: {list: [{title: 'FS - Featured Spot', value: 'fs-featured-spot'}, {title: 'FX - Spot Playbook Approach', value: 'fx-spot-playbook-approach'}]},
          },
          {name: 'relatedVideos', type: 'array', of: [{type: 'reference', to: [{type: 'video'}]}]},
          {name: 'lureCatalog', type: 'array', of: [{type: 'reference', to: [{type: 'lureCatalog'}]}]},
        ],
      },
    ],
  })
  const t = spotSchema.get('spot')
  const specs = readFieldSpecs(t)
  const info = (n: string) => fieldInfo(t.fields.find((f: any) => f.name === n), specs[n])
  const index = buildRefIndex(REF_DOCS)
  const conv = (n: string, text: string, picks?: Record<number, string>) => convertValue(text, info(n), {index, region: 'BB', picks})

  assert.equal(conv('latitude', '41.7369° N').value, 41.7369)
  assert.equal(conv('publishDate', '2026-05-01').value, '2026-05-01T00:00:00.000Z')
  assert.equal(conv('publishDate', '').value, undefined)
  assert.deepEqual(conv('slug', 'chasing-spring-birds').value, {_type: 'slug', current: 'chasing-spring-birds'})
  assert.deepEqual(conv('platform', 'Boat').value, ['boat'])
  assert.equal(conv('spotType', 'Approach').value, 'fx-spot-playbook-approach')
  assert.match(conv('spotType', 'Canoe').problems[0], /not one of/)

  const vids = conv('relatedVideos', 'ScYuvRO9sig - Early Season, nope123 - Missing')
  assert.deepEqual(vids.value.map((r: any) => r._ref), ['vid'])
  assert.ok(vids.value.every((r: any) => r._type === 'reference' && r._key))
  assert.match(vids.problems.join(), /nope123 - Missing.*left out/)

  const lures = conv('lureCatalog', 'EPOIL - Hogy In-Line Epoxy Jig')
  assert.equal(lures.value, undefined)
  assert.match(lures.problems[0], /matches 2/)
  assert.deepEqual(conv('lureCatalog', 'EPOIL - Hogy In-Line Epoxy Jig', {0: 'lc2'}).value.map((r: any) => r._ref), ['lc2'])
})

// Mike's real doc, when it is in the working copy (mds/ is not committed).
const REAL_DOC = new URL('../../mds/BB_WE_fx_B_C1_Chasing_Spring_Birds_v281_endzone (1).docx', import.meta.url)
test('real spot doc parses into one spot with all seven sections', async (t) => {
  let buf: Buffer
  try {
    buf = await readFile(REAL_DOC)
  } catch {
    t.skip('mds/ doc not present')
    return
  }
  const {html} = await parseDocx(new Blob([buf]))
  const docs = splitSections(html, buildFieldMap(), parseHtml(html))
  assert.equal(docs.length, 1)
  assert.equal(docs[0].id, 'BB.WE.B.C1 - Chasing Spring Birds at the West End')
  assert.equal(docs[0].meta.length, 35) // 36 rows less the ID
  assert.deepEqual(Object.keys(docs[0].sections).sort(), [...NARRATIVE_FIELDS].sort())
  assert.deepEqual(docs[0].unmatched.map((u) => u.heading), ['Asset Registry'])
})

if (process.env.DUMP_TABLES) {
  test('dump', async () => {
    const {fields} = await parseFixture()
    const tables = [fields.historicalAnalysis, fields.environmentalFactors].map((f) => f.find((b) => b._type === 'richTableBlock'))
    console.log(JSON.stringify(tables, null, 2))
  })
}

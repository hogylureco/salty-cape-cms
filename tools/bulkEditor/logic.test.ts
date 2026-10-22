// Run with: npm run test:bulk-editor
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {evaluate, parse} from 'groq-js'
import {buildEdit, chunk, deleteAction, editAction, planBulk, splitRefArray, statusFromIds} from './actions.ts'
import {toCsv} from './csv.ts'
import {buildExportQuery, buildRefIndexQuery, buildRowsQuery, type GridFilters} from './groq.ts'
import type {ColumnDef} from './schemaColumns.ts'

const col = (key: string, kind: ColumnDef['kind'], extra: Partial<ColumnDef> = {}): ColumnDef => ({
  key,
  title: key,
  kind,
  schemaType: kind,
  readOnly: false,
  editable: kind !== 'summary',
  sortable: true,
  filterable: true,
  searchable: kind === 'string' || kind === 'slug',
  ...extra,
})

const columns: ColumnDef[] = [
  col('id', 'string'),
  col('name', 'string'),
  col('slug', 'slug'),
  col('spotType', 'select', {options: [{title: 'FS', value: 'fs'}, {title: 'BR', value: 'br'}]}),
  col('zone', 'referenceArray', {to: ['zone'], weak: true}),
  col('platform', 'stringListArray', {options: [{title: 'Boat', value: 'boat'}]}),
  col('notes', 'summary', {summary: 'portableText', editable: false}),
]

const dataset = [
  {_id: 'z1', _type: 'zone', name: 'Inshore', id: 'Z1 - Inshore'},
  {
    _id: 'a',
    _type: 'spot',
    _updatedAt: '2026-10-01T00:00:00Z',
    id: 'BB.WE.fs - West End',
    name: 'West End',
    slug: {current: 'west-end'},
    spotType: 'fs',
    zone: [{_key: 'k1', _ref: 'z1', _type: 'reference', _weak: true}],
    platform: ['boat'],
    notes: [{_type: 'block', _key: 'b', children: [{_type: 'span', _key: 's', text: 'Fish the rip on the ebb.'}]}],
  },
  {_id: 'b', _type: 'spot', _updatedAt: '2026-10-02T00:00:00Z', id: 'BB.EE.br - East Ramp', name: 'East Ramp', spotType: 'br'},
]

async function run(filters: GridFilters) {
  const {query, params} = buildRowsQuery('spot', columns, columns, filters)
  return await (await evaluate(parse(query, {params}), {dataset, params})).get()
}

test('rows query parses and projects visible columns', async () => {
  const res = await run({search: '', columns: {}})
  assert.equal(res.total, 2)
  const a = res.rows.find((r: any) => r._id === 'a')
  assert.equal(a.slug, 'west-end')
  assert.deepEqual(a.zone, [{_key: 'k1', _ref: 'z1', _type: 'reference', _weak: true}])
  assert.deepEqual(a.notes, {count: 1, text: 'Fish the rip on the ebb.'})
})

test('search matches name and the id field', async () => {
  assert.deepEqual((await run({search: 'west', columns: {}})).rows.map((r: any) => r._id), ['a'])
  assert.deepEqual((await run({search: 'ramp', columns: {}})).rows.map((r: any) => r._id), ['b'])
})

test('column filters: select, reference array, string list, empty', async () => {
  const ids = async (f: GridFilters['columns']) => (await run({search: '', columns: f})).rows.map((r: any) => r._id)
  assert.deepEqual(await ids({spotType: {op: 'eq', value: 'br'}}), ['b'])
  assert.deepEqual(await ids({zone: {op: 'eq', value: 'z1'}}), ['a'])
  assert.deepEqual(await ids({platform: {op: 'eq', value: 'boat'}}), ['a'])
  assert.deepEqual(await ids({zone: {op: 'empty'}}), ['b'])
})

test('export query flattens Portable Text', async () => {
  const query = buildExportQuery(columns)
  const params = {ids: ['a']}
  const rows = await (await evaluate(parse(query, {params}), {dataset, params})).get()
  assert.equal(rows[0].notes, 'Fish the rip on the ebb.')
})

test('ref index query labels by each type preview title', async () => {
  const q = buildRefIndexQuery({zone: 'name'})
  const params = {types: ['zone']}
  const rows = await (await evaluate(parse(q, {params}), {dataset, params})).get()
  assert.deepEqual(rows, [{_id: 'z1', _type: 'zone', id: 'Z1 - Inshore', title: 'Inshore'}])
})

test('edits target the draft and clear with unset', () => {
  const sel = columns[3]
  assert.deepEqual(buildEdit(sel, 'br', 'fs')?.patch, {set: {spotType: 'br'}})
  assert.deepEqual(buildEdit(sel, null, 'fs')?.patch, {unset: ['spotType']})
  assert.equal(buildEdit(sel, 'fs', 'fs'), null)
  assert.deepEqual(editAction('abc', {set: {x: 1}}), {
    actionType: 'sanity.action.document.edit',
    draftId: 'drafts.abc',
    publishedId: 'abc',
    patch: {set: {x: 1}},
  })
  assert.equal(editAction('drafts.abc', {}).draftId, 'drafts.abc')
})

test('slug edits write a full slug object', () => {
  assert.deepEqual(buildEdit(columns[2], 'new', 'old')?.patch, {set: {slug: {_type: 'slug', current: 'new'}}})
})

test('weak reference arrays write _weak and keep existing keys', () => {
  const edit = buildEdit(columns[4], ['z1', 'z2'], [{_key: 'k1', _ref: 'z1', _weak: true}])!
  const items = (edit.patch.set!.zone as any[])
  assert.equal(items[0]._key, 'k1')
  assert.ok(items[1]._key)
  assert.ok(items.every((r) => r._type === 'reference' && r._weak === true))
  const strong = buildEdit({...columns[4], weak: false}, ['z1'], [])!
  assert.equal((strong.patch.set!.zone as any[])[0]._weak, undefined)
})

test('status and bulk plans skip documents an action does not apply to', () => {
  const status = statusFromIds(['drafts.a', 'a', 'drafts.b', 'c', 'versions.r1.a'])
  assert.deepEqual(status.get('a'), {draft: true, published: true})
  assert.deepEqual(status.get('b'), {draft: true, published: false})
  assert.deepEqual(status.get('c'), {draft: false, published: true})
  assert.deepEqual(planBulk('publish', ['a', 'b', 'c'], status).targets, ['a', 'b'])
  assert.deepEqual(planBulk('unpublish', ['a', 'b', 'c'], status).targets, ['a', 'c'])
  assert.equal(planBulk('delete', ['a', 'b', 'c'], status).skipped, 0)
  assert.deepEqual(deleteAction('b', status.get('b')).includeDrafts, ['drafts.b'])
  assert.deepEqual(deleteAction('c', status.get('c')).includeDrafts, [])
})

test('chunks at 100 per transaction', () => {
  assert.deepEqual(chunk(Array.from({length: 250}, (_, i) => i)).map((c) => c.length), [100, 100, 50])
})

test('csv uses field-name headers, ref titles and escapes', () => {
  const csv = toCsv(
    [columns[1], columns[4], columns[6]],
    [{_id: 'a', name: 'West, End', zone: [{_ref: 'z1'}, {_ref: 'gone'}], notes: 'Line "one"'}],
    (ref) => (ref === 'z1' ? {title: 'Inshore'} : undefined),
  )
  assert.equal(csv, '﻿_id,name,zone,notes\r\na,"West, End",Inshore; gone (missing),"Line ""one"""\r\n')
})

// Imported data can hold nulls or plain strings where references or strings belong.
// Reading must not crash, and editing must write those items back rather than drop them.
test('malformed reference arrays are read safely and kept on edit', async () => {
  const messy = [null, 'Fall', {_key: 'k1', _ref: 'z1', _type: 'reference'}]
  assert.deepEqual(splitRefArray(messy), {refs: [{_key: 'k1', _ref: 'z1', _type: 'reference'}], invalid: [null, 'Fall']})
  assert.deepEqual(splitRefArray({_ref: 'z1'}).refs, [{_ref: 'z1'}])
  assert.deepEqual(splitRefArray('Fall'), {refs: [], invalid: ['Fall']})

  const edit = buildEdit(columns[4], ['z1', 'z2'], messy)!
  const written = edit.patch.set!.zone as any[]
  assert.deepEqual(written.slice(2), [null, 'Fall'])
  assert.equal(written[0]._key, 'k1')
  assert.equal(buildEdit(columns[4], ['z1'], messy), null)

  // The grid query returns such items as stored, not as nulls from a projection.
  const ds = [{_id: 'm', _type: 'spot', zone: messy}]
  const {query, params} = buildRowsQuery('spot', [columns[4]], columns, {search: '', columns: {}})
  const res = await (await evaluate(parse(query, {params}), {dataset: ds, params})).get()
  assert.deepEqual(res.rows[0].zone, messy)
})

test('a string list stored as a single string becomes a proper list on edit', () => {
  const edit = buildEdit(columns[5], ['boat', 'shore'], 'boat')!
  assert.deepEqual(edit.patch.set, {platform: ['boat', 'shore']})
  const kept = buildEdit(columns[5], ['boat', 'shore'], ['boat', 7])!
  assert.deepEqual(kept.patch.set, {platform: ['boat', 'shore', 7]})
  assert.equal(buildEdit(columns[5], ['boat'], ['boat', 7]), null)
})

test('csv marks invalid list items instead of failing', () => {
  const csv = toCsv([columns[4], columns[5]], [{_id: 'm', zone: [null, 'Fall', {_ref: 'z1'}], platform: 'boat'}], () => ({title: 'Inshore'}))
  assert.equal(csv.split('\r\n')[1], 'm,null (invalid); Fall (invalid); Inshore,boat')
})

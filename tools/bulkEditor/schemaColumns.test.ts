// Run with: npm run test:bulk-editor
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Schema} from '@sanity/schema'
import {builtinTypes} from '@sanity/schema/_internal'
import {deriveColumns, listDocumentTypes, previewTitleField, unhandledColumns} from './schemaColumns.ts'

const richTableBlock = {name: 'richTableBlock', type: 'object', fields: [{name: 'rows', type: 'string'}]}

const schema = Schema.compile({
  name: 'test',
  types: [
    ...builtinTypes,
    richTableBlock,
    {name: 'zone', type: 'document', fields: [{name: 'name', type: 'string'}], preview: {select: {title: 'name'}}},
    {
      name: 'spot',
      type: 'document',
      fields: [
        {name: 'id', type: 'string'},
        {name: 'slug', type: 'slug'},
        {name: 'notes', type: 'text'},
        {name: 'lat', type: 'number'},
        {name: 'gpx', type: 'url'},
        {name: 'live', type: 'boolean'},
        {name: 'day', type: 'date'},
        {name: 'at', type: 'datetime'},
        {name: 'kind', type: 'string', options: {list: [{title: 'Featured', value: 'fs'}, 'br']}},
        {name: 'zone', type: 'reference', to: [{type: 'zone'}], weak: true},
        {name: 'zones', type: 'array', of: [{type: 'reference', to: [{type: 'zone'}]}]},
        {name: 'weakZones', type: 'array', of: [{type: 'reference', to: [{type: 'zone'}], weak: true}]},
        {name: 'tags', type: 'array', of: [{type: 'string'}]},
        {name: 'platform', type: 'array', of: [{type: 'string'}], options: {list: ['shore', 'boat']}},
        {name: 'body', type: 'array', of: [{type: 'block'}, {type: 'image'}, {type: 'richTableBlock'}]},
        {name: 'hero', type: 'image'},
        {name: 'where', type: 'geopoint'},
        {name: 'secret', type: 'string', hidden: true},
        {name: 'locked', type: 'string', readOnly: true},
      ],
    },
  ],
})

const byKey = Object.fromEntries(deriveColumns(schema as any, 'spot').map((c) => [c.key, c]))

test('scalar kinds', () => {
  assert.equal(byKey.id.kind, 'string')
  assert.equal(byKey.slug.kind, 'slug')
  assert.equal(byKey.notes.kind, 'text')
  assert.equal(byKey.lat.kind, 'number')
  assert.equal(byKey.gpx.kind, 'url')
  assert.equal(byKey.live.kind, 'boolean')
  assert.equal(byKey.day.kind, 'date')
  assert.equal(byKey.at.kind, 'datetime')
})

test('options.list becomes a select with the schema values', () => {
  assert.equal(byKey.kind.kind, 'select')
  assert.deepEqual(byKey.kind.options, [
    {title: 'Featured', value: 'fs'},
    {title: 'br', value: 'br'},
  ])
})

test('references keep target types and the weak flag', () => {
  assert.deepEqual([byKey.zone.kind, byKey.zone.to, byKey.zone.weak], ['reference', ['zone'], true])
  assert.deepEqual([byKey.zones.kind, byKey.zones.weak], ['referenceArray', false])
  assert.deepEqual([byKey.weakZones.kind, byKey.weakZones.weak], ['referenceArray', true])
})

test('string arrays: tags without a list, multi-select with one', () => {
  assert.equal(byKey.tags.kind, 'stringArray')
  assert.equal(byKey.platform.kind, 'stringListArray')
  assert.deepEqual(byKey.platform.options?.map((o) => o.value), ['shore', 'boat'])
})

test('portable text, images and objects are read-only summaries', () => {
  assert.deepEqual([byKey.body.kind, byKey.body.summary, byKey.body.editable], ['summary', 'portableText', false])
  assert.deepEqual([byKey.hero.kind, byKey.hero.summary], ['summary', 'image'])
  assert.deepEqual([byKey.where.kind, byKey.where.summary], ['summary', 'object'])
})

test('hidden fields are dropped, readOnly fields are kept but not editable', () => {
  assert.equal(byKey.secret, undefined)
  assert.deepEqual([byKey.locked.readOnly, byKey.locked.editable], [true, false])
})

test('no unhandled field types in this schema', () => {
  assert.deepEqual(unhandledColumns(Object.values(byKey)), [])
})

test('document type list skips system types', () => {
  assert.deepEqual(listDocumentTypes(schema as any).map((t) => t.name).sort(), ['spot', 'zone'])
  assert.equal(previewTitleField(schema as any, 'zone'), 'name')
})

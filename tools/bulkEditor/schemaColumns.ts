/**
 * Derives the Bulk Editor's column model from the compiled Studio schema.
 *
 * Pure: takes a compiled schema (what `useSchema()` returns, or `Schema.compile(...)` in a test)
 * and a document type name, returns one ColumnDef per visible field. Adding a type or a field
 * to the schema needs no change here — unknown field types come back as read-only `summary`
 * columns with `summary: 'unknown'`, so they show up in the column dump instead of breaking.
 *
 * Imports are type-only so this file also runs under plain `node --test`.
 */
import type {Schema, SchemaType} from 'sanity'

export type ColumnKind =
  | 'string' // single-line string, inline input
  | 'text' // multi-line string, inline textarea
  | 'number'
  | 'url'
  | 'slug' // edits slug.current
  | 'select' // string/number with options.list
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'reference'
  | 'referenceArray'
  | 'stringArray' // array of strings without a list: free-text tags
  | 'stringListArray' // array of strings with options.list: multi-select of the list
  | 'summary' // never editable in the grid; shows a short summary and an Open link

export type SummaryKind = 'portableText' | 'image' | 'file' | 'object' | 'array' | 'unknown'

export interface ListOption {
  title: string
  value: string | number
}

export interface ColumnDef {
  key: string
  title: string
  kind: ColumnKind
  /** Base schema type the kind was derived from, e.g. 'text', 'array', 'richTableBlock>object'. */
  schemaType: string
  readOnly: boolean
  /** Inline-editable in the grid and offered by "Set field value". */
  editable: boolean
  options?: ListOption[]
  /** Reference target types. */
  to?: string[]
  /** References are written with `_weak: true`. */
  weak?: boolean
  /** Array members disagree on `weak`; the column writes strong refs. */
  mixedWeak?: boolean
  summary?: SummaryKind
  sortable: boolean
  filterable: boolean
  searchable: boolean
}

// Base types this module knows how to classify, in the order they are looked for along a
// type's `.type` chain (first match wins, so `text` is found before the `string` it extends).
const KNOWN_BASES = new Set([
  'string',
  'text',
  'email',
  'number',
  'boolean',
  'date',
  'datetime',
  'url',
  'slug',
  'reference',
  'crossDatasetReference',
  'globalDocumentReference',
  'image',
  'file',
  'geopoint',
  'block',
  'span',
  'array',
  'object',
  'document',
])

const SORTABLE: ColumnKind[] = ['string', 'text', 'number', 'url', 'slug', 'select', 'boolean', 'date', 'datetime']
const FILTERABLE: ColumnKind[] = ['select', 'boolean', 'reference', 'referenceArray', 'stringListArray']
const SEARCHABLE: ColumnKind[] = ['string', 'text', 'url', 'slug', 'select']

function typeChain(t: any): string[] {
  const names: string[] = []
  for (let cur = t; cur; cur = cur.type) if (cur.name) names.push(cur.name)
  return names
}

export function baseTypeName(t: any): string {
  const chain = typeChain(t)
  return chain.find((n) => KNOWN_BASES.has(n)) ?? chain[chain.length - 1] ?? 'unknown'
}

function describeType(t: any): string {
  const chain = typeChain(t)
  const base = baseTypeName(t)
  return chain[0] && chain[0] !== base ? `${chain[0]}>${base}` : base
}

/** First value of a property found along the type chain. */
function inherited<T>(t: any, read: (cur: any) => T | undefined): T | undefined {
  for (let cur = t; cur; cur = cur.type) {
    const v = read(cur)
    if (v !== undefined) return v
  }
  return undefined
}

function refTargets(t: any): {to: string[]; weak: boolean} | null {
  if (baseTypeName(t) !== 'reference') return null
  const to = inherited<string[]>(t, (cur) =>
    Array.isArray(cur.to) ? cur.to.map((x: any) => x?.name).filter(Boolean) : undefined,
  )
  const weak = inherited<boolean>(t, (cur) => (typeof cur.weak === 'boolean' ? cur.weak : undefined))
  return {to: to ?? [], weak: weak === true}
}

function listOptions(t: any): ListOption[] | undefined {
  const list = inherited<unknown[]>(t, (cur) => (Array.isArray(cur.options?.list) ? cur.options.list : undefined))
  if (!list) return undefined
  return list
    .map((item: any) =>
      item !== null && typeof item === 'object'
        ? {title: String(item.title ?? item.value), value: item.value}
        : {title: String(item), value: item},
    )
    .filter((o) => typeof o.value === 'string' || typeof o.value === 'number')
}

// `hidden`/`readOnly` may be booleans or callbacks. A callback can't be evaluated per cell
// cheaply, so a conditionally hidden field is kept, and a conditionally read-only one is
// treated as read-only (the safe side).
const isHidden = (field: any) => field.type?.hidden === true || field.hidden === true
const isReadOnly = (field: any) => {
  const r = field.type?.readOnly ?? field.readOnly
  return r === true || typeof r === 'function'
}

function classify(t: any): Pick<ColumnDef, 'kind' | 'options' | 'to' | 'weak' | 'mixedWeak' | 'summary'> {
  const base = baseTypeName(t)
  switch (base) {
    case 'string':
    case 'email':
    case 'number': {
      const options = listOptions(t)
      if (options?.length) return {kind: 'select', options}
      return {kind: base === 'number' ? 'number' : 'string'}
    }
    case 'text':
      return {kind: 'text'}
    case 'url':
      return {kind: 'url'}
    case 'boolean':
      return {kind: 'boolean'}
    case 'date':
      return {kind: 'date'}
    case 'datetime':
      return {kind: 'datetime'}
    case 'slug':
      return {kind: 'slug'}
    case 'reference': {
      const ref = refTargets(t)!
      return {kind: 'reference', to: ref.to, weak: ref.weak}
    }
    case 'image':
      return {kind: 'summary', summary: 'image'}
    case 'file':
      return {kind: 'summary', summary: 'file'}
    case 'object':
    case 'geopoint':
      return {kind: 'summary', summary: 'object'}
    case 'array': {
      const members: any[] = Array.isArray(t.of) ? t.of : []
      const bases = members.map(baseTypeName)
      if (bases.includes('block')) return {kind: 'summary', summary: 'portableText'}
      if (members.length && bases.every((b) => b === 'reference')) {
        const refs = members.map(refTargets) as {to: string[]; weak: boolean}[]
        const to = [...new Set(refs.flatMap((r) => r.to))]
        const allWeak = refs.every((r) => r.weak)
        const someWeak = refs.some((r) => r.weak)
        return {kind: 'referenceArray', to, weak: allWeak, ...(someWeak && !allWeak ? {mixedWeak: true} : {})}
      }
      if (members.length && bases.every((b) => b === 'string')) {
        const options = listOptions(t)
        return options?.length ? {kind: 'stringListArray', options} : {kind: 'stringArray'}
      }
      return {kind: 'summary', summary: 'array'}
    }
    default:
      return {kind: 'summary', summary: 'unknown'}
  }
}

export function deriveColumns(schema: Schema, typeName: string): ColumnDef[] {
  const docType = schema.get(typeName) as SchemaType & {fields?: any[]}
  if (!docType || !Array.isArray(docType.fields)) return []
  return docType.fields
    .filter((field) => !isHidden(field))
    .map((field): ColumnDef => {
      const t = field.type
      const c = classify(t)
      const readOnly = isReadOnly(field)
      return {
        key: field.name,
        title: t?.title || field.title || field.name,
        schemaType: describeType(t),
        readOnly,
        editable: c.kind !== 'summary' && !readOnly,
        sortable: SORTABLE.includes(c.kind),
        filterable: FILTERABLE.includes(c.kind),
        searchable: SEARCHABLE.includes(c.kind),
        ...c,
      }
    })
}

/** Document types to offer in the picker: schema documents, minus Sanity/plugin system types. */
export function listDocumentTypes(schema: Schema): {name: string; title: string}[] {
  return schema
    .getTypeNames()
    .map((name) => schema.get(name) as any)
    .filter((t) => t && t.type?.name === 'document' && !t.name.includes('.'))
    .map((t) => ({name: t.name as string, title: (t.title as string) || t.name}))
}

/** The field each type uses as its preview title, for labelling references to it. */
export function previewTitleField(schema: Schema, typeName: string): string | undefined {
  const t = schema.get(typeName) as any
  const field = t?.preview?.select?.title
  return typeof field === 'string' ? field : undefined
}

/** Columns whose field type isn't covered by a renderer (shown read-only). */
export function unhandledColumns(columns: ColumnDef[]): ColumnDef[] {
  return columns.filter((c) => c.kind === 'summary' && c.summary === 'unknown')
}

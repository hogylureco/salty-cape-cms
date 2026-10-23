/**
 * GROQ for the Bulk Editor grid. Pure string building; every user value goes in `params`.
 */
import type {ColumnDef} from './schemaColumns.ts'

/** Hard ceiling on rows fetched for one view; the toolbar says so when it's hit. */
export const ROW_LIMIT = 5000

/** Portable Text blocks fetched per grid cell; the cell shows the first 60 characters. */
const PT_PREVIEW_BLOCKS = 2

export type ColumnFilter = {op: 'eq'; value: string | number | boolean} | {op: 'empty'}

export interface GridFilters {
  search: string
  columns: Record<string, ColumnFilter>
}

/** Projection for one column in the grid (`export: false`) or in a CSV export (`export: true`). */
export function columnProjection(col: ColumnDef, opts: {export?: boolean} = {}): string {
  const k = col.key
  switch (col.kind) {
    case 'slug':
      return `"${k}": ${k}.current`
    case 'reference':
      return `"${k}": ${k}{_ref, _weak}`
    case 'referenceArray':
      // Fetched as stored: a projection would turn non-reference items (nulls, strings from
      // imports) into null, and an edit could then not write them back.
      return k
    case 'summary':
      switch (col.summary) {
        case 'portableText':
          return opts.export
            ? `"${k}": pt::text(${k})`
            : `"${k}": {"count": count(${k}), "text": pt::text(${k}[_type == "block"][0...${PT_PREVIEW_BLOCKS}])}`
        case 'image':
        case 'file':
          return opts.export ? `"${k}": ${k}.asset->url` : `"${k}": defined(${k}.asset)`
        case 'array':
          return `"${k}": count(${k})`
        default:
          return `"${k}": defined(${k})`
      }
    default:
      return k
  }
}

export function rowProjection(columns: ColumnDef[], opts: {export?: boolean} = {}): string {
  const fields = ['_id', '_type', '_updatedAt', '_rev', 'id']
  // Timestamp columns come from `withMeta`, across the draft and published document.
  for (const col of columns) if (col.key !== 'id' && !col.meta) fields.push(columnProjection(col, opts))
  return `{${fields.join(', ')}}`
}

/** Search terms -> `match` patterns. Each word becomes a prefix match; all words must match. */
export function searchPatterns(search: string): string[] {
  return search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w.replace(/\*/g, '')}*`)
}

export function buildFilter(
  columns: ColumnDef[],
  filters: GridFilters,
): {filter: string; params: Record<string, unknown>} {
  const parts = ['_type == $type']
  const params: Record<string, unknown> = {}

  const patterns = searchPatterns(filters.search)
  const searchable = columns.filter((c) => c.searchable).map((c) => (c.kind === 'slug' ? `${c.key}.current` : c.key))
  if (!searchable.includes('id')) searchable.unshift('id')
  if (patterns.length) {
    params.search = patterns
    parts.push(`[${searchable.join(', ')}] match $search`)
  }

  let i = 0
  for (const col of columns) {
    const f = filters.columns[col.key]
    if (!f) continue
    const k = col.key
    if (f.op === 'empty') {
      if (col.kind === 'referenceArray' || col.kind === 'stringListArray') parts.push(`count(coalesce(${k}, [])) == 0`)
      else if (col.kind === 'reference') parts.push(`!defined(${k}._ref)`)
      else parts.push(`!defined(${k})`)
      continue
    }
    const p = `f${i++}`
    params[p] = f.value
    if (col.kind === 'reference') parts.push(`${k}._ref == $${p}`)
    else if (col.kind === 'referenceArray') parts.push(`$${p} in ${k}[]._ref`)
    else if (col.kind === 'stringListArray') parts.push(`$${p} in ${k}`)
    else parts.push(`${k} == $${p}`)
  }
  return {filter: parts.join(' && '), params}
}

/** Rows for the grid (drafts perspective) plus the total match count. */
export function buildRowsQuery(
  typeName: string,
  visible: ColumnDef[],
  all: ColumnDef[],
  filters: GridFilters,
): {query: string; params: Record<string, unknown>} {
  const {filter, params} = buildFilter(all, filters)
  return {
    query: `{
  "rows": *[${filter}] | order(_updatedAt desc) [0...${ROW_LIMIT}] ${rowProjection(visible)},
  "total": count(*[${filter}])
}`,
    params: {...params, type: typeName},
  }
}

/** Every document of the type, raw perspective: drafts.<id>, <id> and versions.*, with timestamps. */
export const STATUS_QUERY = `*[_type == $type]{_id, _createdAt, _updatedAt}`

/** Whole documents for JSON export, drafts perspective: the draft where one exists. */
export const FULL_EXPORT_QUERY = `*[_id in $ids]`

export function buildExportQuery(columns: ColumnDef[]): string {
  return `*[_id in $ids] ${rowProjection(columns, {export: true})}`
}

/** Labels for reference targets: one query across all target types. */
export function buildRefIndexQuery(titleFieldByType: Record<string, string | undefined>): string {
  const cases = Object.entries(titleFieldByType)
    .filter(([, field]) => field)
    .map(([type, field]) => `_type == ${JSON.stringify(type)} => ${field}`)
  const title = cases.length ? `coalesce(select(${cases.join(', ')}), name, title, id)` : 'coalesce(name, title, id)'
  return `*[_type in $types] {_id, _type, id, "title": ${title}}`
}

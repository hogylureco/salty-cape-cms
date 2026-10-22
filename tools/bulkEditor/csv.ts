/**
 * CSV export for the Bulk Editor. Headers are field names (so the file maps straight back onto
 * the schema in the Bulk Import tool), references are written as their target's title, and
 * Portable Text as plain text.
 */
import {isRef, type RefValue} from './actions.ts'
import type {ColumnDef} from './schemaColumns.ts'

export interface RefLabel {
  title?: string | null
  id?: string | null
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportValue(
  col: ColumnDef,
  value: unknown,
  labelOf: (ref: string) => RefLabel | undefined,
): string | number | boolean | null {
  if (value === null || value === undefined) return null
  const refTitle = (r: RefValue | null | undefined) => {
    if (!r?._ref) return ''
    const label = labelOf(r._ref)
    return label ? (label.title ?? label.id ?? r._ref) : `${r._ref} (missing)`
  }
  switch (col.kind) {
    case 'reference':
      return refTitle(value as RefValue)
    case 'referenceArray':
      return (Array.isArray(value) ? value : [])
        .map((item) => (isRef(item) ? refTitle(item) : `${typeof item === 'string' ? item : JSON.stringify(item)} (invalid)`))
        .filter(Boolean)
        .join('; ')
    case 'stringArray':
    case 'stringListArray':
      return (Array.isArray(value) ? value : [value])
        .map((item) => (typeof item === 'string' ? item : `${JSON.stringify(item)} (invalid)`))
        .join('; ')
    default:
      return value as string | number | boolean
  }
}

export function toCsv(
  columns: ColumnDef[],
  rows: Record<string, unknown>[],
  labelOf: (ref: string) => RefLabel | undefined,
): string {
  const header = ['_id', ...columns.map((c) => c.key)]
  const lines = [header.map(cell).join(',')]
  for (const row of rows) {
    lines.push([row._id, ...columns.map((c) => exportValue(c, row[c.key], labelOf))].map(cell).join(','))
  }
  // BOM so Excel opens UTF-8 (accents, en dashes in ids) correctly.
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Full documents as pretty-printed JSON (an array, one object per document). */
export function toJson(docs: Record<string, unknown>[]): string {
  return `${JSON.stringify(docs, null, 2)}\n`
}

/** `*[_id in $ids]` returns documents in no particular order; put them back in `ids` order. */
export function orderByIds<T extends {_id: string}>(docs: T[], ids: string[]): T[] {
  const byId = new Map(docs.map((d) => [d._id, d]))
  return ids.map((id) => byId.get(id)).filter((d): d is T => Boolean(d))
}

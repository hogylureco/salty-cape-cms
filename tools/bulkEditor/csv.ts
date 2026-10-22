/**
 * CSV export for the Bulk Editor. Headers are field names (so the file maps straight back onto
 * the schema in the Bulk Import tool), references are written as their target's title, and
 * Portable Text as plain text.
 */
import type {RefValue} from './actions.ts'
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
      return (value as RefValue[]).map(refTitle).filter(Boolean).join('; ')
    case 'stringArray':
    case 'stringListArray':
      return (value as string[]).join('; ')
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

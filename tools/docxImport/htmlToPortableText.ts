// HTML -> Portable Text against the live schema types, so styles, lists and marks are exactly
// what the Studio editor accepts.
import {htmlToBlocks, type DeserializerRule} from '@portabletext/block-tools'
import type {ArraySchemaType} from 'sanity'
import {randKey} from '../shared/importDocuments.ts'
import {tableRule} from './richTable.ts'

export type ParseHtml = (html: string) => Document

export const browserParseHtml: ParseHtml = (h) => new DOMParser().parseFromString(h, 'text/html')

/**
 * An embedded image waits for upload under this key; the import replaces the whole block with
 * a real image block ({asset: {_ref}}) before writing.
 */
export const PENDING_UPLOAD = '_pendingUpload'

export function toBlocks(
  html: string,
  blockType: ArraySchemaType,
  rules: DeserializerRule[] = [],
  parseHtml: ParseHtml = browserParseHtml,
): any[] {
  if (!html.trim()) return []
  return htmlToBlocks(html, blockType, {parseHtml, rules, keyGenerator: () => randKey()}) as any[]
}

export function imageRule(warn: (message: string) => void): DeserializerRule {
  return {
    deserialize(el) {
      if ((el as Element).tagName !== 'IMG') return undefined
      const src = (el as Element).getAttribute('src') ?? ''
      if (!src.startsWith('data:image/')) {
        warn(`An image that is linked rather than embedded in the Word file was left out (${src.slice(0, 60) || 'no source'}).`)
        return []
      }
      return {_type: 'image', _key: randKey(), [PENDING_UPLOAD]: src}
    },
  }
}

export interface ConvertTypes {
  /** The narrative field's array type, e.g. spot.captMikeNotes */
  field: ArraySchemaType
  /** The rich-table cell's `content` array type */
  cell: ArraySchemaType
}

/** Convert one field's HTML: tables -> richTableBlock, embedded images -> pending image blocks. */
export function convertField(
  html: string,
  types: ConvertTypes,
  warn: (message: string) => void,
  parseHtml: ParseHtml = browserParseHtml,
): any[] {
  const cellToBlocks = (cellHtml: string) => toBlocks(cellHtml, types.cell, [], parseHtml)
  return toBlocks(html, types.field, [tableRule({cellToBlocks, warn}), imageRule(warn)], parseHtml)
}

/** The schema types convertField needs, read from the compiled Studio schema. */
export function convertTypesFor(schema: {get: (name: string) => any}, docType: string, field: string): ConvertTypes | null {
  const fieldType = schema.get(docType)?.fields?.find((f: any) => f.name === field)?.type
  const cellType = schema.get('richTableCell')?.fields?.find((f: any) => f.name === 'content')?.type
  if (!fieldType || fieldType.jsonType !== 'array' || !cellType) return null
  return {field: fieldType, cell: cellType}
}

/**
 * Bulk JSON Field Import — Sanity Studio custom tool
 *
 * Creates NEW documents, or updates existing ones, from a JSON array. For each
 * record it looks for a document of the chosen type whose `id` (or `_id`) equals
 * `match`:
 *   - found      -> the listed fields are PATCHED in; every other field is left intact
 *   - not found  -> a new document is created with those fields
 *
 * IMPORTANT: the import path in sanity.config.ts must match THIS file's name
 * exactly (case-sensitive on Vercel/Linux). This file is bulkJsonFieldImportTool.tsx:
 *
 *   import {bulkJsonFieldImportTool} from './tools/bulkJsonFieldImportTool'
 *
 *   tools: [
 *     {name: 'bulk-import', title: 'Bulk Import', component: BulkImportTool},
 *     bulkJsonFieldImportTool,
 *   ],
 *
 * Expected input — a JSON array of records:
 *
 *   [
 *     {
 *       "_type": "report",                                          // optional safety check
 *       "match": "RPT.NS.2026-10-03.BOAT.001 - Nantucket Sound",   // custom `id` field (or _id)
 *       "fields": {
 *         "name": "Nantucket Sound Fishing Report - October 3, 2026",
 *         "slug": {"_type": "slug", "current": "nantucket-sound-fishing-report-10-3-2026"},
 *         "targetSpecies": ["BON - Atlantic Bonito", "STB - Striped Bass"],   // reference field
 *         "description": [ ...Portable Text blocks... ]
 *       }
 *     }
 *   ]
 *
 * `match` may also be supplied as `id` or `_id`, or left out when `fields.id` is present.
 * If a record carries `_type`, it must equal the Document type chosen in the tool.
 *
 * New documents
 *  - _id is derived from the code before " - ", the same way the CSV BulkImportTool
 *    does it ("RPT.NS.2026-10-03.BOAT.001 - Nantucket Sound" -> RPT-NS-2026-10-03-BOAT-001),
 *    so both tools address the same document.
 *  - When matching on `id`, the `id` field is filled from `match` if the record omits it,
 *    so the next import of the same record matches instead of creating a duplicate.
 *  - "If no document matches" can be switched to "Skip the record" for patch-only runs.
 *
 * What the tool does with each field
 *  - Reference fields (per the document type's schema): every STRING in the value
 *    is matched to a target document and replaced by a real reference. Matching
 *    is on the target's custom `id` field: exact value first, then the code before
 *    " - " (so a changed label still matches), then a case-insensitive match on
 *    id / name / title for un-coded values such as "Fall". Items that are already
 *    reference objects ({_ref: ...}) are stored as given.
 *  - Arrays of objects (Portable Text etc.) get `_key`s injected where missing.
 *  - Everything else is stored verbatim.
 *
 * Leftover documents
 *  - An earlier version of this tool could write to "drafts.drafts.<id>". Studio lists such a
 *    document as a blank duplicate and cannot open or delete it. This version ignores them when
 *    matching, lists them at the top of the tool, and deletes them on request.
 *
 * Which version gets written
 *  - Write to Drafts (default): patches or creates the draft. If only a published
 *    document exists, the draft is first created as a full copy of it (what Studio
 *    does when you start editing), so no fields go missing.
 *  - Write to Published: patches or creates the published document. If only a draft
 *    exists the record is held back with a message instead of writing somewhere unseen.
 */

import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent} from 'react'
import {useClient, useSchema} from 'sanity'
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Flex,
  Heading,
  Label,
  Select,
  Spinner,
  Stack,
  Text,
  TextArea,
  useToast,
} from '@sanity/ui'
import {CheckmarkIcon, PlayIcon, SearchIcon, TrashIcon, UploadIcon, WarningOutlineIcon} from '@sanity/icons'

const API_VERSION = '2024-10-01'
// One stable object: useClient() hands back a new client whenever this object's identity changes.
const CLIENT_OPTIONS = {apiVersion: API_VERSION}
// Custom field that holds the business id ("CODE - Label") on reference targets.
const REF_MATCH_FIELD = 'id'
const BATCH_SIZE = 25
const TYPE_MEMORY_KEY = 'bulkJsonFieldImport.documentType'

/* ------------------------------------------------------------------ */
/* id + key utilities                                                  */
/* ------------------------------------------------------------------ */

function randKey(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export function stripDraft(id: string): string {
  return id.replace(/^drafts\./, '')
}

// An earlier version of this tool could write to "drafts.drafts.<id>" (the draft prefix added to
// an _id that already had it). Studio can neither open nor delete those documents. They are
// never matched or referenced, and the tool offers to delete them.
export function isLeftoverId(id: string): boolean {
  return /^drafts\.drafts\./.test(String(id ?? ''))
}
export const LEFTOVER_QUERY = `*[_id in path("drafts.drafts.**")]{_id, _type, "label": coalesce(id, name, title)}`

export interface LeftoverDoc {
  _id: string
  _type?: string
  label?: string
}

// "BB.WE.fx.B.C1 - Chasing Spring Birds" -> "BB.WE.fx.B.C1". Splits on the FIRST " - ".
export function codeOf(value: string): string {
  const v = String(value ?? '').trim()
  const i = v.indexOf(' - ')
  return i === -1 ? v : v.slice(0, i).trim()
}

// Same rule as BulkImportTool.tsx: "BB.WE.fs" -> "BB-WE-fs".
export function toDocId(code: string): string {
  return String(code)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// _id for a document that has to be created. Long, un-coded match values (a full title)
// are shortened deterministically so the same record always maps to the same _id.
export function mintDocId(match: string): string {
  const id = toDocId(codeOf(match))
  if (id.length <= 96) return id
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  return `${id.slice(0, 87).replace(/-+$/, '')}-${h.toString(36)}`
}

// Any object that is a *member of an array* needs a _key in Sanity.
function ensureKeysInArray(arr: any[]): any[] {
  return arr.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const withKey = item._key ? item : {...item, _key: randKey()}
      return ensureKeysInObject(withKey)
    }
    if (Array.isArray(item)) return ensureKeysInArray(item)
    return item
  })
}

function ensureKeysInObject(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {...obj}
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = ensureKeysInArray(v)
    else if (v && typeof v === 'object') out[k] = ensureKeysInObject(v)
  }
  return out
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/* ------------------------------------------------------------------ */
/* schema                                                              */
/* ------------------------------------------------------------------ */

export interface RefSpec {
  to: string[] // target document types
  weak: boolean
  isArray: boolean
}

export interface FieldSpec {
  jsonType: string // 'string' | 'number' | 'boolean' | 'object' | 'array'
  typeName: string
  ref?: RefSpec
  memberNames?: string[] // allowed _type names for array members
  allowsStrings?: boolean // array may hold plain strings
}

function refInfo(t: any): {to: string[]; weak: boolean} | null {
  let isRef = false
  let to: string[] | null = null
  let weak: boolean | undefined
  for (let cur = t; cur; cur = cur.type) {
    if (cur.name === 'reference') isRef = true
    if (!to && Array.isArray(cur.to)) to = cur.to.map((x: any) => x?.name).filter(Boolean)
    if (weak === undefined && typeof cur.weak === 'boolean') weak = cur.weak
  }
  return isRef && to && to.length ? {to, weak: Boolean(weak)} : null
}

/** Read what the import needs to know about each field of a compiled document type. */
export function readFieldSpecs(docType: any): Record<string, FieldSpec> {
  const specs: Record<string, FieldSpec> = {}
  for (const f of docType?.fields ?? []) {
    const t = f.type
    const spec: FieldSpec = {jsonType: t?.jsonType, typeName: t?.name}
    const single = refInfo(t)
    if (single) spec.ref = {...single, isArray: false}
    if (t?.jsonType === 'array' && Array.isArray(t.of)) {
      spec.memberNames = t.of.map((m: any) => m?.name).filter(Boolean)
      spec.allowsStrings = t.of.some((m: any) => m?.jsonType === 'string')
      const members = t.of.map(refInfo).filter(Boolean) as {to: string[]; weak: boolean}[]
      if (members.length) {
        spec.ref = {
          to: [...new Set(members.flatMap((m) => m.to))],
          weak: members.every((m) => m.weak),
          isArray: true,
        }
      }
    }
    specs[f.name] = spec
  }
  return specs
}

/* ------------------------------------------------------------------ */
/* parse + validate                                                    */
/* ------------------------------------------------------------------ */

export interface ParsedRecord {
  match: string
  fields: Record<string, any>
}

export interface ParseResult {
  errors: string[]
  warnings: string[]
  records: ParsedRecord[]
}

function jsonTypeOf(v: any): string {
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  return typeof v
}

const isRefObject = (v: any) => v && typeof v === 'object' && typeof v._ref === 'string'

export function parseAndValidate(
  raw: string,
  specs: Record<string, FieldSpec> | null,
  typeName: string,
  matchField: 'id' | '_id' = 'id',
): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const records: ParsedRecord[] = []

  let data: any
  try {
    data = JSON.parse(raw)
  } catch (e: any) {
    return {errors: [`Invalid JSON: ${e.message}`], warnings, records}
  }
  if (!Array.isArray(data)) {
    return {errors: ['Top level must be an array of records.'], warnings, records}
  }
  if (!specs) {
    return {
      errors: [
        typeName
          ? `There is no document type named "${typeName}" in this Studio's schema.`
          : 'Choose a Document type first.',
      ],
      warnings,
      records,
    }
  }

  const seen = new Set<string>()
  const noted = new Set<string>() // schema notes are per field, not per record
  const unknown = new Set<string>() // JSON fields this Studio's schema does not have

  // "microseasons" / "micro_seasons" in the schema still receive a JSON "microSeasons".
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '')
  const byNorm = new Map<string, string[]>()
  for (const n of Object.keys(specs)) byNorm.set(norm(n), [...(byNorm.get(norm(n)) ?? []), n])

  data.forEach((rec: any, i: number) => {
    if (!rec || typeof rec !== 'object') {
      errors.push(`Record ${i}: not an object.`)
      return
    }
    const match = rec.match ?? rec.id ?? rec._id ?? rec.fields?.id
    if (typeof match !== 'string' || !match.trim()) {
      errors.push(`Record ${i}: missing string "match" (or "id"/"_id", or an "id" inside "fields").`)
      return
    }
    if (typeof rec._type === 'string' && rec._type !== typeName) {
      errors.push(`Record ${i} (${match}) is a "${rec._type}" record, but Document type is set to "${typeName}".`)
      return
    }
    if (seen.has(match)) warnings.push(`"${match}" appears more than once — the later record wins field by field.`)
    seen.add(match)
    const fields = rec.fields
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      errors.push(`Record ${i} (${match}): missing "fields" object.`)
      return
    }

    if (matchField === 'id' && typeof fields.id === 'string' && fields.id !== match) {
      warnings.push(`Record ${i}: "match" is "${match}" but fields.id is "${fields.id}" — after this import the record will no longer match itself.`)
    }

    const outFields: Record<string, any> = {}
    Object.entries(fields).forEach(([jsonName, fval]) => {
      // Resolve the JSON key to a schema field: exact name, else the one field whose name
      // differs only in case / punctuation.
      let fname = jsonName
      if (!specs[jsonName]) {
        const near = byNorm.get(norm(jsonName)) ?? []
        if (near.length === 1 && !(near[0] in fields)) fname = near[0]
      }
      const spec = specs[fname]
      const where = `Record ${i} (${match}) field "${jsonName}"`
      const note = (msg: string, asError = false) => {
        if (!noted.has(`${jsonName}|${msg}`)) (asError ? errors : warnings).push(`Field "${jsonName}": ${msg}`)
        noted.add(`${jsonName}|${msg}`)
      }
      outFields[fname] = fval
      if (fname !== jsonName) note(`written to the schema field "${fname}" (the names differ only in case or punctuation).`)

      if (!spec) {
        unknown.add(jsonName)
        const plain = Array.isArray(fval) ? fval.filter((x: any) => typeof x === 'string' || typeof x === 'number').length : 0
        if (plain > 0) {
          // id strings can only become references when the schema says which types they point to
          note(
            `is not a field of the "${typeName}" type in the schema this Studio is running, so its ${plain} id value${plain === 1 ? '' : 's'} cannot be matched to references. Add the field to the schema and redeploy, or remove it from the JSON.`,
            true,
          )
          return
        }
        note(`is not a field of the "${typeName}" type in the schema this Studio is running. The value will be stored, and Studio will show it as an unknown field until the schema has it.`)
      } else if (!spec.ref) {
        const got = jsonTypeOf(fval)
        if (got !== 'null' && spec.jsonType && got !== spec.jsonType) {
          note(`the schema type is ${spec.typeName} (${spec.jsonType}) but the JSON has ${got} — Studio will flag the value as invalid.`)
        }
      }

      if (spec?.ref) {
        const items = Array.isArray(fval) ? fval : [fval]
        if (spec.ref.isArray && !Array.isArray(fval)) errors.push(`${where}: expected an array of references.`)
        if (!spec.ref.isArray && Array.isArray(fval)) errors.push(`${where}: expected a single reference, got an array.`)
        items.forEach((it: any, bi: number) => {
          if (typeof it === 'string' && it.trim()) return
          if (isRefObject(it)) return
          errors.push(`${where} item ${bi}: expected an id string ("CODE - Label") or a reference object.`)
        })
        if (Array.isArray(fval) && fval.length === 0) warnings.push(`${where} is empty — will clear it.`)
        return
      }

      if (Array.isArray(fval)) {
        fval.forEach((blk: any, bi: number) => {
          if (typeof blk === 'string' || typeof blk === 'number') {
            if (!spec || !spec.allowsStrings) {
              errors.push(`${where} item ${bi}: plain value in an array the schema does not define as strings or references.`)
            }
            return
          }
          if (!blk || typeof blk !== 'object' || !blk._type) {
            errors.push(`${where} item ${bi}: missing _type.`)
            return
          }
          if (spec?.memberNames?.length && !spec.memberNames.includes(blk._type)) {
            note(`contains "${blk._type}" items, which the schema's \`of\` list does not include (allowed: ${spec.memberNames.join(', ')}).`)
          }
        })
        if (fval.length === 0) warnings.push(`${where} is empty — will clear it.`)
      }
    })
    records.push({match, fields: outFields})
  })

  if (unknown.size) {
    warnings.unshift(`Fields the "${typeName}" type has in this Studio: ${Object.keys(specs).join(', ')}.`)
  }

  return {errors, warnings, records}
}

/* ------------------------------------------------------------------ */
/* reference matching                                                  */
/* ------------------------------------------------------------------ */

export interface RawRefDoc {
  _id: string
  _type: string
  id?: string
  name?: string
  title?: string
}

interface RefTarget {
  baseId: string
  type: string
  hasPublished: boolean
  hasDraft: boolean
  ids: Set<string> // values of the custom id field (draft + published versions)
  names: Set<string> // lower-cased id / name / title values
}

export type RefIndex = Map<string, RefTarget>

export function buildRefIndex(docs: RawRefDoc[]): RefIndex {
  const index: RefIndex = new Map()
  for (const d of docs) {
    if (!d?._id || d._id.startsWith('versions.') || isLeftoverId(d._id)) continue
    const baseId = stripDraft(d._id)
    let t = index.get(baseId)
    if (!t) {
      t = {baseId, type: d._type, hasPublished: false, hasDraft: false, ids: new Set(), names: new Set()}
      index.set(baseId, t)
    }
    if (d._id.startsWith('drafts.')) t.hasDraft = true
    else t.hasPublished = true
    if (typeof d.id === 'string' && d.id.trim()) t.ids.add(d.id.trim())
    for (const v of [d.id, d.name, d.title]) {
      if (typeof v === 'string' && v.trim()) t.names.add(v.trim().toLowerCase())
    }
  }
  return index
}

export interface TokenMatch {
  target?: RefTarget
  how?: 'exact' | 'code' | 'name'
  stored?: string // the target's id value when it differs from the token
  problem?: string
}

/** exact id -> same code before " - " -> case-insensitive id/name/title. */
export function matchToken(token: string, to: string[], index: RefIndex): TokenMatch {
  const tok = token.trim()
  const pool = [...index.values()].filter((t) => to.includes(t.type))
  const steps: {how: 'exact' | 'code' | 'name'; test: (t: RefTarget) => boolean}[] = [
    {how: 'exact', test: (t) => t.ids.has(tok)},
    {how: 'code', test: (t) => [...t.ids].some((v) => codeOf(v) === codeOf(tok))},
    {how: 'name', test: (t) => t.names.has(tok.toLowerCase())},
  ]
  for (const step of steps) {
    const hits = pool.filter(step.test)
    if (hits.length === 1) {
      const stored = [...hits[0].ids][0]
      return {target: hits[0], how: step.how, stored: step.how === 'exact' ? undefined : stored}
    }
    if (hits.length > 1) {
      return {problem: `${hits.length} ${to.join('/')} documents match (${hits.map((h) => h.baseId).join(', ')})`}
    }
  }
  return {problem: `no ${to.join('/')} document has this ${REF_MATCH_FIELD}`}
}

function refObject(target: RefTarget, weak: boolean, withKey: boolean): Record<string, any> {
  const ref: Record<string, any> = {_type: 'reference', _ref: target.baseId}
  if (withKey) ref._key = randKey()
  if (weak) ref._weak = true
  else if (!target.hasPublished) {
    // strong field, but the target is still a draft: the same shape Studio writes
    ref._weak = true
    ref._strengthenOnPublish = {type: target.type}
  }
  return ref
}

/* ------------------------------------------------------------------ */
/* plan                                                                */
/* ------------------------------------------------------------------ */

export interface RefIssue {
  field: string
  token: string
  detail: string
}

export interface PlanItem {
  match: string
  baseId?: string // existing document (draft prefix removed)
  hasDraft: boolean
  hasPublished: boolean
  ambiguous?: string // more than one document carries this id
  mintedId?: string // _id to use if the document has to be created
  mintedTaken?: string // ...and why that _id is not free
  fields: Record<string, any> // ready to write: refs resolved, keys injected
  fieldSummary: {name: string; label: string}[]
  unresolved: RefIssue[]
  relabelled: RefIssue[] // matched by code; stored label differs from the JSON
}

export interface FoundDoc {
  _id: string
  _type?: string
  key: string
}

export function buildPlan(opts: {
  records: ParsedRecord[]
  specs: Record<string, FieldSpec>
  found: FoundDoc[]
  takenIds: {_id: string; _type?: string}[]
  refIndex: RefIndex
  matchField: 'id' | '_id'
}): PlanItem[] {
  const {records, specs, found, takenIds, refIndex, matchField} = opts

  // match value -> base _id -> which versions exist
  const docs = new Map<string, Map<string, {draft: boolean; published: boolean}>>()
  for (const d of found) {
    if (!d?._id || d._id.startsWith('versions.') || isLeftoverId(d._id)) continue
    const key = matchField === '_id' ? stripDraft(d.key) : d.key
    const base = stripDraft(d._id)
    if (!docs.has(key)) docs.set(key, new Map())
    const m = docs.get(key)!
    const state = m.get(base) ?? {draft: false, published: false}
    if (d._id.startsWith('drafts.')) state.draft = true
    else state.published = true
    m.set(base, state)
  }
  const taken = new Map(
    takenIds.filter((d) => !isLeftoverId(d._id)).map((d) => [stripDraft(d._id), d._type ?? 'document']),
  )
  const mintedBy = new Map<string, string>() // minted _id -> match value that claimed it

  return records.map((rec) => {
    const key = matchField === '_id' ? stripDraft(rec.match) : rec.match
    const hits = docs.get(key)
    const item: PlanItem = {
      match: rec.match,
      hasDraft: false,
      hasPublished: false,
      fields: {},
      fieldSummary: [],
      unresolved: [],
      relabelled: [],
    }
    if (hits && hits.size > 1) {
      item.ambiguous = [...hits.keys()].join(', ')
    } else if (hits && hits.size === 1) {
      const [base, state] = [...hits.entries()][0]
      item.baseId = base
      item.hasDraft = state.draft
      item.hasPublished = state.published
    } else {
      item.mintedId = matchField === '_id' ? key : mintDocId(rec.match)
      if (!item.mintedId) item.mintedTaken = 'no usable _id can be derived from this match value'
      else if (taken.has(item.mintedId)) {
        item.mintedTaken = `_id "${item.mintedId}" already belongs to a ${taken.get(item.mintedId)} document with a different ${matchField}`
      } else if (mintedBy.has(item.mintedId) && mintedBy.get(item.mintedId) !== rec.match) {
        item.mintedTaken = `_id "${item.mintedId}" is also derived from "${mintedBy.get(item.mintedId)}" in this file`
      } else mintedBy.set(item.mintedId, rec.match)
    }

    for (const [fname, fval] of Object.entries(rec.fields)) {
      const spec = specs[fname]
      if (spec?.ref) {
        const items = Array.isArray(fval) ? fval : [fval]
        const out: Record<string, any>[] = []
        const seenRefs = new Set<string>()
        for (const it of items) {
          if (isRefObject(it)) {
            if (!seenRefs.has(it._ref)) out.push(spec.ref.isArray && !it._key ? {...it, _key: randKey()} : it)
            seenRefs.add(it._ref)
            continue
          }
          const token = String(it)
          const m = matchToken(token, spec.ref.to, refIndex)
          if (!m.target) {
            item.unresolved.push({field: fname, token, detail: m.problem ?? 'not found'})
            continue
          }
          if (m.how === 'code' && m.stored && m.stored.includes(' - ') && m.stored !== token.trim()) {
            item.relabelled.push({field: fname, token, detail: m.stored})
          }
          if (seenRefs.has(m.target.baseId)) continue
          seenRefs.add(m.target.baseId)
          out.push(refObject(m.target, spec.ref.weak, spec.ref.isArray))
        }
        const n = out.length
        // Nothing matched: leave the field alone instead of clearing it.
        const leaveAlone = n === 0 && items.length > 0
        if (!leaveAlone) item.fields[fname] = spec.ref.isArray ? out : out[0]
        item.fieldSummary.push({
          name: fname,
          label: leaveAlone ? `${fname} · no refs matched` : `${fname} · ${n} ref${n === 1 ? '' : 's'}`,
        })
      } else if (Array.isArray(fval)) {
        item.fields[fname] = ensureKeysInArray(fval)
        item.fieldSummary.push({name: fname, label: `${fname} · ${fval.length} blocks`})
      } else {
        item.fields[fname] = fval
        item.fieldSummary.push({name: fname, label: fname})
      }
    }
    return item
  })
}

/* ------------------------------------------------------------------ */
/* which document gets written                                         */
/* ------------------------------------------------------------------ */

export interface WriteDecision {
  action: 'patch' | 'draft-from-published' | 'create' | 'hold'
  writeId?: string
  label: string
  note?: string
}

export function decideWrite(
  item: PlanItem,
  opts: {target: 'published' | 'draft'; createMissing: boolean; skipUnresolved: boolean},
): WriteDecision {
  const {target, createMissing, skipUnresolved} = opts
  if (item.ambiguous) {
    return {action: 'hold', label: `more than one document has this id (${item.ambiguous})`}
  }
  if (item.unresolved.length && !skipUnresolved) {
    const n = item.unresolved.length
    return {action: 'hold', label: `${n} reference${n === 1 ? '' : 's'} could not be matched`}
  }
  if (!item.baseId) {
    if (!createMissing) return {action: 'hold', label: 'no document found (creating is switched off)'}
    if (item.mintedTaken || !item.mintedId) return {action: 'hold', label: item.mintedTaken ?? 'no _id'}
    const writeId = target === 'draft' ? `drafts.${item.mintedId}` : item.mintedId
    return {action: 'create', writeId, label: `new document ${writeId}`}
  }
  if (target === 'draft') {
    const writeId = `drafts.${item.baseId}`
    return item.hasDraft
      ? {action: 'patch', writeId, label: `update ${writeId}`}
      : {action: 'draft-from-published', writeId, label: `update ${writeId} (new draft, copied from published)`}
  }
  if (!item.hasPublished) {
    return {action: 'hold', label: 'only a draft exists — set Write to: Drafts'}
  }
  return {
    action: 'patch',
    writeId: item.baseId,
    label: `update ${item.baseId}`,
    note: item.hasDraft ? 'a draft also exists, and Studio shows the draft' : undefined,
  }
}

export interface Mutation {
  createIfNotExists?: Record<string, any>
  patch: {id: string; set: Record<string, any>}
}

/** Turn the writable part of a plan into mutations. `originals` = published docs by _id. */
export function buildMutations(
  work: {item: PlanItem; d: WriteDecision}[],
  originals: Map<string, Record<string, any>>,
  type: string,
  matchField: string,
): Mutation[] {
  return work.map(({item, d}) => {
    const id = d.writeId as string
    const set: Record<string, any> = {...item.fields}
    let createIfNotExists: Record<string, any> | undefined
    if (d.action === 'create') {
      if (matchField === 'id' && set.id === undefined) set.id = item.match
      createIfNotExists = {_id: id, _type: type}
    } else if (d.action === 'draft-from-published') {
      const original = originals.get(item.baseId as string)
      if (!original) throw new Error(`Published document ${item.baseId} disappeared before the import.`)
      const rest: Record<string, any> = {...original}
      delete rest._rev
      delete rest._updatedAt
      createIfNotExists = {...rest, _id: id}
    }
    return {createIfNotExists, patch: {id, set}}
  })
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function BulkJsonFieldImport() {
  const client = useClient(CLIENT_OPTIONS)
  const schema = useSchema()
  const toast = useToast()

  // Leftover "drafts.drafts.*" documents: looked for when the tool opens and on every resolve.
  const [leftovers, setLeftovers] = useState<LeftoverDoc[]>([])
  const [cleaning, setCleaning] = useState(false)
  const clientRef = useRef(client)
  clientRef.current = client
  const findLeftovers = useCallback(async () => {
    const rows: LeftoverDoc[] = await clientRef.current.withConfig({perspective: 'raw'}).fetch(LEFTOVER_QUERY)
    const real = (rows ?? []).filter((r) => isLeftoverId(r._id))
    setLeftovers(real)
    return real
  }, [])
  useEffect(() => {
    findLeftovers().catch(() => {
      /* the check is a convenience; resolve runs it again and reports failures */
    })
  }, [findLeftovers])

  const [raw, setRaw] = useState('')
  // Document types in this Studio's schema; the last one used is remembered per browser.
  const docTypes = useMemo(() => {
    try {
      return schema
        .getTypeNames()
        .filter((n) => (schema.get(n) as any)?.type?.name === 'document' && !/^(sanity|system|media)\./.test(n))
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }, [schema])
  const [typeName, setTypeNameState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(TYPE_MEMORY_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const setTypeName = useCallback((value: string) => {
    setTypeNameState(value)
    try {
      window.localStorage.setItem(TYPE_MEMORY_KEY, value)
    } catch {
      /* private mode etc. — remembering the type is only a convenience */
    }
  }, [])
  const [matchField, setMatchField] = useState<'id' | '_id'>('id')
  const [target, setTarget] = useState<'published' | 'draft'>('draft')
  const [createMissing, setCreateMissing] = useState(true)
  const [skipUnresolved, setSkipUnresolved] = useState(false)

  const [issues, setIssues] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [plan, setPlan] = useState<PlanItem[] | null>(null)
  const [planFor, setPlanFor] = useState<{typeName: string; matchField: string} | null>(null)
  const [resolving, setResolving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRaw(String(reader.result ?? ''))
    reader.readAsText(file)
  }, [])

  const resolve = useCallback(async () => {
    setPlan(null)
    setProgress(0)
    const type = typeName.trim()
    const docType: any = schema.get(type)
    const specs = docType ? readFieldSpecs(docType) : null
    const {errors, warnings: warns, records} = parseAndValidate(raw, specs, type, matchField)
    setIssues(errors)
    setWarnings(warns)
    if (errors.length || records.length === 0 || !specs) return

    setResolving(true)
    try {
      // Always look at drafts AND published, whatever the Studio client defaults to.
      const rawClient = client.withConfig({perspective: 'raw'})
      await findLeftovers()

      // 1. the documents to write to
      const matches = [...new Set(records.map((r) => r.match))]
      let found: FoundDoc[]
      if (matchField === '_id') {
        const ids = matches.flatMap((m) => [stripDraft(m), `drafts.${stripDraft(m)}`])
        found = await rawClient.fetch(`*[_id in $ids]{_id, _type, "key": _id}`, {ids})
      } else {
        found = await rawClient.fetch(`*[_type == $type && ${matchField} in $matches]{_id, _type, "key": ${matchField}}`, {
          matches,
          type,
        })
      }

      // 2. are the _ids we would mint for unmatched records free?
      const foundKeys = new Set(found.map((d) => (matchField === '_id' ? stripDraft(d.key) : d.key)))
      const minted = records
        .filter((r) => !foundKeys.has(matchField === '_id' ? stripDraft(r.match) : r.match))
        .map((r) => (matchField === '_id' ? stripDraft(r.match) : mintDocId(r.match)))
        .filter(Boolean)
      const takenIds: {_id: string; _type?: string}[] = minted.length
        ? await rawClient.fetch(`*[_id in $ids]{_id, _type}`, {
            ids: minted.flatMap((m) => [m, `drafts.${m}`]),
          })
        : []

      // 3. reference targets, for every reference field that carries id strings
      const refTypes = new Set<string>()
      for (const rec of records) {
        for (const [fname, fval] of Object.entries(rec.fields)) {
          const ref = specs[fname]?.ref
          if (!ref) continue
          const items = Array.isArray(fval) ? fval : [fval]
          if (items.some((it) => typeof it === 'string')) ref.to.forEach((t) => refTypes.add(t))
        }
      }
      const refDocs: RawRefDoc[] = refTypes.size
        ? await rawClient.fetch(`*[_type in $types]{_id, _type, "id": ${REF_MATCH_FIELD}, name, title}`, {
            types: [...refTypes],
          })
        : []

      setPlan(buildPlan({records, specs, found, takenIds, refIndex: buildRefIndex(refDocs), matchField}))
      setPlanFor({typeName: type, matchField})
    } catch (e: any) {
      toast.push({status: 'error', title: 'Resolution failed', description: e.message})
    } finally {
      setResolving(false)
    }
  }, [raw, matchField, typeName, client, schema, toast, findLeftovers])

  const deleteLeftovers = useCallback(async () => {
    setCleaning(true)
    try {
      const current = await findLeftovers() // re-read, and only ever delete ids of the leftover shape
      const ids = current.map((d) => d._id).filter(isLeftoverId)
      for (const batch of chunk(ids, 50)) {
        const tx = clientRef.current.transaction()
        for (const id of batch) tx.delete(id)
        await tx.commit({visibility: 'sync'})
      }
      setPlan(null)
      const left = await findLeftovers()
      toast.push({
        status: left.length ? 'warning' : 'success',
        title: left.length
          ? `${ids.length - left.length} deleted, ${left.length} still there.`
          : `Deleted ${ids.length} leftover document${ids.length === 1 ? '' : 's'}.`,
      })
    } catch (e: any) {
      toast.push({status: 'error', title: 'Delete failed', description: e.message})
    } finally {
      setCleaning(false)
    }
  }, [findLeftovers, toast])

  const decisions = useMemo(
    () => plan?.map((item) => decideWrite(item, {target, createMissing, skipUnresolved})) ?? [],
    [plan, target, createMissing, skipUnresolved],
  )
  const stale = Boolean(plan && planFor && (planFor.typeName !== typeName.trim() || planFor.matchField !== matchField))
  const newCount = decisions.filter((d) => d.action === 'create').length
  const updateCount = decisions.filter((d) => d.action === 'patch' || d.action === 'draft-from-published').length
  const writeCount = newCount + updateCount
  const heldCount = decisions.length - writeCount

  const commit = useCallback(async () => {
    if (!plan || !planFor) return
    const type = planFor.typeName
    const work = plan
      .map((item, i) => ({item, d: decisions[i]}))
      .filter((w) => w.d.action !== 'hold' && w.d.writeId)
    if (work.length === 0) {
      toast.push({status: 'warning', title: 'Nothing to import — every record is held back.'})
      return
    }
    setCommitting(true)
    setProgress(0)
    try {
      const rawClient = client.withConfig({perspective: 'raw'})
      let done = 0
      for (const batch of chunk(work, BATCH_SIZE)) {
        // published originals for drafts that do not exist yet
        const needCopy = batch.filter((w) => w.d.action === 'draft-from-published').map((w) => w.item.baseId as string)
        const originals: Record<string, any>[] = needCopy.length
          ? await rawClient.fetch(`*[_id in $ids]`, {ids: needCopy})
          : []
        const originalById = new Map(originals.map((o) => [o._id, o]))

        const tx = client.transaction()
        for (const m of buildMutations(batch, originalById, type, planFor.matchField)) {
          if (m.createIfNotExists) tx.createIfNotExists(m.createIfNotExists as any)
          tx.patch(m.patch.id, (p) => p.set(m.patch.set))
        }
        await tx.commit({visibility: 'async'})
        done += batch.length
        setProgress(done)
      }
      const made = work.filter((w) => w.d.action === 'create').length
      toast.push({
        status: 'success',
        title: `Imported ${done} document${done === 1 ? '' : 's'}: ${made} new, ${done - made} updated.`,
      })
      setPlan(null)
    } catch (e: any) {
      toast.push({status: 'error', title: 'Commit failed', description: e.message})
    } finally {
      setCommitting(false)
    }
  }, [plan, planFor, decisions, client, toast])

  const unresolved = useMemo(
    () => plan?.flatMap((p) => p.unresolved.map((u) => ({...u, match: p.match}))) ?? [],
    [plan],
  )
  const relabelled = useMemo(
    () => plan?.flatMap((p) => p.relabelled.map((u) => ({...u, match: p.match}))) ?? [],
    [plan],
  )

  return (
    <Box padding={4}>
      <Stack space={4} style={{maxWidth: 920, margin: '0 auto'}}>
        <Stack space={2}>
          <Heading size={3}>Bulk JSON Field Import</Heading>
          <Text size={1} muted>
            Create new documents, or update existing ones, from a JSON array. A record whose match
            value is found updates that document and leaves its other fields untouched; a record
            with no match becomes a new document. Reference fields take id strings and are matched
            on the target&apos;s <code>{REF_MATCH_FIELD}</code> field.
          </Text>
        </Stack>

        {/* leftovers from the earlier draft-prefix bug */}
        {leftovers.length > 0 && (
          <Card padding={3} radius={2} tone="caution">
            <Stack space={3}>
              <Text size={1} weight="semibold">
                {leftovers.length} leftover document{leftovers.length === 1 ? '' : 's'} from an earlier version of this
                tool
              </Text>
              <Text size={1}>
                Their _id starts with “drafts.drafts.”, so Studio lists them as blank duplicates and cannot open or
                delete them. They are ignored by this import. Deleting them does not touch the real documents.
              </Text>
              <Stack space={2}>
                {leftovers.slice(0, 20).map((d) => (
                  <Code key={d._id} size={1}>
                    {`${d._id}  (${d._type ?? 'unknown type'}${d.label ? ` · ${d.label}` : ''})`}
                  </Code>
                ))}
                {leftovers.length > 20 && (
                  <Text size={1} muted>
                    …and {leftovers.length - 20} more
                  </Text>
                )}
              </Stack>
              <Flex>
                <Button
                  icon={cleaning ? Spinner : TrashIcon}
                  text={`Delete ${leftovers.length} leftover document${leftovers.length === 1 ? '' : 's'}`}
                  tone="critical"
                  disabled={cleaning}
                  onClick={deleteLeftovers}
                />
              </Flex>
            </Stack>
          </Card>
        )}

        {/* options */}
        <Card padding={3} radius={2} shadow={1}>
          <Stack space={3}>
            <Flex gap={4} wrap="wrap">
              <Stack space={2}>
                <Label size={1}>Document type</Label>
                {docTypes.length > 0 ? (
                  <Select value={typeName} onChange={(e) => setTypeName(e.currentTarget.value)}>
                    <option value="">Choose…</option>
                    {typeName && !docTypes.includes(typeName) && <option value={typeName}>{typeName}</option>}
                    {docTypes.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <input
                    value={typeName}
                    onChange={(e) => setTypeName(e.currentTarget.value)}
                    style={{padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc', width: 160}}
                  />
                )}
              </Stack>
              <Stack space={2}>
                <Label size={1}>Match on</Label>
                <Select value={matchField} onChange={(e) => setMatchField(e.currentTarget.value as any)}>
                  <option value="id">custom `id` field</option>
                  <option value="_id">`_id`</option>
                </Select>
              </Stack>
              <Stack space={2}>
                <Label size={1}>If no document matches</Label>
                <Select
                  value={createMissing ? 'create' : 'skip'}
                  onChange={(e) => setCreateMissing(e.currentTarget.value === 'create')}
                >
                  <option value="create">Create a new document</option>
                  <option value="skip">Skip the record</option>
                </Select>
              </Stack>
              <Stack space={2}>
                <Label size={1}>Write to</Label>
                <Select value={target} onChange={(e) => setTarget(e.currentTarget.value as any)}>
                  <option value="draft">Drafts</option>
                  <option value="published">Published</option>
                </Select>
              </Stack>
            </Flex>
            <Flex as="label" align="center" gap={2} style={{cursor: 'pointer'}}>
              <Checkbox checked={skipUnresolved} onChange={(e) => setSkipUnresolved(e.currentTarget.checked)} />
              <Text size={1}>Import even if some references can&apos;t be matched (they are left out)</Text>
            </Flex>
          </Stack>
        </Card>

        {/* input */}
        <Stack space={3}>
          <Flex gap={2} align="center">
            <Button
              as="label"
              icon={UploadIcon}
              text="Upload .json"
              mode="ghost"
              tone="primary"
              style={{cursor: 'pointer'}}
            >
              <input type="file" accept="application/json,.json" hidden onChange={handleUpload} />
            </Button>
            <Text size={1} muted>
              or paste below
            </Text>
          </Flex>
          <TextArea
            rows={12}
            value={raw}
            onChange={(e) => setRaw(e.currentTarget.value)}
            placeholder={`[\n  {\n    "match": "BB.WE.fs - West End of the Canal",\n    "fields": {\n      "targetSpecies": ["STB - Striped Bass"],\n      "captMikeNotes": [\n        { "_type": "block", "style": "normal", "children": [\n          { "_type": "span", "text": "The west end of the canal..." }\n        ] }\n      ]\n    }\n  }\n]`}
            style={{fontFamily: 'monospace', fontSize: 12}}
          />
          <Flex gap={2}>
            <Button
              icon={resolving ? Spinner : SearchIcon}
              text="Validate & resolve"
              tone="primary"
              disabled={resolving || !raw.trim() || !typeName.trim()}
              onClick={resolve}
            />
          </Flex>
        </Stack>

        {/* errors / warnings */}
        {issues.length > 0 && (
          <Card padding={3} radius={2} tone="critical">
            <Stack space={2}>
              <Flex align="center" gap={2}>
                <WarningOutlineIcon />
                <Text weight="semibold">{issues.length} error(s)</Text>
              </Flex>
              {issues.slice(0, 30).map((m, i) => (
                <Text key={i} size={1}>
                  {m}
                </Text>
              ))}
            </Stack>
          </Card>
        )}
        {warnings.length > 0 && (
          <Card padding={3} radius={2} tone="caution">
            <Stack space={2}>
              {warnings.slice(0, 20).map((m, i) => (
                <Text key={i} size={1}>
                  {m}
                </Text>
              ))}
            </Stack>
          </Card>
        )}

        {/* plan / dry-run */}
        {plan && (
          <Card padding={3} radius={2} shadow={1}>
            <Stack space={3}>
              <Flex gap={2} align="center" wrap="wrap">
                <Badge tone="positive">{newCount} new</Badge>
                <Badge tone="primary">{updateCount} to update</Badge>
                {heldCount > 0 && <Badge tone="critical">{heldCount} held back</Badge>}
                <Text size={1} muted>
                  {planFor?.typeName} · writing to {target === 'draft' ? 'drafts' : 'published'}
                </Text>
              </Flex>

              {stale && (
                <Card padding={2} radius={2} tone="caution">
                  <Text size={1}>Document type or Match on changed — run Validate &amp; resolve again.</Text>
                </Card>
              )}

              {unresolved.length > 0 && (
                <Card padding={2} radius={2} tone="critical">
                  <Stack space={2}>
                    <Text size={1} weight="semibold">
                      {unresolved.length} reference(s) with no match
                    </Text>
                    {unresolved.slice(0, 40).map((u, i) => (
                      <Text key={i} size={1}>
                        {u.field}: “{u.token}” — {u.detail}
                      </Text>
                    ))}
                  </Stack>
                </Card>
              )}

              {relabelled.length > 0 && (
                <Card padding={2} radius={2} tone="caution">
                  <Stack space={2}>
                    <Text size={1} weight="semibold">
                      {relabelled.length} reference(s) matched by code; the stored label differs
                    </Text>
                    {relabelled.slice(0, 40).map((u, i) => (
                      <Text key={i} size={1}>
                        {u.field}: “{u.token}” → “{u.detail}”
                      </Text>
                    ))}
                  </Stack>
                </Card>
              )}

              <Stack space={2}>
                {plan.slice(0, 50).map((item, i) => {
                  const d = decisions[i]
                  const ok = d.action !== 'hold'
                  return (
                    <Card key={i} padding={2} radius={2} tone={ok ? 'default' : 'transparent'}>
                      <Stack space={2}>
                        <Flex align="center" gap={2} wrap="wrap">
                          {ok ? (
                            <CheckmarkIcon style={{color: 'green'}} />
                          ) : (
                            <WarningOutlineIcon style={{color: '#b04'}} />
                          )}
                          <Text size={1} weight="semibold">
                            {item.match}
                          </Text>
                          <Badge tone={!ok ? 'critical' : d.action === 'create' ? 'positive' : 'primary'}>
                            {d.action === 'create' ? 'NEW · ' : ''}
                            {d.label}
                          </Badge>
                          {d.note && <Badge tone="caution">{d.note}</Badge>}
                        </Flex>
                        <Flex gap={1} wrap="wrap">
                          {item.fieldSummary.map((f) => (
                            <Badge key={f.name} mode="outline" tone="primary">
                              {f.label}
                            </Badge>
                          ))}
                        </Flex>
                      </Stack>
                    </Card>
                  )
                })}
                {plan.length > 50 && (
                  <Text size={1} muted>
                    …and {plan.length - 50} more
                  </Text>
                )}
              </Stack>

              {heldCount > 0 && (
                <Code size={1}>
                  {plan
                    .filter((_, i) => decisions[i].action === 'hold')
                    .slice(0, 50)
                    .map((p) => p.match)
                    .join(', ')}
                </Code>
              )}

              <Flex gap={2} align="center">
                <Button
                  icon={committing ? Spinner : PlayIcon}
                  text={
                    committing
                      ? `Importing… ${progress}/${writeCount}`
                      : `Import — ${newCount} new, ${updateCount} updated`
                  }
                  tone="positive"
                  disabled={committing || writeCount === 0 || stale}
                  onClick={commit}
                />
              </Flex>
            </Stack>
          </Card>
        )}
      </Stack>
    </Box>
  )
}

export const bulkJsonFieldImportTool = {
  name: 'bulk-json-field-import',
  title: 'Bulk JSON Field Import',
  icon: UploadIcon,
  component: BulkJsonFieldImport,
}

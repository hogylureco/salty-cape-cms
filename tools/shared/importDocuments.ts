/**
 * The import write path shared by the Bulk JSON Field Import tool and the Word doc importer.
 *
 * Records ({match, fields}) are matched on the custom `id` field (or `_id`) of the chosen type:
 *   - found      -> the listed fields are PATCHED in; every other field is left intact
 *   - not found  -> a new document is created with those fields
 *
 * See bulkJsonFieldImportTool.tsx for the full description of matching, reference resolution
 * and which version (draft / published) gets written.
 */

import type {SanityClient} from 'sanity'

export const API_VERSION = '2024-10-01'
// Custom field that holds the business id ("CODE - Label") on reference targets.
export const REF_MATCH_FIELD = 'id'
export const BATCH_SIZE = 25

/* ------------------------------------------------------------------ */
/* id + key utilities                                                  */
/* ------------------------------------------------------------------ */

export function randKey(len = 12): string {
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

export function chunk<T>(arr: T[], size: number): T[][] {
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

export interface RefTarget {
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

export function refObject(target: RefTarget, weak: boolean, withKey: boolean): Record<string, any> {
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
/* resolve + commit                                                    */
/* ------------------------------------------------------------------ */

/**
 * Look up everything a plan needs — the documents to write to, whether minted _ids are free,
 * and the reference targets — and build the plan. Reads drafts AND published, whatever the
 * Studio client defaults to.
 */
export async function resolveImport(
  client: SanityClient,
  opts: {records: ParsedRecord[]; specs: Record<string, FieldSpec>; type: string; matchField: 'id' | '_id'},
): Promise<PlanItem[]> {
  const {records, specs, type, matchField} = opts
  const rawClient = client.withConfig({perspective: 'raw'})

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

  return buildPlan({records, specs, found, takenIds, refIndex: buildRefIndex(refDocs), matchField})
}

/** Write the non-held part of a plan in batches. Returns how many documents were written / created. */
export async function commitImport(
  client: SanityClient,
  opts: {
    work: {item: PlanItem; d: WriteDecision}[]
    type: string
    matchField: string
    onProgress?: (done: number) => void
  },
): Promise<{done: number; made: number}> {
  const {work, type, matchField, onProgress} = opts
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
    for (const m of buildMutations(batch, originalById, type, matchField)) {
      if (m.createIfNotExists) tx.createIfNotExists(m.createIfNotExists as any)
      tx.patch(m.patch.id, (p) => p.set(m.patch.set))
    }
    await tx.commit({visibility: 'async'})
    done += batch.length
    onProgress?.(done)
  }
  return {done, made: work.filter((w) => w.d.action === 'create').length}
}

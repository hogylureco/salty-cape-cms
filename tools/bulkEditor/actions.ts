/**
 * Write side of the Bulk Editor: Actions API payloads, built purely so they can be tested.
 *
 * Every edit is a `sanity.action.document.edit` on `drafts.<id>`. The Content Lake creates the
 * draft from the published document first when no draft exists, so nothing here ever patches a
 * published document directly.
 */
import type {ColumnDef} from './schemaColumns.ts'

export const TRANSACTION_CHUNK = 100

export interface RefValue {
  _key?: string
  _ref: string
  _weak?: boolean
}

export interface DocStatus {
  draft: boolean
  published: boolean
}

export type PatchOperations = {set?: Record<string, unknown>; unset?: string[]}

export const publishedIdOf = (id: string) => id.replace(/^drafts\./, '')
export const draftIdOf = (id: string) => `drafts.${publishedIdOf(id)}`

export function randomKey(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** Draft/published presence per published id, from the raw-perspective list of `_id`s. */
export function statusFromIds(ids: string[]): Map<string, DocStatus> {
  const map = new Map<string, DocStatus>()
  for (const id of ids) {
    if (id.startsWith('versions.')) continue
    const base = publishedIdOf(id)
    const s = map.get(base) ?? {draft: false, published: false}
    if (id.startsWith('drafts.')) s.draft = true
    else s.published = true
    map.set(base, s)
  }
  return map
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

const refOf = (col: ColumnDef, _ref: string, _key?: string): RefValue => ({
  ...(_key ? {_key} : {}),
  _ref,
  ...(col.weak ? {_weak: true} : {}),
})

/**
 * Turn an editor value into a patch plus the value the grid row should show meanwhile.
 * Editor values: scalars as-is, slug as its `current` string, reference as an id,
 * reference arrays and string arrays as arrays. Empty values unset the field.
 * Returns null when nothing changed.
 */
export function buildEdit(
  col: ColumnDef,
  next: unknown,
  prev: unknown,
): {patch: PatchOperations; rowValue: unknown} | null {
  const k = col.key
  if (isEmpty(next)) return isEmpty(prev) ? null : {patch: {unset: [k]}, rowValue: null}

  switch (col.kind) {
    case 'slug':
      if (next === prev) return null
      return {patch: {set: {[k]: {_type: 'slug', current: next}}}, rowValue: next}
    case 'reference': {
      const prevRef = (prev as RefValue | null)?._ref
      if (next === prevRef) return null
      const ref = refOf(col, next as string)
      return {patch: {set: {[k]: {_type: 'reference', ...ref}}}, rowValue: ref}
    }
    case 'referenceArray': {
      const prevItems = (Array.isArray(prev) ? prev : []) as RefValue[]
      const ids = next as string[]
      if (ids.length === prevItems.length && ids.every((id, i) => prevItems[i]?._ref === id)) return null
      // Keep the _key of refs that stay, so Studio's array editing and history line up.
      const keyByRef = new Map(prevItems.map((r) => [r._ref, r._key]))
      const items = ids.map((id) => refOf(col, id, keyByRef.get(id) ?? randomKey()))
      return {patch: {set: {[k]: items.map((r) => ({_type: 'reference', ...r}))}}, rowValue: items}
    }
    case 'stringArray':
    case 'stringListArray': {
      const prevArr = Array.isArray(prev) ? prev : []
      const arr = next as string[]
      if (arr.length === prevArr.length && arr.every((v, i) => v === prevArr[i])) return null
      return {patch: {set: {[k]: arr}}, rowValue: arr}
    }
    default:
      if (next === prev) return null
      return {patch: {set: {[k]: next}}, rowValue: next}
  }
}

/** Patch for "Set field value" across many documents, whose current values aren't loaded. */
export function bulkPatch(col: ColumnDef, value: unknown): PatchOperations {
  if (isEmpty(value)) return {unset: [col.key]}
  return buildEdit(col, value, undefined)!.patch
}

export function editAction(id: string, patch: PatchOperations) {
  return {
    actionType: 'sanity.action.document.edit' as const,
    draftId: draftIdOf(id),
    publishedId: publishedIdOf(id),
    patch,
  }
}

export function publishAction(id: string) {
  return {actionType: 'sanity.action.document.publish' as const, draftId: draftIdOf(id), publishedId: publishedIdOf(id)}
}

export function unpublishAction(id: string) {
  return {actionType: 'sanity.action.document.unpublish' as const, draftId: draftIdOf(id), publishedId: publishedIdOf(id)}
}

/** Deletes the published document and its draft. */
export function deleteAction(id: string, status: DocStatus | undefined) {
  return {
    actionType: 'sanity.action.document.delete' as const,
    publishedId: publishedIdOf(id),
    includeDrafts: status?.draft ? [draftIdOf(id)] : [],
  }
}

export type BulkKind = 'publish' | 'unpublish' | 'delete'

/** Which of the selected ids an action applies to; the rest are reported as skipped. */
export function planBulk(kind: BulkKind, ids: string[], status: Map<string, DocStatus>) {
  const applies = (id: string) => {
    const s = status.get(publishedIdOf(id))
    if (kind === 'publish') return Boolean(s?.draft) // nothing to publish without a draft
    if (kind === 'unpublish') return Boolean(s?.published)
    return Boolean(s?.draft || s?.published)
  }
  const targets = ids.filter(applies)
  const actions = targets.map((id) =>
    kind === 'publish'
      ? publishAction(id)
      : kind === 'unpublish'
        ? unpublishAction(id)
        : deleteAction(id, status.get(publishedIdOf(id))),
  )
  return {targets, actions, skipped: ids.length - targets.length}
}

export function chunk<T>(items: T[], size = TRANSACTION_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

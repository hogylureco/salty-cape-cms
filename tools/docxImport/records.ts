// Parsed spots -> the bulk-fields records ({_type, match, fields}) the shared import path and
// the Bulk JSON Field Import tool both consume.
import {codeOf} from '../shared/importDocuments.ts'
import {PENDING_UPLOAD} from './htmlToPortableText.ts'

export const DEFAULT_VERSION = 'v3.1'

// The third segment of the code is the spot type: "BB.WE.fs" -> fs.
const SPOT_TYPES: Record<string, string> = {
  fs: 'fs-featured-spot',
  fx: 'fx-spot-playbook-approach',
  br: 'br-boat-ramp',
  fl: 'fl-featured-loop',
}

export function spotTypeFromId(id: string): string {
  const seg = codeOf(id).split('.')[2]?.toLowerCase() ?? ''
  return SPOT_TYPES[seg] ?? ''
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/, '')
}

/** Existing spots use "<region slug>-<name>", e.g. cape-cod-bay-brewster-flats. */
export function defaultSlug(id: string, name: string, regionSlugs: Map<string, string>): string {
  const region = regionSlugs.get(codeOf(id).split('.')[0] ?? '')
  return slugify(region ? `${region} ${name}` : name)
}

export interface SpotMeta {
  name: string
  slug: string
  spotType: string
  version: string
}

export const META_FIELDS = ['name', 'slug', 'spotType', 'version'] as const

export interface SpotRecord {
  _type: 'spot'
  match: string
  fields: Record<string, any>
}

/** `withMeta: false` for spots that already exist: only the narrative fields are patched. */
export function toRecord(id: string, meta: SpotMeta, narratives: Record<string, any[]>, withMeta: boolean): SpotRecord {
  const fields: Record<string, any> = {}
  if (withMeta) {
    fields.name = meta.name
    fields.slug = {_type: 'slug', current: meta.slug}
    fields.spotType = meta.spotType
    fields.version = meta.version
  }
  Object.assign(fields, narratives)
  return {_type: 'spot', match: id, fields}
}

/** Remove blocks still waiting for an upload (for the downloadable JSON, which cannot carry them). */
export function withoutPendingImages(blocks: any[]): {blocks: any[]; dropped: number} {
  const kept = blocks.filter((b) => !(b && b[PENDING_UPLOAD]))
  return {blocks: kept, dropped: blocks.length - kept.length}
}

// Parsed spots -> the bulk-fields records ({_type, match, fields}) the shared import path and
// the Bulk JSON Field Import tool both consume.
import {codeOf} from '../shared/importDocuments.ts'
import {PENDING_UPLOAD} from './htmlToPortableText.ts'

export const DEFAULT_VERSION = 'v3.1'

// The third segment of the code is the spot type: "BB.WE.fs" -> fs.
export const SPOT_TYPES: Record<string, string> = {
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

export interface SpotRecord {
  _type: 'spot'
  match: string
  fields: Record<string, any>
}

/** `fields`: what the review screen says to write — the chosen field-table values, then the narratives. */
export function toRecord(id: string, fields: Record<string, any>, narratives: Record<string, any[]>): SpotRecord {
  return {_type: 'spot', match: id, fields: {...fields, ...narratives}}
}

/** Remove blocks still waiting for an upload (for the downloadable JSON, which cannot carry them). */
export function withoutPendingImages(blocks: any[]): {blocks: any[]; dropped: number} {
  const kept = blocks.filter((b) => !(b && b[PENDING_UPLOAD]))
  return {blocks: kept, dropped: blocks.length - kept.length}
}

// The "Field | Value" table at the top of a spot doc ("★ 6.  Latitude | 41.7369"): reading its
// rows, mapping each label to a spot field, and turning each value into what that field stores.
// Reference values ("STB - Striped Bass; BLF - Bluefish") are resolved against the dataset here,
// so the review screen can show what each one matched before anything is written.
import {codeOf, refObject, type FieldSpec, type RefIndex, type RefTarget} from '../shared/importDocuments.ts'
import {fkey} from './splitSections.ts'

export interface DocFieldRow {
  num: string // "6", "15a"; '' when the label has no number
  label: string // "Latitude", without the star and number
  required: boolean // starred in the doc
  text: string // the value as written; '' for blanks and "x" placeholders
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const LABEL_RE = /^[★*☆]?\s*(\d+[a-z]?)\.\s*(.+)$/i

function rowsOf(table: Element): Element[][] {
  return Array.from(table.querySelectorAll('tr'))
    .filter((tr) => tr.closest('table') === table)
    .map((tr) => Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'))
}

const isHeaderRow = (cells: Element[]) =>
  cells.length === 2 && fkey(clean(cells[0].textContent)) === 'field' && fkey(clean(cells[1].textContent)).startsWith('value')

/** A 2-column table headed "Field | Value", or one whose labels are mostly numbered ("6. Latitude"). */
export function isFieldTable(table: Element): boolean {
  const rows = rowsOf(table)
  if (rows.some(isHeaderRow)) return true
  const pairs = rows.filter((r) => r.length === 2)
  const numbered = pairs.filter((r) => LABEL_RE.test(clean(r[0].textContent))).length
  return numbered >= 3 && numbered / pairs.length >= 0.5
}

// "x", "x  (auto-resolved from approaches refs)", "TBD": nothing to import.
export function isPlaceholder(text: string): boolean {
  const t = text.trim()
  return !t || /^x(\s|\(|$)/i.test(t) || /^(tbd|n\/?a|none|[-–—])$/i.test(t)
}

export function readFieldTable(table: Element): DocFieldRow[] {
  const out: DocFieldRow[] = []
  for (const cells of rowsOf(table)) {
    // section dividers ("— Geo —") and notes span both columns
    if (cells.length !== 2 || isHeaderRow(cells)) continue
    const raw = clean(cells[0].textContent)
    const m = raw.match(LABEL_RE)
    const label = clean((m ? m[2] : raw).replace(/^[★*☆]\s*/, ''))
    if (!label) continue
    const value = clean(cells[1].textContent)
    out.push({num: m?.[1] ?? '', label, required: /^[★*]/.test(raw), text: isPlaceholder(value) ? '' : value})
  }
  return out
}

/* ------------------------------------------------------------------ */
/* label -> field                                                      */
/* ------------------------------------------------------------------ */

// Labels in the doc that differ from the schema's field names and titles.
const LABEL_ALIASES: Record<string, string> = {
  posttype: 'spotType', // "Post Type: Approach" is the spot type; the schema's postType is spot/guide/report
  spottype: 'spotType',
  microseason: 'microSeason',
  microseasons: 'microSeason',
  lurecatalog: 'lureCatalog',
  lurecatalogfield: 'lureCatalog',
  subspots: 'subSpotsFXApproaches',
  fxapproaches: 'subSpotsFXApproaches',
}

/** fkey(label) -> field name, from the aliases, then the schema's field names and titles. */
export function buildLabelMap(fields: {name: string; title?: string}[]): Map<string, string> {
  const map = new Map<string, string>()
  const names = new Set(fields.map((f) => f.name))
  for (const f of fields) {
    for (const label of [f.title, f.name]) if (label && !map.has(fkey(label))) map.set(fkey(label), f.name)
  }
  for (const [key, field] of Object.entries(LABEL_ALIASES)) if (names.has(field)) map.set(key, field)
  return map
}

/* ------------------------------------------------------------------ */
/* values                                                              */
/* ------------------------------------------------------------------ */

export interface OptionItem {
  title?: string
  value: string
}

export type FieldKind = 'string' | 'number' | 'datetime' | 'slug' | 'strings' | 'ref' | 'unsupported'

export interface FieldInfo {
  name: string
  title: string
  kind: FieldKind
  spec: FieldSpec
  options?: OptionItem[]
}

/** What kind of value a field takes, read from the compiled schema type. */
export function fieldInfo(field: any, spec: FieldSpec): FieldInfo {
  const t = field.type
  const list = (t?.options?.list ?? t?.of?.[0]?.options?.list) as (OptionItem | string)[] | undefined
  const options = list?.map((o) => (typeof o === 'string' ? {value: o, title: o} : o))
  let kind: FieldKind = 'unsupported'
  if (spec.ref) kind = 'ref'
  else if (spec.typeName === 'slug') kind = 'slug'
  else if (spec.jsonType === 'number') kind = 'number'
  else if (spec.typeName === 'datetime' || spec.typeName === 'date') kind = 'datetime'
  else if (spec.jsonType === 'string') kind = 'string'
  else if (spec.jsonType === 'array' && spec.allowsStrings && !spec.memberNames?.some((n) => n !== 'string')) kind = 'strings'
  return {name: field.name, title: t?.title ?? field.title ?? field.name, kind, spec, options}
}

/** "a; b; c" -> [a, b, c]. Without semicolons, commas outside brackets separate the items. */
export function splitList(text: string): string[] {
  if (text.includes(';')) return text.split(';').map(clean).filter(Boolean)
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map(clean).filter(Boolean)
}

/** A list option by value, title, or a title that uniquely contains the text ("Approach"). */
export function matchOption(text: string, options: OptionItem[]): OptionItem | undefined {
  const k = fkey(text)
  if (!k) return undefined
  const exact = options.find((o) => fkey(o.value) === k || fkey(o.title ?? '') === k)
  if (exact) return exact
  const partial = options.filter((o) => fkey(o.title ?? o.value).includes(k))
  return partial.length === 1 ? partial[0] : undefined
}

export function parseNumber(text: string): number | undefined {
  const m = text.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : undefined
}

/* ------------------------------------------------------------------ */
/* references                                                          */
/* ------------------------------------------------------------------ */

export interface RefResolution {
  token: string
  target?: RefTarget
  how?: string // which rule matched, shown when it was not an exact id
  candidates: RefTarget[] // more than one document fits; the user picks
}

export const targetLabel = (t: RefTarget) => [...t.ids][0] ?? [...t.names][0] ?? t.baseId
const labelOf = (v: string) => (v.includes(' - ') ? v.slice(v.indexOf(' - ') + 3).trim() : v.trim())
const TYPE_SEGMENTS = new Set(['fs', 'fx', 'br', 'fl', 'ms'])

/**
 * Resolve one value to a document of the `to` types. Tries, in order: the exact id, the same code
 * before " - ", a name, the label after " - " (codes differ between sheets: "BR.BB.MON.BR -
 * Monument Beach Ramp" is stored as "BB.MB.br - Monument Beach Ramp"), and a code that is the
 * start of a regional one ("703" -> "703.BB.ms - …", narrowed by the spot's `region`).
 * "Bird Island (BB.MM.fs - Marion …)" is also tried as the id in brackets.
 */
export function resolveRef(token: string, to: string[], index: RefIndex, region = ''): RefResolution {
  const pool = [...index.values()].filter((t) => to.includes(t.type))
  const bracket = token.match(/\(([^()]+ - [^()]+)\)/)?.[1]
  const variants = [token.trim(), ...(bracket ? [bracket.trim(), token.slice(0, token.indexOf('(')).trim()] : [])].filter(Boolean)
  const reg = region.toLowerCase()
  const inRegion = (t: RefTarget) => [...t.ids].some((v) => codeOf(v).toLowerCase().split('.').includes(reg))
  let candidates: RefTarget[] = []

  for (const v of variants) {
    const code = codeOf(v)
    const lower = v.toLowerCase()
    const label = labelOf(v).toLowerCase()
    const steps: [string, (t: RefTarget) => boolean][] = [
      ['id', (t) => t.ids.has(v)],
      ['code', (t) => v.includes(' - ') && [...t.ids].some((x) => codeOf(x) === code)],
      ['code', (t) => !v.includes(' ') && [...t.ids].some((x) => codeOf(x) === code)],
      ['name', (t) => t.names.has(lower)],
      // a regional version for the spot's own region beats a generic one with the same label
      ['regional code', (t) => Boolean(reg) && inRegion(t) && [...t.ids].some((x) => codeOf(x).startsWith(`${code}.`))],
      ['label',(t) => Boolean(label) && (t.names.has(label) || [...t.ids].some((x) => labelOf(x).toLowerCase() === label))],
      ['regional code', (t) => [...t.ids].some((x) => codeOf(x).startsWith(`${code}.`))],
    ]
    for (const [how, test] of steps) {
      let hits = pool.filter(test)
      if (hits.length > 1 && reg) {
        const local = hits.filter(inRegion)
        if (local.length) hits = local
      }
      if (hits.length === 1) return {token, target: hits[0], how: how === 'id' ? undefined : how, candidates: []}
      if (hits.length > 1 && !candidates.length) candidates = hits
    }
  }
  candidates.sort((a, b) => targetLabel(a).localeCompare(targetLabel(b)))
  return {token, candidates}
}

/* ------------------------------------------------------------------ */
/* one row -> one field value                                          */
/* ------------------------------------------------------------------ */

export interface ConvertedValue {
  value?: any // undefined: nothing to write
  refs?: RefResolution[]
  problems: string[]
}

/**
 * `picks` chooses a document for a value that matched several (token index -> _id).
 * Unmatched reference values are left out and reported; they never block the rest.
 */
export function convertValue(
  text: string,
  info: FieldInfo,
  ctx: {index: RefIndex | null; region?: string; picks?: Record<number, string>},
): ConvertedValue {
  const problems: string[] = []
  const t = clean(text)
  if (!t) return {problems}
  switch (info.kind) {
    case 'number': {
      const n = parseNumber(t)
      return n === undefined ? {problems: [`"${t}" is not a number.`]} : {value: n, problems}
    }
    case 'datetime': {
      const d = new Date(t)
      return Number.isNaN(d.getTime()) ? {problems: [`"${t}" is not a date.`]} : {value: d.toISOString(), problems}
    }
    case 'slug':
      return {value: {_type: 'slug', current: t}, problems}
    case 'string': {
      if (!info.options?.length) return {value: t, problems}
      const o = matchOption(t, info.options)
      return o ? {value: o.value, problems} : {problems: [`"${t}" is not one of: ${info.options.map((x) => x.title ?? x.value).join(', ')}.`]}
    }
    case 'strings': {
      const items = splitList(t)
      if (!info.options?.length) return {value: items, problems}
      const values: string[] = []
      for (const item of items) {
        const o = matchOption(item, info.options)
        if (o) values.push(o.value)
        else problems.push(`"${item}" is not one of: ${info.options.map((x) => x.title ?? x.value).join(', ')}.`)
      }
      return {value: values.length ? [...new Set(values)] : undefined, problems}
    }
    case 'ref': {
      const ref = info.spec.ref!
      if (!ctx.index) return {problems: ['Still loading the documents to match against…']}
      const tokens = ref.isArray ? splitList(t) : [t]
      const refs = tokens.map((tok) => resolveRef(tok, ref.to, ctx.index!, ctx.region))
      const out: any[] = []
      const seen = new Set<string>()
      refs.forEach((r, i) => {
        const picked = ctx.picks?.[i]
        const target = r.target ?? (picked ? r.candidates.find((c) => c.baseId === picked) : undefined)
        if (!target) {
          problems.push(
            r.candidates.length
              ? `"${r.token}" matches ${r.candidates.length} ${ref.to.join('/')} documents — pick one, or it is left out.`
              : `"${r.token}": no ${ref.to.join('/')} document found — left out.`,
          )
          return
        }
        if (seen.has(target.baseId)) return
        seen.add(target.baseId)
        out.push(refObject(target, ref.weak, ref.isArray))
      })
      if (!out.length) return {refs, problems}
      return {value: ref.isArray ? out : out[0], refs, problems}
    }
    default:
      return {problems: [`The ${info.title} field cannot be set from the table.`]}
  }
}

/* ------------------------------------------------------------------ */
/* spot ids                                                            */
/* ------------------------------------------------------------------ */

// "BB.WE.fx.B.C1" and "BB.WE.B.C1" are the same spot: compare codes without the type segment.
export function looseCode(id: string): string {
  return codeOf(id)
    .toLowerCase()
    .split('.')
    .filter((s) => !TYPE_SEGMENTS.has(s))
    .join('.')
}

/** Put the spot-type segment into a code that lacks it: ("BB.WE.B.C1 - X", "fx") -> "BB.WE.fx.B.C1 - X". */
export function withTypeSegment(id: string, typeCode: string): string {
  const code = codeOf(id)
  const parts = code.split('.')
  if (!typeCode || parts.length < 2 || parts.some((p) => TYPE_SEGMENTS.has(p.toLowerCase()))) return id
  const fixed = [...parts.slice(0, 2), typeCode, ...parts.slice(2)].join('.')
  return fixed + id.slice(code.length)
}

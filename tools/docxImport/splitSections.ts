// Mammoth HTML -> one entry per spot. Each H1 starts a spot; each H2 starts a section whose
// heading is resolved to a schema field through fkey(). Unrecognised headings keep their content
// in `unmatched` so it can be shown, never dropped. A "Field | Value" table (fieldTable.ts) carries
// the spot's other fields and opens a new spot.
import {isFieldTable, readFieldTable, type DocFieldRow} from './fieldTable.ts'

// Never NFKC here: it turns "™" into "TM" and breaks matches.
export const fkey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

export const NARRATIVE_FIELDS = [
  'captMikeNotes',
  'historicalAnalysis',
  'environmentalFactors',
  'observationalFactors',
  'structureApproach',
  'gearTechnique',
  'QAcaptMike',
] as const

// Headings Mike might write, beyond the field names and schema titles (added in buildFieldMap).
const ALIASES: Record<string, string[]> = {
  captMikeNotes: ["Capt. Mike's Notes", 'Capt Mike Notes', "Captain Mike's Notes", 'Captain Mike Notes', "Mike's Notes"],
  historicalAnalysis: ['Historical Analysis', 'Step 1 Historical Analysis'],
  environmentalFactors: ['Environmental Factors', 'Step 2 Environmental Factors'],
  observationalFactors: ['Observational Factors', 'Step 3 Observational Factors'],
  structureApproach: [
    'Structure & Approach',
    'Structure and Approach',
    'Step 4 Structure & Approach',
    'Step 4 Structure and Approach',
  ],
  gearTechnique: ['Gear & Technique', 'Gear and Technique', 'Step 5 Gear & Technique', 'Step 5 Gear and Technique'],
  QAcaptMike: [
    'Q&A with Capt. Mike',
    'Q&A with Captain Mike',
    'Q and A with Capt Mike',
    'Q&A Capt Mike',
    'Questions & Answers with Capt. Mike',
    'Q&A',
  ],
}

/** fkey(heading) -> field name. `titles` are the schema titles ("Step 1 - Historical Analysis"). */
export function buildFieldMap(titles: Record<string, string | undefined> = {}): Map<string, string> {
  const map = new Map<string, string>()
  for (const field of NARRATIVE_FIELDS) {
    for (const label of [field, titles[field], ...(ALIASES[field] ?? [])]) {
      if (label && fkey(label)) map.set(fkey(label), field)
    }
  }
  return map
}

// "BB.WE.fs - West End of the Canal": a dotted code, " - ", a label.
const ID_RE = /^([A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)+)\s+[-–—]\s+(.+)$/

export function parseHeadingId(text: string): {id: string; code: string; label: string} | null {
  const m = text.trim().replace(/\s+/g, ' ').match(ID_RE)
  if (!m) return null
  // stored ids always use a plain hyphen
  return {id: `${m[1]} - ${m[2].trim()}`, code: m[1], label: m[2].trim()}
}

export interface SplitDoc {
  title: string // the H1 text
  id: string // '' when neither the field table nor the H1 gives a "CODE - Label" id
  meta: DocFieldRow[] // rows of the "Field | Value" table, without the ID row
  sections: Record<string, string> // field -> HTML
  unmatched: {heading: string; html: string}[]
}

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * The field a section heading belongs to: an exact match, else the longest known heading the
 * text ends with or contains ("Salty System Part 1: The Pattern Layer™ — Historical Analysis").
 * Short keys ("qa") only ever match exactly.
 */
export function matchHeading(heading: string, fieldMap: Map<string, string>): string | undefined {
  const k = fkey(heading)
  if (!k) return undefined
  const exact = fieldMap.get(k)
  if (exact) return exact
  let best: [string, string] | undefined
  for (const [key, field] of fieldMap) {
    if (key.length < 8 || !k.includes(key)) continue
    if (!best || key.length > best[0].length) best = [key, field]
  }
  return best?.[1]
}

// Word docs often put a section banner in a one-cell table; the heading inside is the section.
function blockElements(body: Element): Element[] {
  const out: Element[] = []
  for (const el of Array.from(body.children)) {
    if (el.tagName === 'TABLE') {
      const cells = Array.from(el.querySelectorAll('td, th'))
      if (cells.length === 1 && cells[0].querySelector('h1, h2, h3')) {
        out.push(...Array.from(cells[0].children))
        continue
      }
    }
    out.push(el)
  }
  return out
}

const isIdLabel = (label: string) => fkey(label) === 'id'

export function splitSections(html: string, fieldMap: Map<string, string>, doc?: Document): SplitDoc[] {
  const dom = doc ?? new DOMParser().parseFromString(html, 'text/html')
  const out: SplitDoc[] = []
  let cur: SplitDoc | null = null
  // where content goes: a field, or an index into cur.unmatched
  let target: {field: string} | {unmatched: number} | null = null

  const startDoc = (title: string) => {
    const parsed = parseHeadingId(title)
    cur = {title, id: parsed?.id ?? '', meta: [], sections: {}, unmatched: []}
    out.push(cur)
    target = null
  }
  const addUnmatched = (d: SplitDoc, heading: string) => {
    d.unmatched.push({heading, html: ''})
    target = {unmatched: d.unmatched.length - 1}
  }
  const hasContent = (d: SplitDoc) => d.meta.length > 0 || Object.keys(d.sections).length > 0 || d.unmatched.length > 0

  for (const el of blockElements(dom.body)) {
    const tag = el.tagName
    const c = cur as SplitDoc | null
    if (tag === 'TABLE' && isFieldTable(el)) {
      // The field table opens a spot, unless the spot so far is only its H1.
      if (!c || hasContent(c)) startDoc('')
      const d = cur as unknown as SplitDoc
      const rows = readFieldTable(el)
      const idRow = rows.find((r) => isIdLabel(r.label))
      const parsed = idRow ? parseHeadingId(idRow.text) : null
      if (parsed) d.id = parsed.id
      else if (idRow?.text) d.id = idRow.text
      d.meta = rows.filter((r) => r !== idRow)
      target = null
      continue
    }
    if (tag === 'H1') {
      // A doc that opens with its field table has its H1 further down: that is its title, and
      // inside a section it is also part of the section's text.
      if (c && !c.title && c.meta.length) {
        c.title = text(el)
        if (!c.id) c.id = parseHeadingId(c.title)?.id ?? ''
        if (!target) continue
      } else {
        startDoc(text(el))
        continue
      }
    }
    if (!cur) {
      if (!text(el) && !el.querySelector('img, table')) continue
      startDoc('') // content before any H1: one spot whose id the user fills in
    }
    const d = cur as unknown as SplitDoc
    if (tag === 'H2') {
      const heading = text(el)
      const field = matchHeading(heading, fieldMap)
      if (field) target = {field}
      else addUnmatched(d, heading)
      continue
    }
    if (!target) {
      if (!text(el) && !el.querySelector('img, table')) continue
      addUnmatched(d, '(before the first section heading)')
    }
    const t = target as {field: string} | {unmatched: number}
    if ('field' in t) d.sections[t.field] = (d.sections[t.field] ?? '') + el.outerHTML
    else d.unmatched[t.unmatched].html += el.outerHTML
  }
  return out
}

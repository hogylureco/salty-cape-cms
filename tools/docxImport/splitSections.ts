// Mammoth HTML -> one entry per spot. Each H1 starts a spot; each H2 starts a section whose
// heading is resolved to a schema field through fkey(). Unrecognised headings keep their content
// in `unmatched` so it can be shown, never dropped.

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
  id: string // '' when the H1 is not in "CODE - Label" form
  sections: Record<string, string> // field -> HTML
  unmatched: {heading: string; html: string}[]
}

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

export function splitSections(html: string, fieldMap: Map<string, string>, doc?: Document): SplitDoc[] {
  const dom = doc ?? new DOMParser().parseFromString(html, 'text/html')
  const out: SplitDoc[] = []
  let cur: SplitDoc | null = null
  // where content goes: a field, or an index into cur.unmatched
  let target: {field: string} | {unmatched: number} | null = null

  const startDoc = (title: string) => {
    const parsed = parseHeadingId(title)
    cur = {title, id: parsed?.id ?? '', sections: {}, unmatched: []}
    out.push(cur)
    target = null
  }
  const addUnmatched = (d: SplitDoc, heading: string) => {
    d.unmatched.push({heading, html: ''})
    target = {unmatched: d.unmatched.length - 1}
  }

  for (const el of Array.from(dom.body.children)) {
    const tag = el.tagName
    if (tag === 'H1') {
      startDoc(text(el))
      continue
    }
    if (!cur) {
      if (!text(el) && !el.querySelector('img, table')) continue
      startDoc('') // content before any H1: one spot whose id the user fills in
    }
    const d = cur as unknown as SplitDoc
    if (tag === 'H2') {
      const heading = text(el)
      const field = fieldMap.get(fkey(heading))
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

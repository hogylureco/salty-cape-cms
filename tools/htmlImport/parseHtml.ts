// Step 1 of the HTML import: an uploaded spot HTML file -> a plain JSON description of it.
// Nothing here knows about the Sanity schema; mapHtmlDoc.ts turns this JSON into spot fields.
//
// The files look like BB_WE_fs_West_End_of_the_Canal_v19.html: <title> and <meta name="sc-*">
// in the head, an H2 per Salty System part, H3/H4 inside them, and a "Field | Value" table
// (under an H3 "Meta Block") carrying the spot's other fields.
import {isFieldTable, readFieldTable, type DocFieldRow} from '../docxImport/fieldTable.ts'

export const HTML_JSON_FORMAT = 'salty-cape-spot-html/1'

export interface OutlineEntry {
  level: number // 3 for H3, 4 for H4 …
  anchor: string // the heading's id attribute, '' when it has none
  heading: string
}

export interface HtmlSection {
  anchor: string
  heading: string // the H2 text
  html: string // everything after the H2 up to the next one, minus the field table
  outline: OutlineEntry[] // the sub-headings inside it, for reviewing the JSON
}

export interface HtmlDocJson {
  format: typeof HTML_JSON_FORMAT
  fileName: string
  title: string // <title>, else the first H1
  meta: Record<string, string> // <meta name="…" content="…">, e.g. sc-id, sc-version, sc-source
  fieldTable: {heading: string; rows: DocFieldRow[]} | null
  preamble: string // HTML before the first H2
  sections: HtmlSection[]
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const isHeading = (el: Element) => /^H[3-6]$/.test(el.tagName)

/** Parse HTML text into a Document: the browser's DOMParser unless one is passed (tests use jsdom). */
export function htmlToDocument(html: string, parse?: (h: string) => Document): Document {
  return parse ? parse(html) : new DOMParser().parseFromString(html, 'text/html')
}

export function parseHtmlDoc(html: string, fileName = '', parse?: (h: string) => Document): HtmlDocJson {
  const dom = htmlToDocument(html, parse)
  const meta: Record<string, string> = {}
  for (const m of Array.from(dom.querySelectorAll('meta[name]'))) {
    const name = m.getAttribute('name') ?? ''
    if (name && name !== 'viewport') meta[name] = clean(m.getAttribute('content'))
  }
  const out: HtmlDocJson = {
    format: HTML_JSON_FORMAT,
    fileName,
    title: clean(dom.querySelector('title')?.textContent),
    meta,
    fieldTable: null,
    preamble: '',
    sections: [],
  }

  // Elements of the section being read, kept as elements so a caption heading can be taken back off.
  let parts: Element[] = []
  let section: HtmlSection | null = null
  const flush = () => {
    const html = parts.map((p) => p.outerHTML).join('')
    if (section) {
      section.html = html
      section.outline = parts
        .flatMap((p) => (isHeading(p) ? [p] : Array.from(p.querySelectorAll('h3, h4, h5, h6'))))
        .map((h) => ({level: Number(h.tagName[1]), anchor: h.getAttribute('id') ?? '', heading: clean(h.textContent)}))
      out.sections.push(section)
    } else out.preamble = html
    parts = []
  }

  for (const el of Array.from(dom.body.children)) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
    if (el.tagName === 'H1') {
      if (!out.title) out.title = clean(el.textContent)
      continue
    }
    if (el.tagName === 'H2') {
      flush()
      section = {anchor: el.getAttribute('id') ?? '', heading: clean(el.textContent), html: '', outline: []}
      continue
    }
    // The first "Field | Value" table holds the spot's fields; its caption heading goes with it.
    if (el.tagName === 'TABLE' && !out.fieldTable && isFieldTable(el)) {
      const caption = parts.length && isHeading(parts[parts.length - 1]) ? parts.pop()! : null
      out.fieldTable = {heading: clean(caption?.textContent), rows: readFieldTable(el)}
      continue
    }
    parts.push(el)
  }
  flush()
  return out
}

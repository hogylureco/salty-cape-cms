// Step 2 of the HTML import: the parsed JSON (parseHtml.ts) -> the spot the review screen shows.
// The result is the same SplitDoc the Word importer produces, so field-table values, narrative
// sections, review, validation and the write all go through the Word importer's code.
import type {DocFieldRow} from '../docxImport/fieldTable.ts'
import {fkey, matchHeading, parseHeadingId, type SplitDoc} from '../docxImport/splitSections.ts'
import type {HtmlDocJson} from './parseHtml.ts'

// Field-table labels the HTML files use that the spot schema calls something else.
const LABEL_RENAMES: Record<string, string> = {
  spotid: 'ID',
  structuretypes: 'Structure',
  structuretype: 'Structure',
}
const ID_LABELS = new Set(['id', 'spotid'])
const LATLONG_RE = /^(latlong|latlng|latitudelongitude|coordinates|centroid)/

/** "41.7285, -70.6369" -> ["41.7285", "-70.6369"] */
function splitLatLong(text: string): [string, string] | null {
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*[,;/ ]\s*(-?\d+(?:\.\d+)?)/)
  return m ? [m[1], m[2]] : null
}

/** The field table rows as the spot fields read them: renamed, and a lat/long pair split in two. */
export function normaliseRows(rows: DocFieldRow[]): DocFieldRow[] {
  const out: DocFieldRow[] = []
  for (const row of rows) {
    const k = fkey(row.label)
    if (LATLONG_RE.test(k)) {
      const pair = splitLatLong(row.text)
      if (pair) {
        out.push({...row, label: 'Latitude', text: pair[0]}, {...row, label: 'Longitude', text: pair[1]})
        continue
      }
    }
    out.push(LABEL_RENAMES[k] ? {...row, label: LABEL_RENAMES[k]} : row)
  }
  return out
}

export function mapHtmlDoc(json: HtmlDocJson, fieldMap: Map<string, string>): SplitDoc {
  const rows = normaliseRows(json.fieldTable?.rows ?? [])
  const idRow = rows.find((r) => ID_LABELS.has(fkey(r.label)))
  const idText = [idRow?.text, json.meta['sc-id'], json.title].find((t) => t && parseHeadingId(t))
  const id = idText ? parseHeadingId(idText)!.id : (idRow?.text ?? '')

  const meta = rows.filter((r) => r !== idRow)
  if (json.meta['sc-version'] && !meta.some((r) => fkey(r.label) === 'version')) {
    meta.unshift({num: '', label: 'Version', required: false, text: json.meta['sc-version']})
  }

  const doc: SplitDoc = {title: json.title, id, meta, sections: {}, unmatched: []}
  if (json.preamble.replace(/<[^>]*>/g, '').trim() || /<(img|table)\b/i.test(json.preamble)) {
    doc.unmatched.push({heading: '(before the first section heading)', html: json.preamble})
  }
  for (const s of json.sections) {
    const field = matchHeading(s.heading, fieldMap)
    if (field) doc.sections[field] = (doc.sections[field] ?? '') + s.html
    else doc.unmatched.push({heading: s.heading, html: s.html})
  }
  return doc
}

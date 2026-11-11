/**
 * Import HTML — Sanity Studio custom tool
 *
 * Drop a spot exported as HTML (e.g. BB_WE_fs_West_End_of_the_Canal_v19.html). Three steps:
 *   1. parseHtml.ts  — the file becomes plain JSON: title, <meta> tags, the "Field | Value"
 *                      table rows and one entry per H2 section ("Download parsed JSON").
 *   2. mapHtmlDoc.ts — that JSON is mapped to the spot: table rows to spot fields, H2 sections
 *                      to the seven narrative fields.
 *   3. The Word importer's review screen and write path (SpotDocImport → importSpots → the
 *      shared bulk import) show the result and write it to drafts.
 */
import {SpotDocImport, type ImportSource} from '../docxImport/DocxImport'
import {mapHtmlDoc} from './mapHtmlDoc'
import {parseHtmlDoc} from './parseHtml'

export const HTML_SOURCE: ImportSource = {
  title: 'Import HTML',
  intro: (
    <>
      Spots only, one per file. The ID comes from the “Spot ID” row of the Meta Block table (or the file’s sc-id
      tag); each other row is matched to a spot field — check the matches and untick anything you don’t want written.
      Each Heading 2 starts a section: Capt Mike’s Notes, Salty System Part 1 … Part 5, Q&amp;A with Capt Mike. A spot
      that already exists has only the ticked fields and the sections in the file replaced in its draft; a new spot is
      created as a draft. Nothing is published. “Download parsed JSON” shows what was read before any mapping.
    </>
  ),
  fileNoun: 'HTML file',
  fileRe: /\.html?$/i,
  accept: '.html,.htm,text/html',
  chooseText: 'Choose .html file',
  parse: async (file, fieldMap) => {
    const json = parseHtmlDoc(await file.text(), file.name)
    const messages = json.fieldTable
      ? []
      : [{type: 'warning' as const, message: 'No “Field | Value” table found: only the narrative sections will be imported.'}]
    return {docs: [mapHtmlDoc(json, fieldMap)], messages, json}
  },
}

export function HtmlImport() {
  return <SpotDocImport source={HTML_SOURCE} />
}

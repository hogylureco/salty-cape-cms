// .docx -> HTML with mammoth's browser build. Tables, lists, bold/italic and images (as data:
// URIs) are kept; anything mammoth could not map is reported in `messages`.
// @ts-expect-error mammoth ships no types for its browser build
import mammoth from 'mammoth/mammoth.browser.js'

export interface DocxMessage {
  type: 'warning' | 'error'
  message: string
}

export interface ParsedDocx {
  html: string
  messages: DocxMessage[]
}

export const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  'b => strong',
  'i => em',
]

export async function parseDocx(file: File | Blob): Promise<ParsedDocx> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({arrayBuffer}, {styleMap: STYLE_MAP})
  return {html: result.value, messages: result.messages ?? []}
}

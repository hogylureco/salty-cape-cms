// The import itself, kept out of the component so a script can run exactly the same steps:
// validate the records, resolve them against the dataset, upload pictures, write drafts.
import type {SanityClient} from 'sanity'
import {
  codeOf,
  commitImport,
  decideWrite,
  parseAndValidate,
  randKey,
  readFieldSpecs,
  resolveImport,
  type PlanItem,
  type WriteDecision,
} from '../shared/importDocuments.ts'
import {PENDING_UPLOAD} from './htmlToPortableText.ts'
import type {SpotRecord} from './records.ts'

function dataUriToBlob(uri: string): Blob {
  const [head, data] = uri.split(',', 2)
  const mime = head.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bin = atob(data ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], {type: mime})
}

/** The picture's bytes: decoded from a data: URI, or downloaded from a linked http(s) URL. */
async function srcToBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) return dataUriToBlob(src)
  const res = await fetch(src)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type || 'unknown type'})`)
  return blob
}

function fileNameFor(src: string, fallback: string, type: string): string {
  if (!src.startsWith('data:')) {
    try {
      const base = decodeURIComponent(new URL(src).pathname.split('/').pop() ?? '')
      if (base) return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extOf(type)}`
    } catch {
      /* fall through to the generated name */
    }
  }
  return `${fallback}.${extOf(type)}`
}
const extOf = (type: string) => type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'img'

const hasPending = (item: PlanItem) =>
  Object.values(item.fields).some((v) => Array.isArray(v) && v.some((b) => b?.[PENDING_UPLOAD]))

/**
 * Upload every pending image and swap in real image blocks. The same picture becomes one asset.
 * A picture that cannot be downloaded or uploaded is left out and described in the returned list.
 */
export async function uploadPendingImages(
  client: SanityClient,
  items: PlanItem[],
  onUploaded?: (n: number) => void,
): Promise<string[]> {
  const assetBySrc = new Map<string, string | null>()
  const problems: string[] = []
  let n = 0
  for (const item of items) {
    for (const [field, value] of Object.entries(item.fields)) {
      if (!Array.isArray(value) || !value.some((b) => b?.[PENDING_UPLOAD])) continue
      const out: any[] = []
      for (const block of value) {
        const src = block?.[PENDING_UPLOAD]
        if (!src) {
          out.push(block)
          continue
        }
        let assetId = assetBySrc.get(src)
        if (assetId === undefined) {
          try {
            const blob = await srcToBlob(src)
            const asset = await client.assets.upload('image', blob, {
              filename: fileNameFor(src, `${codeOf(item.match)}-${field}-${n + 1}`, blob.type),
            })
            assetId = asset._id
            onUploaded?.(++n)
          } catch (e: any) {
            assetId = null
            const where = src.startsWith('data:') ? 'An embedded picture' : src
            problems.push(`${item.match}, ${field}: ${where} could not be imported (${e?.message ?? e}) — left out.`)
          }
          assetBySrc.set(src, assetId)
        }
        if (!assetId) continue
        out.push({_type: 'image', _key: block._key ?? randKey(), asset: {_type: 'reference', _ref: assetId}})
      }
      item.fields[field] = out
    }
  }
  return problems
}

export interface ImportOutcome {
  plan: PlanItem[]
  decisions: WriteDecision[]
  done: number
  made: number
  imageProblems: string[]
}

export async function importSpots(
  client: SanityClient,
  opts: {docType: any; type: string; records: SpotRecord[]; onStatus?: (status: string) => void},
): Promise<ImportOutcome> {
  const {docType, type, onStatus} = opts
  const specs = docType ? readFieldSpecs(docType) : null
  const {errors, records} = parseAndValidate(JSON.stringify(opts.records), specs, type, 'id')
  if (errors.length || !specs) throw new Error(errors.slice(0, 5).join('\n') || `No "${type}" type in the schema.`)

  onStatus?.('Checking for existing spots…')
  const plan = await resolveImport(client, {records, specs, type, matchField: 'id'})
  const decisions = plan.map((item) => decideWrite(item, {target: 'draft', createMissing: true, skipUnresolved: false}))
  const work = plan.map((item, i) => ({item, d: decisions[i]})).filter((w) => w.d.action !== 'hold' && w.d.writeId)

  let imageProblems: string[] = []
  if (work.some((w) => hasPending(w.item))) {
    onStatus?.('Uploading pictures…')
    imageProblems = await uploadPendingImages(
      client,
      work.map((w) => w.item),
      (n) => onStatus?.(`Uploading pictures… ${n}`),
    )
  }
  onStatus?.('Writing…')
  const {done, made} = work.length ? await commitImport(client, {work, type, matchField: 'id'}) : {done: 0, made: 0}
  return {plan, decisions, done, made, imageProblems}
}

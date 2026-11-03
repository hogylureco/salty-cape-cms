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
import {META_FIELDS, type SpotRecord} from './records.ts'

function dataUriToBlob(uri: string): Blob {
  const [head, data] = uri.split(',', 2)
  const mime = head.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bin = atob(data ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], {type: mime})
}

const hasPending = (item: PlanItem) =>
  Object.values(item.fields).some((v) => Array.isArray(v) && v.some((b) => b?.[PENDING_UPLOAD]))

/** Upload every pending image and swap in real image blocks. The same picture becomes one asset. */
export async function uploadPendingImages(client: SanityClient, items: PlanItem[], onUploaded?: (n: number) => void) {
  const assetBySrc = new Map<string, string>()
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
        if (!assetId) {
          const blob = dataUriToBlob(src)
          const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'img'
          const asset = await client.assets.upload('image', blob, {
            filename: `${codeOf(item.match)}-${field}-${n + 1}.${ext}`,
          })
          assetId = asset._id
          assetBySrc.set(src, assetId)
          onUploaded?.(++n)
        }
        out.push({_type: 'image', _key: block._key ?? randKey(), asset: {_type: 'reference', _ref: assetId}})
      }
      item.fields[field] = out
    }
  }
}

export interface ImportOutcome {
  plan: PlanItem[]
  decisions: WriteDecision[]
  done: number
  made: number
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
  // An existing spot keeps its name, slug, type and version; only the narrative fields are replaced.
  for (const item of plan) if (item.baseId) for (const f of META_FIELDS) delete item.fields[f]
  const work = plan.map((item, i) => ({item, d: decisions[i]})).filter((w) => w.d.action !== 'hold' && w.d.writeId)

  if (work.some((w) => hasPending(w.item))) {
    onStatus?.('Uploading pictures…')
    await uploadPendingImages(
      client,
      work.map((w) => w.item),
      (n) => onStatus?.(`Uploading pictures… ${n}`),
    )
  }
  onStatus?.('Writing…')
  const {done, made} = work.length ? await commitImport(client, {work, type, matchField: 'id'}) : {done: 0, made: 0}
  return {plan, decisions, done, made}
}

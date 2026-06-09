/**
 * Bulk JSON Field Import — Sanity Studio v3 custom tool
 *
 * Imports Portable Text (and any array/scalar) field data into many existing
 * documents at once, by PATCHING (not replacing) so the rest of each document
 * is left intact. Designed as a companion to the CSV BulkImportTool.
 *
 * Register in sanity.config.ts:
 *
 *   import {bulkJsonFieldImportTool} from './tools/BulkJsonFieldImport'
 *   export default defineConfig({
 *     // ...
 *     tools: (prev) => [...prev, bulkJsonFieldImportTool],
 *   })
 *
 * Expected input — a JSON array of records:
 *
 *   [
 *     {
 *       "match": "BB.WE.fs",                  // value of your custom `id` field (or _id)
 *       "fields": {
 *         "overviewNarrative": [ ...PT blocks... ],
 *         "tacticsNarrative":  [ ...PT blocks... ]
 *       }
 *     }
 *   ]
 *
 * `match` may also be supplied as `id` or `_id`. Field values that are arrays
 * of objects get `_key`s injected where missing; everything else is stored verbatim.
 */

import {useCallback, useMemo, useState} from 'react'
import {useClient} from 'sanity'
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Flex,
  Heading,
  Inline,
  Label,
  Select,
  Spinner,
  Stack,
  Text,
  TextArea,
  useToast,
} from '@sanity/ui'
import {CheckmarkIcon, PlayIcon, SearchIcon, UploadIcon, WarningOutlineIcon} from '@sanity/icons'

const API_VERSION = '2024-10-01'

/* ------------------------------------------------------------------ */
/* key utilities                                                       */
/* ------------------------------------------------------------------ */

function randKey(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

// Any object that is a *member of an array* needs a _key in Sanity.
// This covers PT blocks, spans (children), markDefs, and custom block objects.
function ensureKeysInArray(arr: any[]): any[] {
  return arr.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const withKey = item._key ? item : {...item, _key: randKey()}
      return ensureKeysInObject(withKey)
    }
    if (Array.isArray(item)) return ensureKeysInArray(item)
    return item
  })
}

function ensureKeysInObject(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {...obj}
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = ensureKeysInArray(v)
    else if (v && typeof v === 'object') out[k] = ensureKeysInObject(v)
  }
  return out
}

function prepareFieldValue(value: any): any {
  if (Array.isArray(value)) return ensureKeysInArray(value)
  return value
}

/* ------------------------------------------------------------------ */
/* parse + validate                                                    */
/* ------------------------------------------------------------------ */

interface ParsedRecord {
  match: string
  fields: Record<string, any>
}

interface ParseResult {
  errors: string[]
  warnings: string[]
  records: ParsedRecord[]
}

function parseAndValidate(raw: string): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const records: ParsedRecord[] = []

  let data: any
  try {
    data = JSON.parse(raw)
  } catch (e: any) {
    return {errors: [`Invalid JSON: ${e.message}`], warnings, records}
  }

  if (!Array.isArray(data)) {
    return {errors: ['Top level must be an array of records.'], warnings, records}
  }

  data.forEach((rec: any, i: number) => {
    if (!rec || typeof rec !== 'object') {
      errors.push(`Record ${i}: not an object.`)
      return
    }
    const match = rec.match ?? rec.id ?? rec._id
    if (typeof match !== 'string' || !match.trim()) {
      errors.push(`Record ${i}: missing string "match" (or "id"/"_id").`)
      return
    }
    const fields = rec.fields
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      errors.push(`Record ${i} (${match}): missing "fields" object.`)
      return
    }
    Object.entries(fields).forEach(([fname, fval]) => {
      if (Array.isArray(fval)) {
        fval.forEach((blk: any, bi: number) => {
          if (!blk || typeof blk !== 'object' || !blk._type) {
            errors.push(`Record ${i} (${match}) field "${fname}" item ${bi}: missing _type.`)
          }
        })
        if (fval.length === 0) warnings.push(`Record ${i} (${match}) field "${fname}" is empty — will clear it.`)
      }
    })
    records.push({match, fields})
  })

  return {errors, warnings, records}
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/* ------------------------------------------------------------------ */
/* plan types                                                          */
/* ------------------------------------------------------------------ */

interface PlanItem {
  match: string
  docId?: string
  matched: boolean
  fields: Record<string, any>
  fieldSummary: {name: string; blocks: number; isArray: boolean}[]
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function BulkJsonFieldImport() {
  const client = useClient({apiVersion: API_VERSION})
  const toast = useToast()

  const [raw, setRaw] = useState('')
  const [typeName, setTypeName] = useState('spot')
  const [matchField, setMatchField] = useState<'id' | '_id'>('id')
  const [target, setTarget] = useState<'published' | 'draft'>('published')

  const [issues, setIssues] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [plan, setPlan] = useState<PlanItem[] | null>(null)
  const [resolving, setResolving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRaw(String(reader.result ?? ''))
    reader.readAsText(file)
  }, [])

  const resolve = useCallback(async () => {
    setPlan(null)
    setProgress(0)
    const {errors, warnings: warns, records} = parseAndValidate(raw)
    setIssues(errors)
    setWarnings(warns)
    if (errors.length || records.length === 0) return

    setResolving(true)
    try {
      const matches = [...new Set(records.map((r) => r.match))]
      const query =
        matchField === '_id'
          ? `*[_id in $matches]{_id, "key": _id}`
          : `*[_type == $type && ${matchField} in $matches]{_id, "key": ${matchField}}`
      const found: {_id: string; key: string}[] = await client.fetch(query, {
        matches,
        type: typeName,
      })
      const map = new Map(found.map((d) => [d.key, d._id]))

      const built: PlanItem[] = records.map((rec) => {
        const docId = map.get(rec.match)
        return {
          match: rec.match,
          docId,
          matched: Boolean(docId),
          fields: rec.fields,
          fieldSummary: Object.entries(rec.fields).map(([name, val]) => ({
            name,
            isArray: Array.isArray(val),
            blocks: Array.isArray(val) ? val.length : 0,
          })),
        }
      })
      setPlan(built)
    } catch (e: any) {
      toast.push({status: 'error', title: 'Resolution failed', description: e.message})
    } finally {
      setResolving(false)
    }
  }, [raw, matchField, typeName, client, toast])

  const commit = useCallback(async () => {
    if (!plan) return
    const matched = plan.filter((p) => p.matched && p.docId)
    if (matched.length === 0) {
      toast.push({status: 'warning', title: 'Nothing to import — no matched documents.'})
      return
    }
    setCommitting(true)
    setProgress(0)
    try {
      const batches = chunk(matched, 50)
      let done = 0
      for (const batch of batches) {
        const tx = client.transaction()
        for (const item of batch) {
          const id = target === 'draft' ? `drafts.${item.docId}` : (item.docId as string)
          const prepared: Record<string, any> = {}
          for (const [f, v] of Object.entries(item.fields)) prepared[f] = prepareFieldValue(v)
          if (target === 'draft') {
            tx.createIfNotExists({_id: id, _type: typeName} as any)
          }
          tx.patch(id, (p) => p.set(prepared))
        }
        await tx.commit({visibility: 'async'})
        done += batch.length
        setProgress(done)
      }
      toast.push({
        status: 'success',
        title: `Imported fields into ${done} document${done === 1 ? '' : 's'}.`,
      })
    } catch (e: any) {
      toast.push({status: 'error', title: 'Commit failed', description: e.message})
    } finally {
      setCommitting(false)
    }
  }, [plan, client, target, typeName, toast])

  const matchedCount = useMemo(() => plan?.filter((p) => p.matched).length ?? 0, [plan])
  const unmatched = useMemo(() => plan?.filter((p) => !p.matched) ?? [], [plan])

  return (
    <Box padding={4}>
      <Stack space={4} style={{maxWidth: 920, margin: '0 auto'}}>
        <Stack space={2}>
          <Heading size={3}>Bulk JSON Field Import</Heading>
          <Text size={1} muted>
            Patch Portable Text (and other) fields into existing documents from a JSON array.
            Other fields are left untouched.
          </Text>
        </Stack>

        {/* options */}
        <Card padding={3} radius={2} shadow={1}>
          <Flex gap={4} wrap="wrap">
            <Stack space={2}>
              <Label size={1}>Document type</Label>
              <input
                value={typeName}
                onChange={(e) => setTypeName(e.currentTarget.value)}
                style={{padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc', width: 160}}
              />
            </Stack>
            <Stack space={2}>
              <Label size={1}>Match on</Label>
              <Select value={matchField} onChange={(e) => setMatchField(e.currentTarget.value as any)}>
                <option value="id">custom `id` field</option>
                <option value="_id">`_id`</option>
              </Select>
            </Stack>
            <Stack space={2}>
              <Label size={1}>Write to</Label>
              <Select value={target} onChange={(e) => setTarget(e.currentTarget.value as any)}>
                <option value="published">Published</option>
                <option value="draft">Drafts</option>
              </Select>
            </Stack>
          </Flex>
        </Card>

        {/* input */}
        <Stack space={3}>
          <Flex gap={2} align="center">
            <Button
              as="label"
              icon={UploadIcon}
              text="Upload .json"
              mode="ghost"
              tone="primary"
              style={{cursor: 'pointer'}}
            >
              <input type="file" accept="application/json,.json" hidden onChange={handleUpload} />
            </Button>
            <Text size={1} muted>
              or paste below
            </Text>
          </Flex>
          <TextArea
            rows={12}
            value={raw}
            onChange={(e) => setRaw(e.currentTarget.value)}
            placeholder={`[\n  {\n    "match": "BB.WE.fs",\n    "fields": {\n      "overviewNarrative": [\n        { "_type": "block", "style": "normal", "children": [\n          { "_type": "span", "text": "The west end of the canal..." }\n        ] }\n      ]\n    }\n  }\n]`}
            style={{fontFamily: 'monospace', fontSize: 12}}
          />
          <Flex gap={2}>
            <Button
              icon={resolving ? Spinner : SearchIcon}
              text="Validate & resolve"
              tone="primary"
              disabled={resolving || !raw.trim()}
              onClick={resolve}
            />
          </Flex>
        </Stack>

        {/* errors / warnings */}
        {issues.length > 0 && (
          <Card padding={3} radius={2} tone="critical">
            <Stack space={2}>
              <Flex align="center" gap={2}>
                <WarningOutlineIcon />
                <Text weight="semibold">{issues.length} error(s)</Text>
              </Flex>
              {issues.slice(0, 30).map((m, i) => (
                <Text key={i} size={1}>
                  {m}
                </Text>
              ))}
            </Stack>
          </Card>
        )}
        {warnings.length > 0 && (
          <Card padding={3} radius={2} tone="caution">
            <Stack space={2}>
              {warnings.slice(0, 20).map((m, i) => (
                <Text key={i} size={1}>
                  {m}
                </Text>
              ))}
            </Stack>
          </Card>
        )}

        {/* plan / dry-run */}
        {plan && (
          <Card padding={3} radius={2} shadow={1}>
            <Stack space={3}>
              <Flex gap={2} align="center" wrap="wrap">
                <Badge tone="positive">{matchedCount} matched</Badge>
                {unmatched.length > 0 && <Badge tone="critical">{unmatched.length} unmatched</Badge>}
                <Text size={1} muted>
                  writing to {target}
                </Text>
              </Flex>

              {unmatched.length > 0 && (
                <Card padding={2} radius={2} tone="caution">
                  <Stack space={1}>
                    <Text size={1} weight="semibold">
                      No document found for:
                    </Text>
                    <Code size={1}>{unmatched.map((u) => u.match).join(', ')}</Code>
                  </Stack>
                </Card>
              )}

              <Stack space={2}>
                {plan.slice(0, 50).map((item, i) => (
                  <Card key={i} padding={2} radius={2} tone={item.matched ? 'default' : 'transparent'}>
                    <Flex align="center" gap={2} wrap="wrap">
                      {item.matched ? (
                        <CheckmarkIcon style={{color: 'green'}} />
                      ) : (
                        <WarningOutlineIcon style={{color: '#b04' }} />
                      )}
                      <Text size={1} weight="semibold">
                        {item.match}
                      </Text>
                      {item.fieldSummary.map((f) => (
                        <Badge key={f.name} mode="outline" tone="primary">
                          {f.name}
                          {f.isArray ? ` · ${f.blocks} blocks` : ''}
                        </Badge>
                      ))}
                    </Flex>
                  </Card>
                ))}
                {plan.length > 50 && (
                  <Text size={1} muted>
                    …and {plan.length - 50} more
                  </Text>
                )}
              </Stack>

              <Flex gap={2} align="center">
                <Button
                  icon={committing ? Spinner : PlayIcon}
                  text={
                    committing
                      ? `Importing… ${progress}/${matchedCount}`
                      : `Import ${matchedCount} document${matchedCount === 1 ? '' : 's'}`
                  }
                  tone="positive"
                  disabled={committing || matchedCount === 0}
                  onClick={commit}
                />
              </Flex>
            </Stack>
          </Card>
        )}
      </Stack>
    </Box>
  )
}

export const bulkJsonFieldImportTool = {
  name: 'bulk-json-field-import',
  title: 'Bulk JSON Field Import',
  icon: UploadIcon,
  component: BulkJsonFieldImport,
}

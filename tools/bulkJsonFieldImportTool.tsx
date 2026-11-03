/**
 * Bulk JSON Field Import — Sanity Studio custom tool
 *
 * Creates NEW documents, or updates existing ones, from a JSON array. For each
 * record it looks for a document of the chosen type whose `id` (or `_id`) equals
 * `match`:
 *   - found      -> the listed fields are PATCHED in; every other field is left intact
 *   - not found  -> a new document is created with those fields
 *
 * IMPORTANT: the import path in sanity.config.ts must match THIS file's name
 * exactly (case-sensitive on Vercel/Linux). This file is bulkJsonFieldImportTool.tsx:
 *
 *   import {bulkJsonFieldImportTool} from './tools/bulkJsonFieldImportTool'
 *
 *   tools: [
 *     {name: 'bulk-import', title: 'Bulk Import', component: BulkImportTool},
 *     bulkJsonFieldImportTool,
 *   ],
 *
 * Expected input — a JSON array of records:
 *
 *   [
 *     {
 *       "_type": "report",                                          // optional safety check
 *       "match": "RPT.NS.2026-10-03.BOAT.001 - Nantucket Sound",   // custom `id` field (or _id)
 *       "fields": {
 *         "name": "Nantucket Sound Fishing Report - October 3, 2026",
 *         "slug": {"_type": "slug", "current": "nantucket-sound-fishing-report-10-3-2026"},
 *         "targetSpecies": ["BON - Atlantic Bonito", "STB - Striped Bass"],   // reference field
 *         "description": [ ...Portable Text blocks... ]
 *       }
 *     }
 *   ]
 *
 * `match` may also be supplied as `id` or `_id`, or left out when `fields.id` is present.
 * If a record carries `_type`, it must equal the Document type chosen in the tool.
 *
 * New documents
 *  - _id is derived from the code before " - ", the same way the CSV BulkImportTool
 *    does it ("RPT.NS.2026-10-03.BOAT.001 - Nantucket Sound" -> RPT-NS-2026-10-03-BOAT-001),
 *    so both tools address the same document.
 *  - When matching on `id`, the `id` field is filled from `match` if the record omits it,
 *    so the next import of the same record matches instead of creating a duplicate.
 *  - "If no document matches" can be switched to "Skip the record" for patch-only runs.
 *
 * What the tool does with each field
 *  - Reference fields (per the document type's schema): every STRING in the value
 *    is matched to a target document and replaced by a real reference. Matching
 *    is on the target's custom `id` field: exact value first, then the code before
 *    " - " (so a changed label still matches), then a case-insensitive match on
 *    id / name / title for un-coded values such as "Fall". Items that are already
 *    reference objects ({_ref: ...}) are stored as given.
 *  - Arrays of objects (Portable Text etc.) get `_key`s injected where missing.
 *  - Everything else is stored verbatim.
 *
 * Leftover documents
 *  - An earlier version of this tool could write to "drafts.drafts.<id>". Studio lists such a
 *    document as a blank duplicate and cannot open or delete it. This version ignores them when
 *    matching, lists them at the top of the tool, and deletes them on request.
 *
 * Which version gets written
 *  - Write to Drafts (default): patches or creates the draft. If only a published
 *    document exists, the draft is first created as a full copy of it (what Studio
 *    does when you start editing), so no fields go missing.
 *  - Write to Published: patches or creates the published document. If only a draft
 *    exists the record is held back with a message instead of writing somewhere unseen.
 *
 * The matching, planning and write logic lives in shared/importDocuments.ts, which the Word doc
 * importer (docxImport/) uses too.
 */

import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent} from 'react'
import {useClient, useSchema} from 'sanity'
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Heading,
  Label,
  Select,
  Spinner,
  Stack,
  Text,
  TextArea,
} from '@sanity/ui'
import {Code} from '@sanity/ui/code'
import {useToast} from '@sanity/ui/toast'
import {CheckmarkIcon} from '@sanity/icons/Checkmark'
import {PlayIcon} from '@sanity/icons/Play'
import {SearchIcon} from '@sanity/icons/Search'
import {TrashIcon} from '@sanity/icons/Trash'
import {UploadIcon} from '@sanity/icons/Upload'
import {WarningOutlineIcon} from '@sanity/icons/WarningOutline'
import {
  API_VERSION,
  chunk,
  commitImport,
  decideWrite,
  isLeftoverId,
  LEFTOVER_QUERY,
  parseAndValidate,
  readFieldSpecs,
  REF_MATCH_FIELD,
  resolveImport,
  type LeftoverDoc,
  type PlanItem,
} from './shared/importDocuments'

// One stable object: useClient() hands back a new client whenever this object's identity changes.
const CLIENT_OPTIONS = {apiVersion: API_VERSION}
const TYPE_MEMORY_KEY = 'bulkJsonFieldImport.documentType'

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function BulkJsonFieldImport() {
  const client = useClient(CLIENT_OPTIONS)
  const schema = useSchema()
  const toast = useToast()

  // Leftover "drafts.drafts.*" documents: looked for when the tool opens and on every resolve.
  const [leftovers, setLeftovers] = useState<LeftoverDoc[]>([])
  const [cleaning, setCleaning] = useState(false)
  const clientRef = useRef(client)
  clientRef.current = client
  const findLeftovers = useCallback(async () => {
    const rows: LeftoverDoc[] = await clientRef.current.withConfig({perspective: 'raw'}).fetch(LEFTOVER_QUERY)
    const real = (rows ?? []).filter((r) => isLeftoverId(r._id))
    setLeftovers(real)
    return real
  }, [])
  useEffect(() => {
    findLeftovers().catch(() => {
      /* the check is a convenience; resolve runs it again and reports failures */
    })
  }, [findLeftovers])

  const [raw, setRaw] = useState('')
  // Document types in this Studio's schema; the last one used is remembered per browser.
  const docTypes = useMemo(() => {
    try {
      return schema
        .getTypeNames()
        .filter((n) => (schema.get(n) as any)?.type?.name === 'document' && !/^(sanity|system|media)\./.test(n))
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }, [schema])
  const [typeName, setTypeNameState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(TYPE_MEMORY_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const setTypeName = useCallback((value: string) => {
    setTypeNameState(value)
    try {
      window.localStorage.setItem(TYPE_MEMORY_KEY, value)
    } catch {
      /* private mode etc. — remembering the type is only a convenience */
    }
  }, [])
  const [matchField, setMatchField] = useState<'id' | '_id'>('id')
  const [target, setTarget] = useState<'published' | 'draft'>('draft')
  const [createMissing, setCreateMissing] = useState(true)
  const [skipUnresolved, setSkipUnresolved] = useState(false)

  const [issues, setIssues] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [plan, setPlan] = useState<PlanItem[] | null>(null)
  const [planFor, setPlanFor] = useState<{typeName: string; matchField: string} | null>(null)
  const [resolving, setResolving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRaw(String(reader.result ?? ''))
    reader.readAsText(file)
  }, [])

  const resolve = useCallback(async () => {
    setPlan(null)
    setProgress(0)
    const type = typeName.trim()
    const docType: any = schema.get(type)
    const specs = docType ? readFieldSpecs(docType) : null
    const {errors, warnings: warns, records} = parseAndValidate(raw, specs, type, matchField)
    setIssues(errors)
    setWarnings(warns)
    if (errors.length || records.length === 0 || !specs) return

    setResolving(true)
    try {
      await findLeftovers()
      setPlan(await resolveImport(client, {records, specs, type, matchField}))
      setPlanFor({typeName: type, matchField})
    } catch (e: any) {
      toast.push({status: 'error', title: 'Resolution failed', description: e.message})
    } finally {
      setResolving(false)
    }
  }, [raw, matchField, typeName, client, schema, toast, findLeftovers])

  const deleteLeftovers = useCallback(async () => {
    setCleaning(true)
    try {
      const current = await findLeftovers() // re-read, and only ever delete ids of the leftover shape
      const ids = current.map((d) => d._id).filter(isLeftoverId)
      for (const batch of chunk(ids, 50)) {
        const tx = clientRef.current.transaction()
        for (const id of batch) tx.delete(id)
        await tx.commit({visibility: 'sync'})
      }
      setPlan(null)
      const left = await findLeftovers()
      toast.push({
        status: left.length ? 'warning' : 'success',
        title: left.length
          ? `${ids.length - left.length} deleted, ${left.length} still there.`
          : `Deleted ${ids.length} leftover document${ids.length === 1 ? '' : 's'}.`,
      })
    } catch (e: any) {
      toast.push({status: 'error', title: 'Delete failed', description: e.message})
    } finally {
      setCleaning(false)
    }
  }, [findLeftovers, toast])

  const decisions = useMemo(
    () => plan?.map((item) => decideWrite(item, {target, createMissing, skipUnresolved})) ?? [],
    [plan, target, createMissing, skipUnresolved],
  )
  const stale = Boolean(plan && planFor && (planFor.typeName !== typeName.trim() || planFor.matchField !== matchField))
  const newCount = decisions.filter((d) => d.action === 'create').length
  const updateCount = decisions.filter((d) => d.action === 'patch' || d.action === 'draft-from-published').length
  const writeCount = newCount + updateCount
  const heldCount = decisions.length - writeCount

  const commit = useCallback(async () => {
    if (!plan || !planFor) return
    const type = planFor.typeName
    const work = plan
      .map((item, i) => ({item, d: decisions[i]}))
      .filter((w) => w.d.action !== 'hold' && w.d.writeId)
    if (work.length === 0) {
      toast.push({status: 'warning', title: 'Nothing to import — every record is held back.'})
      return
    }
    setCommitting(true)
    setProgress(0)
    try {
      const {done, made} = await commitImport(client, {work, type, matchField: planFor.matchField, onProgress: setProgress})
      toast.push({
        status: 'success',
        title: `Imported ${done} document${done === 1 ? '' : 's'}: ${made} new, ${done - made} updated.`,
      })
      setPlan(null)
    } catch (e: any) {
      toast.push({status: 'error', title: 'Commit failed', description: e.message})
    } finally {
      setCommitting(false)
    }
  }, [plan, planFor, decisions, client, toast])

  const unresolved = useMemo(
    () => plan?.flatMap((p) => p.unresolved.map((u) => ({...u, match: p.match}))) ?? [],
    [plan],
  )
  const relabelled = useMemo(
    () => plan?.flatMap((p) => p.relabelled.map((u) => ({...u, match: p.match}))) ?? [],
    [plan],
  )

  return (
    <Box padding={4}>
      <Stack gap={4} style={{maxWidth: 920, margin: '0 auto'}}>
        <Stack gap={2}>
          <Heading size={3}>Bulk JSON Field Import</Heading>
          <Text size={1} muted>
            Create new documents, or update existing ones, from a JSON array. A record whose match
            value is found updates that document and leaves its other fields untouched; a record
            with no match becomes a new document. Reference fields take id strings and are matched
            on the target&apos;s <code>{REF_MATCH_FIELD}</code> field.
          </Text>
        </Stack>

        {/* leftovers from the earlier draft-prefix bug */}
        {leftovers.length > 0 && (
          <Card padding={3} radius={2} tone="caution">
            <Stack gap={3}>
              <Text size={1} weight="semibold">
                {leftovers.length} leftover document{leftovers.length === 1 ? '' : 's'} from an earlier version of this
                tool
              </Text>
              <Text size={1}>
                Their _id starts with “drafts.drafts.”, so Studio lists them as blank duplicates and cannot open or
                delete them. They are ignored by this import. Deleting them does not touch the real documents.
              </Text>
              <Stack gap={2}>
                {leftovers.slice(0, 20).map((d) => (
                  <Code key={d._id} size={1}>
                    {`${d._id}  (${d._type ?? 'unknown type'}${d.label ? ` · ${d.label}` : ''})`}
                  </Code>
                ))}
                {leftovers.length > 20 && (
                  <Text size={1} muted>
                    …and {leftovers.length - 20} more
                  </Text>
                )}
              </Stack>
              <Flex>
                <Button
                  icon={cleaning ? Spinner : TrashIcon}
                  text={`Delete ${leftovers.length} leftover document${leftovers.length === 1 ? '' : 's'}`}
                  tone="critical"
                  disabled={cleaning}
                  onClick={deleteLeftovers}
                />
              </Flex>
            </Stack>
          </Card>
        )}

        {/* options */}
        <Card padding={3} radius={2} shadow={1}>
          <Stack gap={3}>
            <Flex gap={4} wrap="wrap">
              <Stack gap={2}>
                <Label size={1}>Document type</Label>
                {docTypes.length > 0 ? (
                  <Select value={typeName} onChange={(e) => setTypeName(e.currentTarget.value)}>
                    <option value="">Choose…</option>
                    {typeName && !docTypes.includes(typeName) && <option value={typeName}>{typeName}</option>}
                    {docTypes.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <input
                    value={typeName}
                    onChange={(e) => setTypeName(e.currentTarget.value)}
                    style={{padding: '6px 8px', borderRadius: 4, border: '1px solid #ccc', width: 160}}
                  />
                )}
              </Stack>
              <Stack gap={2}>
                <Label size={1}>Match on</Label>
                <Select value={matchField} onChange={(e) => setMatchField(e.currentTarget.value as any)}>
                  <option value="id">custom `id` field</option>
                  <option value="_id">`_id`</option>
                </Select>
              </Stack>
              <Stack gap={2}>
                <Label size={1}>If no document matches</Label>
                <Select
                  value={createMissing ? 'create' : 'skip'}
                  onChange={(e) => setCreateMissing(e.currentTarget.value === 'create')}
                >
                  <option value="create">Create a new document</option>
                  <option value="skip">Skip the record</option>
                </Select>
              </Stack>
              <Stack gap={2}>
                <Label size={1}>Write to</Label>
                <Select value={target} onChange={(e) => setTarget(e.currentTarget.value as any)}>
                  <option value="draft">Drafts</option>
                  <option value="published">Published</option>
                </Select>
              </Stack>
            </Flex>
            <Flex as="label" align="center" gap={2} style={{cursor: 'pointer'}}>
              <Checkbox checked={skipUnresolved} onChange={(e) => setSkipUnresolved(e.currentTarget.checked)} />
              <Text size={1}>Import even if some references can&apos;t be matched (they are left out)</Text>
            </Flex>
          </Stack>
        </Card>

        {/* input */}
        <Stack gap={3}>
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
            placeholder={`[\n  {\n    "match": "BB.WE.fs - West End of the Canal",\n    "fields": {\n      "targetSpecies": ["STB - Striped Bass"],\n      "captMikeNotes": [\n        { "_type": "block", "style": "normal", "children": [\n          { "_type": "span", "text": "The west end of the canal..." }\n        ] }\n      ]\n    }\n  }\n]`}
            style={{fontFamily: 'monospace', fontSize: 12}}
          />
          <Flex gap={2}>
            <Button
              icon={resolving ? Spinner : SearchIcon}
              text="Validate & resolve"
              tone="primary"
              disabled={resolving || !raw.trim() || !typeName.trim()}
              onClick={resolve}
            />
          </Flex>
        </Stack>

        {/* errors / warnings */}
        {issues.length > 0 && (
          <Card padding={3} radius={2} tone="critical">
            <Stack gap={2}>
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
            <Stack gap={2}>
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
            <Stack gap={3}>
              <Flex gap={2} align="center" wrap="wrap">
                <Badge tone="positive">{newCount} new</Badge>
                <Badge tone="primary">{updateCount} to update</Badge>
                {heldCount > 0 && <Badge tone="critical">{heldCount} held back</Badge>}
                <Text size={1} muted>
                  {planFor?.typeName} · writing to {target === 'draft' ? 'drafts' : 'published'}
                </Text>
              </Flex>

              {stale && (
                <Card padding={2} radius={2} tone="caution">
                  <Text size={1}>Document type or Match on changed — run Validate &amp; resolve again.</Text>
                </Card>
              )}

              {unresolved.length > 0 && (
                <Card padding={2} radius={2} tone="critical">
                  <Stack gap={2}>
                    <Text size={1} weight="semibold">
                      {unresolved.length} reference(s) with no match
                    </Text>
                    {unresolved.slice(0, 40).map((u, i) => (
                      <Text key={i} size={1}>
                        {u.field}: “{u.token}” — {u.detail}
                      </Text>
                    ))}
                  </Stack>
                </Card>
              )}

              {relabelled.length > 0 && (
                <Card padding={2} radius={2} tone="caution">
                  <Stack gap={2}>
                    <Text size={1} weight="semibold">
                      {relabelled.length} reference(s) matched by code; the stored label differs
                    </Text>
                    {relabelled.slice(0, 40).map((u, i) => (
                      <Text key={i} size={1}>
                        {u.field}: “{u.token}” → “{u.detail}”
                      </Text>
                    ))}
                  </Stack>
                </Card>
              )}

              <Stack gap={2}>
                {plan.slice(0, 50).map((item, i) => {
                  const d = decisions[i]
                  const ok = d.action !== 'hold'
                  return (
                    <Card key={i} padding={2} radius={2} tone={ok ? 'default' : 'transparent'}>
                      <Stack gap={2}>
                        <Flex align="center" gap={2} wrap="wrap">
                          {ok ? (
                            <CheckmarkIcon style={{color: 'green'}} />
                          ) : (
                            <WarningOutlineIcon style={{color: '#b04'}} />
                          )}
                          <Text size={1} weight="semibold">
                            {item.match}
                          </Text>
                          <Badge tone={!ok ? 'critical' : d.action === 'create' ? 'positive' : 'primary'}>
                            {d.action === 'create' ? 'NEW · ' : ''}
                            {d.label}
                          </Badge>
                          {d.note && <Badge tone="caution">{d.note}</Badge>}
                        </Flex>
                        <Flex gap={1} wrap="wrap">
                          {item.fieldSummary.map((f) => (
                            <Badge key={f.name} mode="outline" tone="primary">
                              {f.label}
                            </Badge>
                          ))}
                        </Flex>
                      </Stack>
                    </Card>
                  )
                })}
                {plan.length > 50 && (
                  <Text size={1} muted>
                    …and {plan.length - 50} more
                  </Text>
                )}
              </Stack>

              {heldCount > 0 && (
                <Code size={1}>
                  {plan
                    .filter((_, i) => decisions[i].action === 'hold')
                    .slice(0, 50)
                    .map((p) => p.match)
                    .join(', ')}
                </Code>
              )}

              <Flex gap={2} align="center">
                <Button
                  icon={committing ? Spinner : PlayIcon}
                  text={
                    committing
                      ? `Importing… ${progress}/${writeCount}`
                      : `Import — ${newCount} new, ${updateCount} updated`
                  }
                  tone="positive"
                  disabled={committing || writeCount === 0 || stale}
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

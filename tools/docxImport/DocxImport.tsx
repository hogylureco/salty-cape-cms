/**
 * Import Word Doc — Sanity Studio custom tool
 *
 * Drop a .docx of spot narratives, review what was parsed, and import it. Each Heading 1 is a
 * spot ("BB.WE.fs - West End of the Canal"); each Heading 2 starts a section that is matched to
 * one of the seven narrative fields. Tables become rich tables and embedded pictures are
 * uploaded as image blocks.
 *
 * Writing goes through the same path as the Bulk JSON Field Import tool (shared/importDocuments):
 * the spot whose `id` matches is updated in drafts — only the narrative sections in the document
 * are replaced — and a spot with no match is created as a new draft. "Download JSON" gives the
 * exact array that tool accepts.
 */

import {useCallback, useEffect, useMemo, useState, type ChangeEvent, type DragEvent} from 'react'
import {useClient, useSchema} from 'sanity'
import {IntentLink} from 'sanity/router'
import {PortableText, type PortableTextComponents} from '@portabletext/react'
import {Badge, Box, Button, Card, Flex, Grid, Heading, Label, Select, Spinner, Stack, Text, TextInput} from '@sanity/ui'
import {useToast} from '@sanity/ui/toast'
import {DownloadIcon} from '@sanity/icons/Download'
import {PlayIcon} from '@sanity/icons/Play'
import {UploadIcon} from '@sanity/icons/Upload'
import {WarningOutlineIcon} from '@sanity/icons/WarningOutline'
import {API_VERSION, codeOf} from '../shared/importDocuments'
import {parseDocx, type DocxMessage} from './parseDocx'
import {buildFieldMap, NARRATIVE_FIELDS, parseHeadingId, splitSections, type SplitDoc} from './splitSections'
import {convertField, convertTypesFor, PENDING_UPLOAD} from './htmlToPortableText'
import {decoratorsOf, mergeResults, validateBlocks, type ValidationResult} from './validate'
import {DEFAULT_VERSION, defaultSlug, spotTypeFromId, toRecord, withoutPendingImages} from './records'
import {importSpots} from './importSpots'

const DOC_TYPE = 'spot'
// One stable object: useClient() hands back a new client whenever this object's identity changes.
const CLIENT_OPTIONS = {apiVersion: API_VERSION}
const SPOT_TYPE_OPTIONS = [
  {title: 'FS - Featured Spot', value: 'fs-featured-spot'},
  {title: 'FX - Spot Playbook Approach', value: 'fx-spot-playbook-approach'},
  {title: 'BR - Boat Ramp', value: 'br-boat-ramp'},
  {title: 'FL - Featured Loop', value: 'fl-featured-loop'},
]

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

interface SpotState {
  split: SplitDoc
  id: string
  name: string
  slug: string
  slugTouched: boolean
  spotType: string
  version: string
  assign: string[] // per unmatched section: '' (leave out) or a field name
  fields: Record<string, any[]> // converted Portable Text per field
  convertWarnings: string[]
}

function convertSpot(spot: SpotState, schema: any): SpotState {
  const html: Record<string, string> = {...spot.split.sections}
  spot.split.unmatched.forEach((u, i) => {
    const field = spot.assign[i]
    if (field) html[field] = (html[field] ?? '') + u.html
  })
  const warnings: string[] = []
  const fields: Record<string, any[]> = {}
  for (const field of NARRATIVE_FIELDS) {
    if (html[field] === undefined) continue
    const types = convertTypesFor(schema, DOC_TYPE, field)
    if (!types) {
      warnings.push(`The ${DOC_TYPE} schema has no Portable Text field "${field}"; that section was left out.`)
      continue
    }
    fields[field] = convertField(html[field], types, (m) => warnings.push(m))
  }
  return {...spot, fields, convertWarnings: [...new Set(warnings)]}
}

function newSpot(split: SplitDoc, regionSlugs: Map<string, string>, schema: any): SpotState {
  const parsed = parseHeadingId(split.title)
  const name = parsed?.label ?? split.title
  const id = split.id
  return convertSpot(
    {
      split,
      id,
      name,
      slug: defaultSlug(id, name, regionSlugs),
      slugTouched: false,
      spotType: spotTypeFromId(id),
      version: DEFAULT_VERSION,
      assign: split.unmatched.map(() => ''),
      fields: {},
      convertWarnings: [],
    },
    schema,
  )
}

/* ------------------------------------------------------------------ */
/* preview                                                             */
/* ------------------------------------------------------------------ */

const cellStyle = {border: '1px solid var(--card-border-color, #ccc)', padding: '4px 8px', verticalAlign: 'top'}

const previewComponents: PortableTextComponents = {
  types: {
    image: ({value}: any) =>
      value?.[PENDING_UPLOAD] ? (
        <img src={value[PENDING_UPLOAD]} alt="" style={{maxWidth: 240, maxHeight: 180, display: 'block', margin: '8px 0'}} />
      ) : null,
    richTableBlock: ({value}: any) => {
      const headers: any[] = value?.columnHeaders ?? []
      const rows: any[] = value?.rows ?? []
      return (
        <table style={{borderCollapse: 'collapse', margin: '8px 0', fontSize: 13}}>
          {value?.hasColumnTitles && (
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h._key} style={{...cellStyle, textAlign: 'left'}}>
                    {h.title ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((r) => (
              <tr key={r._key}>
                {(r.cells ?? []).map((c: any) => (
                  <td key={c._key} style={cellStyle}>
                    <PortableText value={c.content ?? []} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    },
  },
}

function Messages({tone, title, items}: {tone: 'critical' | 'caution'; title: string; items: string[]}) {
  if (!items.length) return null
  return (
    <Card padding={3} radius={2} tone={tone}>
      <Stack gap={2}>
        <Flex align="center" gap={2}>
          <WarningOutlineIcon />
          <Text size={1} weight="semibold">
            {title}
          </Text>
        </Flex>
        {items.slice(0, 40).map((m, i) => (
          <Text key={i} size={1}>
            {m}
          </Text>
        ))}
        {items.length > 40 && (
          <Text size={1} muted>
            …and {items.length - 40} more
          </Text>
        )}
      </Stack>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

interface Existing {
  _id: string
  id: string
}

interface ImportResult {
  match: string
  writeId?: string
  baseId?: string
  label: string
  ok: boolean
}

export function DocxImport() {
  const client = useClient(CLIENT_OPTIONS)
  const schema = useSchema()
  const toast = useToast()

  const docType: any = schema.get(DOC_TYPE)
  const fieldTitles = useMemo(
    () => Object.fromEntries((docType?.fields ?? []).map((f: any) => [f.name, f.type?.title ?? f.name])) as Record<string, string>,
    [docType],
  )
  const fieldMap = useMemo(() => buildFieldMap(fieldTitles), [fieldTitles])

  const [regionSlugs, setRegionSlugs] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    client
      .withConfig({perspective: 'raw'})
      .fetch<{id?: string; slug?: string}[]>(`*[_type == "region" && defined(id) && defined(slug.current)]{id, "slug": slug.current}`)
      .then((rows) => setRegionSlugs(new Map((rows ?? []).map((r) => [codeOf(r.id ?? ''), r.slug ?? '']))))
      .catch(() => {
        /* the region prefix only seeds the suggested slug */
      })
  }, [client])

  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [messages, setMessages] = useState<DocxMessage[]>([])
  const [spots, setSpots] = useState<SpotState[]>([])
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [results, setResults] = useState<ImportResult[] | null>(null)

  const loadFile = useCallback(
    async (file: File) => {
      if (!/\.docx$/i.test(file.name)) {
        toast.push({status: 'error', title: 'Choose a Word .docx file', description: file.name})
        return
      }
      setParsing(true)
      setResults(null)
      setSpots([])
      setMessages([])
      setFileName(file.name)
      try {
        const {html, messages: msgs} = await parseDocx(file)
        setMessages(msgs)
        const split = splitSections(html, fieldMap)
        setSpots(split.map((s) => newSpot(s, regionSlugs, schema)))
        if (!split.length) toast.push({status: 'warning', title: 'The document is empty.'})
      } catch (e: any) {
        toast.push({status: 'error', title: 'Could not read the Word file', description: e.message})
      } finally {
        setParsing(false)
      }
    },
    [fieldMap, regionSlugs, schema, toast],
  )

  const onPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // picking the same file again re-parses it
      if (file) loadFile(file)
    },
    [loadFile],
  )
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) loadFile(file)
    },
    [loadFile],
  )

  const updateSpot = useCallback(
    (i: number, patch: Partial<SpotState>) => {
      setResults(null)
      setSpots((prev) =>
        prev.map((s, j) => {
          if (j !== i) return s
          const next = {...s, ...patch}
          if (patch.id !== undefined && !s.spotType) next.spotType = spotTypeFromId(patch.id)
          if (!next.slugTouched && (patch.id !== undefined || patch.name !== undefined)) {
            next.slug = defaultSlug(next.id, next.name, regionSlugs)
          }
          return patch.assign ? convertSpot(next, schema) : next
        }),
      )
    },
    [regionSlugs, schema],
  )

  // Which ids already exist (draft or published), so new and existing spots are shown apart.
  const idsKey = spots.map((s) => s.id.trim()).join('\n')
  const [existing, setExisting] = useState<Map<string, Existing[]> | null>(null)
  useEffect(() => {
    const ids = idsKey.split('\n').filter(Boolean)
    setExisting(null)
    if (!ids.length) return
    let live = true
    const t = setTimeout(() => {
      client
        .withConfig({perspective: 'raw'})
        .fetch<Existing[]>(`*[_type == $type && id in $ids && !(_id in path("versions.**"))]{_id, id}`, {type: DOC_TYPE, ids})
        .then((rows) => {
          if (!live) return
          const m = new Map<string, Existing[]>()
          for (const r of rows ?? []) m.set(r.id, [...(m.get(r.id) ?? []), r])
          setExisting(m)
        })
        .catch(() => {
          /* shown as "checking…"; the import resolves again anyway */
        })
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [idsKey, client])

  const isExisting = useCallback((id: string) => Boolean(existing?.get(id.trim())?.length), [existing])

  // Per-spot checks. Errors block the import.
  const checks = useMemo(() => {
    const counts = new Map<string, number>()
    spots.forEach((s) => counts.set(s.id.trim(), (counts.get(s.id.trim()) ?? 0) + 1))
    return spots.map((s): ValidationResult => {
      const id = s.id.trim()
      const errors: string[] = []
      const warnings: string[] = [...s.convertWarnings]
      if (!id) errors.push('ID is required — e.g. "BB.WE.fs - West End of the Canal".')
      else if (!parseHeadingId(id)) warnings.push('ID is not in the "CODE - Label" form other spots use.')
      if (id && (counts.get(id) ?? 0) > 1) errors.push('Another spot in this document has the same ID.')
      if (id && !isExisting(id)) {
        if (!s.name.trim()) errors.push('Name is required for a new spot.')
        if (!s.slug.trim()) errors.push('Slug is required for a new spot.')
        if (!s.spotType) errors.push('Spot type is required for a new spot.')
        if (!s.version.trim()) errors.push('Version is required for a new spot.')
      }
      if (!Object.keys(s.fields).length) warnings.push('No section of this spot matched a narrative field.')
      s.split.unmatched.forEach((u, i) => {
        if (!s.assign[i]) warnings.push(`The section "${u.heading}" matches no field and will not be imported.`)
      })
      const blocks = Object.entries(s.fields).map(([f, v]) => validateBlocks(f, v, decoratorsOf(convertTypesFor(schema, DOC_TYPE, f)?.field)))
      return mergeResults({errors, warnings}, ...blocks)
    })
  }, [spots, isExisting, schema])

  const blocked = checks.some((c) => c.errors.length > 0) || existing === null

  const recordsFor = useCallback(
    (forDownload: boolean) => {
      let dropped = 0
      const records = spots.map((s) => {
        const fields: Record<string, any[]> = {}
        for (const [f, v] of Object.entries(s.fields)) {
          if (!forDownload) fields[f] = v
          else {
            const r = withoutPendingImages(v)
            fields[f] = r.blocks
            dropped += r.dropped
          }
        }
        const meta = {name: s.name.trim(), slug: s.slug.trim(), spotType: s.spotType, version: s.version.trim()}
        return toRecord(s.id.trim(), meta, fields, !isExisting(s.id))
      })
      return {records, dropped}
    },
    [spots, isExisting],
  )

  const download = useCallback(() => {
    const {records, dropped} = recordsFor(true)
    const blob = new Blob([JSON.stringify(records, null, 2)], {type: 'application/json'})
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${fileName.replace(/\.docx$/i, '') || 'spots'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    if (dropped) {
      toast.push({
        status: 'warning',
        title: `${dropped} picture${dropped === 1 ? '' : 's'} left out of the JSON`,
        description: 'Pictures are only uploaded by the Import button.',
      })
    }
  }, [recordsFor, fileName, toast])

  const runImport = useCallback(async () => {
    setImporting('Starting…')
    try {
      const {records} = recordsFor(false)
      const {plan, decisions, done, made} = await importSpots(client, {docType, type: DOC_TYPE, records, onStatus: setImporting})
      setResults(
        plan.map((item, i) => ({
          match: item.match,
          writeId: decisions[i].writeId,
          baseId: item.baseId ?? item.mintedId,
          label: decisions[i].label,
          ok: decisions[i].action !== 'hold',
        })),
      )
      const held = plan.length - done
      toast.push({
        status: held ? 'warning' : 'success',
        title: `Imported ${done} spot${done === 1 ? '' : 's'}: ${made} new, ${done - made} updated${held ? `, ${held} held back` : ''}.`,
      })
    } catch (e: any) {
      toast.push({status: 'error', title: 'Import failed', description: e.message})
    } finally {
      setImporting(null)
    }
  }, [docType, recordsFor, client, toast])

  const narrativeOptions = NARRATIVE_FIELDS.filter((f) => fieldTitles[f])
  const newCount = spots.filter((s) => s.id.trim() && existing && !isExisting(s.id)).length
  const updateCount = spots.filter((s) => s.id.trim() && isExisting(s.id)).length

  return (
    <Box padding={4}>
      <Stack gap={4} style={{maxWidth: 960, margin: '0 auto'}}>
        <Stack gap={2}>
          <Heading size={3}>Import Word Doc</Heading>
          <Text size={1} muted>
            Spots only. Each Heading 1 in the document is a spot, written as its ID (“BB.WE.fs - West End of the
            Canal”). Each Heading 2 starts a section — Capt Mike’s Notes, Step 1 – Historical Analysis … Q&amp;A with
            Capt Mike. A spot that already exists has only those sections replaced in its draft; a new spot is created
            as a draft. Nothing is published.
          </Text>
        </Stack>

        {!docType && (
          <Messages tone="critical" title="Cannot import" items={["This Studio's schema has no spot type."]} />
        )}

        <Card
          padding={5}
          radius={3}
          tone={dragging ? 'primary' : 'default'}
          border
          style={{borderStyle: 'dashed', borderWidth: 2}}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Flex direction="column" align="center" gap={3}>
            {parsing ? <Spinner /> : <UploadIcon style={{fontSize: 32}} />}
            <Text size={2}>{parsing ? `Reading ${fileName}…` : 'Drop a Word document here'}</Text>
            <Button as="label" text="Choose .docx file" mode="ghost" tone="primary" style={{cursor: 'pointer'}}>
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                hidden
                onChange={onPick}
              />
            </Button>
            {fileName && !parsing && (
              <Text size={1} muted>
                {fileName}: {spots.length} spot{spots.length === 1 ? '' : 's'}
              </Text>
            )}
          </Flex>
        </Card>

        <Messages
          tone="caution"
          title="Messages from reading the Word file"
          items={messages.map((m) => `${m.type === 'error' ? 'Error' : 'Note'}: ${m.message}`)}
        />

        {spots.map((s, i) => {
          const id = s.id.trim()
          const exists = isExisting(id)
          const check = checks[i]
          const missing = narrativeOptions.filter((f) => !s.fields[f])
          return (
            <Card key={i} padding={4} radius={3} shadow={1}>
              <Stack gap={4}>
                <Flex align="center" gap={2} wrap="wrap">
                  <Heading size={1}>{s.split.title || '(no Heading 1)'}</Heading>
                  {id &&
                    (existing === null ? (
                      <Badge>checking…</Badge>
                    ) : exists ? (
                      <Badge tone="primary">updates existing spot</Badge>
                    ) : (
                      <Badge tone="positive">new spot</Badge>
                    ))}
                </Flex>

                <Grid gridTemplateColumns={[1, 1, 2]} gap={3}>
                  <Stack gap={2}>
                    <Label size={1}>ID</Label>
                    <TextInput value={s.id} onChange={(e) => updateSpot(i, {id: e.currentTarget.value})} />
                  </Stack>
                  <Stack gap={2}>
                    <Label size={1}>Name</Label>
                    <TextInput value={s.name} disabled={exists} onChange={(e) => updateSpot(i, {name: e.currentTarget.value})} />
                  </Stack>
                  <Stack gap={2}>
                    <Label size={1}>Slug</Label>
                    <TextInput
                      value={s.slug}
                      disabled={exists}
                      onChange={(e) => updateSpot(i, {slug: e.currentTarget.value, slugTouched: true})}
                    />
                  </Stack>
                  <Grid gridTemplateColumns={2} gap={3}>
                    <Stack gap={2}>
                      <Label size={1}>Spot type</Label>
                      <Select value={s.spotType} disabled={exists} onChange={(e) => updateSpot(i, {spotType: e.currentTarget.value})}>
                        <option value="">Choose…</option>
                        {SPOT_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.title}
                          </option>
                        ))}
                      </Select>
                    </Stack>
                    <Stack gap={2}>
                      <Label size={1}>Version</Label>
                      <TextInput value={s.version} disabled={exists} onChange={(e) => updateSpot(i, {version: e.currentTarget.value})} />
                    </Stack>
                  </Grid>
                </Grid>
                {exists && (
                  <Text size={1} muted>
                    This spot already exists: only the sections below are replaced. Its name, slug, type and version are
                    left as they are.
                  </Text>
                )}

                {s.split.unmatched.length > 0 && (
                  <Card padding={3} radius={2} tone="caution">
                    <Stack gap={3}>
                      <Text size={1} weight="semibold">
                        {s.split.unmatched.length} section{s.split.unmatched.length === 1 ? '' : 's'} with a heading that
                        matches no field
                      </Text>
                      {s.split.unmatched.map((u, ui) => (
                        <Flex key={ui} gap={3} align="flex-start" wrap="wrap">
                          <Stack gap={2} flex={1} style={{minWidth: 240}}>
                            <Text size={1} weight="semibold">
                              {u.heading}
                            </Text>
                            <Text size={1} muted>
                              {(new DOMParser().parseFromString(u.html, 'text/html').body.textContent ?? '').slice(0, 200) ||
                                '(empty)'}
                            </Text>
                          </Stack>
                          <Select
                            value={s.assign[ui]}
                            onChange={(e) => {
                              const assign = [...s.assign]
                              assign[ui] = e.currentTarget.value
                              updateSpot(i, {assign})
                            }}
                            style={{minWidth: 220}}
                          >
                            <option value="">Leave out</option>
                            {narrativeOptions.map((f) => (
                              <option key={f} value={f}>
                                Add to: {fieldTitles[f]}
                              </option>
                            ))}
                          </Select>
                        </Flex>
                      ))}
                    </Stack>
                  </Card>
                )}

                <Stack gap={3}>
                  {narrativeOptions
                    .filter((f) => s.fields[f])
                    .map((f) => (
                      <Card key={f} padding={3} radius={2} border>
                        <Stack gap={3}>
                          <Flex align="center" gap={2}>
                            <Text size={1} weight="semibold">
                              {fieldTitles[f]}
                            </Text>
                            <Badge>
                              {s.fields[f].length} block{s.fields[f].length === 1 ? '' : 's'}
                            </Badge>
                            {s.fields[f].some((b) => b._type === 'richTableBlock') && <Badge tone="primary">table</Badge>}
                            {s.fields[f].some((b) => b._type === 'image') && <Badge tone="primary">picture</Badge>}
                          </Flex>
                          <Box style={{maxHeight: 320, overflow: 'auto', fontSize: 14, lineHeight: 1.5}}>
                            <PortableText value={s.fields[f]} components={previewComponents} />
                          </Box>
                        </Stack>
                      </Card>
                    ))}
                  {missing.length > 0 && (
                    <Text size={1} muted>
                      Not in this document (left unchanged): {missing.map((f) => fieldTitles[f]).join(', ')}
                    </Text>
                  )}
                </Stack>

                <Messages tone="critical" title="Fix before importing" items={check?.errors ?? []} />
                <Messages tone="caution" title="Warnings" items={check?.warnings ?? []} />
              </Stack>
            </Card>
          )
        })}

        {spots.length > 0 && (
          <Flex gap={2} align="center" wrap="wrap">
            <Button
              icon={importing ? Spinner : PlayIcon}
              text={importing ?? `Import — ${newCount} new, ${updateCount} updated`}
              tone="positive"
              disabled={Boolean(importing) || blocked}
              onClick={runImport}
            />
            <Button icon={DownloadIcon} text="Download JSON" mode="ghost" disabled={Boolean(importing)} onClick={download} />
            {blocked && !importing && (
              <Text size={1} muted>
                {existing === null ? 'Checking for existing spots…' : 'Fix the errors above to import.'}
              </Text>
            )}
          </Flex>
        )}

        {results && (
          <Card padding={3} radius={2} tone="positive">
            <Stack gap={3}>
              <Text size={1} weight="semibold">
                Import finished
              </Text>
              {results.map((r) => (
                <Flex key={r.match} gap={2} align="center" wrap="wrap">
                  <Badge tone={r.ok ? 'positive' : 'critical'}>{r.ok ? 'done' : 'held back'}</Badge>
                  <Text size={1}>
                    {r.match} — {r.label}
                  </Text>
                  {r.ok && r.baseId && (
                    <Text size={1}>
                      <IntentLink intent="edit" params={{id: r.baseId, type: DOC_TYPE}}>
                        Open
                      </IntentLink>
                    </Text>
                  )}
                </Flex>
              ))}
            </Stack>
          </Card>
        )}
      </Stack>
    </Box>
  )
}

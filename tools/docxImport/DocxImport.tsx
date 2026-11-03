/**
 * Import Word Doc — Sanity Studio custom tool
 *
 * Drop a .docx of spots, review what was parsed, and import it. A spot starts at its
 * "Field | Value" table ("★ 6.  Latitude | 41.7369") or at a Heading 1 written as its ID
 * ("BB.WE.fs - West End of the Canal"). Each table row is mapped to a spot field — references
 * are matched to documents on screen — and each Heading 2 starts a section that is matched to
 * one of the seven narrative fields. Tables in the sections become rich tables and embedded
 * pictures are uploaded as image blocks.
 *
 * Writing goes through the same path as the Bulk JSON Field Import tool (shared/importDocuments):
 * the spot whose `id` matches is updated in drafts — only the ticked fields and the narrative
 * sections in the document are replaced — and a spot with no match is created as a new draft.
 * "Download JSON" gives the exact array that tool accepts.
 */

import {useCallback, useEffect, useMemo, useState, type ChangeEvent, type DragEvent} from 'react'
import {useClient, useSchema} from 'sanity'
import {IntentLink} from 'sanity/router'
import {PortableText, type PortableTextComponents} from '@portabletext/react'
import {Badge, Box, Button, Card, Checkbox, Flex, Grid, Heading, Label, Select, Spinner, Stack, Text, TextInput} from '@sanity/ui'
import {useToast} from '@sanity/ui/toast'
import {DownloadIcon} from '@sanity/icons/Download'
import {PlayIcon} from '@sanity/icons/Play'
import {UploadIcon} from '@sanity/icons/Upload'
import {WarningOutlineIcon} from '@sanity/icons/WarningOutline'
import {API_VERSION, buildRefIndex, codeOf, readFieldSpecs, type RawRefDoc, type RefIndex} from '../shared/importDocuments'
import {parseDocx, type DocxMessage} from './parseDocx'
import {buildFieldMap, fkey, NARRATIVE_FIELDS, parseHeadingId, splitSections, type SplitDoc} from './splitSections'
import {
  buildLabelMap,
  convertValue,
  fieldInfo,
  looseCode,
  targetLabel,
  withTypeSegment,
  type ConvertedValue,
  type FieldInfo,
} from './fieldTable'
import {convertField, convertTypesFor, PENDING_UPLOAD} from './htmlToPortableText'
import {decoratorsOf, mergeResults, validateBlocks, type ValidationResult} from './validate'
import {DEFAULT_VERSION, defaultSlug, spotTypeFromId, toRecord, withoutPendingImages} from './records'
import {importSpots} from './importSpots'

const DOC_TYPE = 'spot'
// One stable object: useClient() hands back a new client whenever this object's identity changes.
const CLIENT_OPTIONS = {apiVersion: API_VERSION}
// Required on a new spot; filled from the H1 / ID when the doc has no row for them.
const CORE_FIELDS = ['name', 'slug', 'spotType', 'version'] as const

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

interface FieldRow {
  key: string
  num: string // "6" in "★ 6.  Latitude"; '' for rows the tool added
  label: string
  required: boolean // starred in the doc
  text: string // the value, editable
  field: string // target spot field; '' = not imported
  include: boolean | null // null: the default (see includeByDefault)
  fromDoc: boolean // false: added by the tool for a required field the doc has no row for
  touched: boolean // edited by hand
  picks: Record<number, string> // value index -> chosen _id, when a value matched several documents
}

interface SpotState {
  split: SplitDoc
  id: string // as written in the doc / typed
  rows: FieldRow[]
  assign: string[] // per unmatched section: '' (leave out) or a field name
  fields: Record<string, any[]> // converted Portable Text per field
  convertWarnings: string[]
}

// Doc rows are written; a new slug is never pushed onto an existing spot. The rows the tool adds
// only fill in what a new spot needs.
function includeByDefault(row: FieldRow, exists: boolean): boolean {
  if (!row.field) return false
  if (row.fromDoc) return !(exists && row.field === 'slug')
  return !exists
}

const rowIncluded = (row: FieldRow, exists: boolean) => Boolean(row.field) && (row.include ?? includeByDefault(row, exists))

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

function newSpot(
  split: SplitDoc,
  ctx: {labelMap: Map<string, string>; infos: Record<string, FieldInfo>; regionSlugs: Map<string, string>; schema: any},
): SpotState {
  const id = split.id
  const rows: FieldRow[] = split.meta.map((m, i) => {
    const field = ctx.labelMap.get(fkey(m.label)) ?? ''
    return {
      key: `doc-${i}`,
      num: m.num,
      label: m.label,
      required: m.required,
      text: m.text,
      field: ctx.infos[field] ? field : '',
      include: null,
      fromDoc: true,
      touched: false,
      picks: {},
    }
  })
  const textOf = (f: string) => rows.find((r) => r.field === f && r.text)?.text
  const name = textOf('name') ?? parseHeadingId(split.title)?.label ?? (split.title || parseHeadingId(id)?.label || '')
  const added: Record<string, string> = {
    name,
    slug: defaultSlug(id, name, ctx.regionSlugs),
    spotType: spotTypeFromId(id),
    version: DEFAULT_VERSION,
  }
  const extra = CORE_FIELDS.filter((f) => ctx.infos[f] && !rows.some((r) => r.field === f)).map(
    (f): FieldRow => ({
      key: `add-${f}`,
      num: '',
      label: ctx.infos[f].title,
      required: true,
      text: added[f],
      field: f,
      include: null,
      fromDoc: false,
      touched: false,
      picks: {},
    }),
  )
  return convertSpot(
    {split, id, rows: [...extra, ...rows], assign: split.unmatched.map(() => ''), fields: {}, convertWarnings: []},
    ctx.schema,
  )
}

/** The id the spot is matched and stored under: the doc's id, an existing spot's, or the doc's completed with the type segment. */
function resolveSpotId(typed: string, spotType: string, index: RefIndex | null): {id: string; note?: string} {
  const id = typed.trim()
  if (!id || !index) return {id}
  const spots = [...index.values()].filter((t) => t.type === DOC_TYPE)
  if (spots.some((t) => t.ids.has(id))) return {id}
  const loose = looseCode(id)
  const same = spots.filter((t) => [...t.ids].some((v) => looseCode(v) === loose))
  if (loose && same.length === 1) {
    const existing = targetLabel(same[0])
    return {id: existing, note: `Matched the existing spot “${existing}”; the doc's ID is “${id}”.`}
  }
  const fixed = withTypeSegment(id, spotType.split('-')[0] ?? '')
  if (fixed !== id) return {id: fixed, note: `The doc's ID “${id}” has no spot-type segment; it is stored as “${fixed}”.`}
  return {id}
}

function shown(value: any): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return value.map(shown).join(', ')
  if (value && typeof value === 'object') return value.current ?? value._ref ?? JSON.stringify(value)
  return String(value)
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

// What the review screen works out for one spot on every render.
interface SpotView {
  matchId: string
  idNote?: string
  exists: boolean
  converted: (ConvertedValue | null)[] // per row
}

function RefChips({
  conv,
  picks,
  onPick,
}: {
  conv: ConvertedValue
  picks: Record<number, string>
  onPick: (index: number, id: string) => void
}) {
  return (
    <Flex gap={1} wrap="wrap">
      {(conv.refs ?? []).map((r, i) =>
        r.target ? (
          <Badge key={i} tone="positive" title={r.how ? `matched by ${r.how}: ${r.token}` : r.token}>
            {targetLabel(r.target)}
            {r.how ? ` (by ${r.how})` : ''}
          </Badge>
        ) : r.candidates.length ? (
          <Select key={i} fontSize={1} padding={2} value={picks[i] ?? ''} onChange={(e) => onPick(i, e.currentTarget.value)}>
            <option value="">“{r.token}” — pick one ({r.candidates.length} match)…</option>
            {r.candidates.slice(0, 60).map((c) => (
              <option key={c.baseId} value={c.baseId}>
                {targetLabel(c)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge key={i} tone="critical">
            not found: {r.token}
          </Badge>
        ),
      )}
    </Flex>
  )
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

  // Every spot field the field table can fill: not the ID (that is the match), not the narratives.
  const infos = useMemo(() => {
    const specs = docType ? readFieldSpecs(docType) : {}
    const out: Record<string, FieldInfo> = {}
    for (const f of docType?.fields ?? []) {
      if (f.name === 'id' || (NARRATIVE_FIELDS as readonly string[]).includes(f.name)) continue
      const info = fieldInfo(f, specs[f.name])
      if (info.kind !== 'unsupported') out[f.name] = info
    }
    return out
  }, [docType])
  const labelMap = useMemo(
    () => buildLabelMap((docType?.fields ?? []).map((f: any) => ({name: f.name, title: f.type?.title}))),
    [docType],
  )

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

  // The documents reference values are matched against, and the spots themselves (for the ID).
  const refTypes = useMemo(
    () => [...new Set([DOC_TYPE, ...Object.values(infos).flatMap((i) => i.spec.ref?.to ?? [])])].sort(),
    [infos],
  )
  const [refIndex, setRefIndex] = useState<RefIndex | null>(null)
  const [refError, setRefError] = useState('')
  useEffect(() => {
    let live = true
    client
      .withConfig({perspective: 'raw'})
      .fetch<RawRefDoc[]>(`*[_type in $types && !(_id in path("versions.**"))]{_id, _type, id, name, title}`, {types: refTypes})
      .then((docs) => live && setRefIndex(buildRefIndex(docs ?? [])))
      .catch((e) => live && setRefError(e.message))
    return () => {
      live = false
    }
  }, [client, refTypes])

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
        setSpots(split.map((s) => newSpot(s, {labelMap, infos, regionSlugs, schema})))
        if (!split.length) toast.push({status: 'warning', title: 'The document is empty.'})
      } catch (e: any) {
        toast.push({status: 'error', title: 'Could not read the Word file', description: e.message})
      } finally {
        setParsing(false)
      }
    },
    [fieldMap, labelMap, infos, regionSlugs, schema, toast],
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
      setSpots((prev) => prev.map((s, j) => (j !== i ? s : patch.assign ? convertSpot({...s, ...patch}, schema) : {...s, ...patch})))
    },
    [schema],
  )

  // A changed name or ID moves the suggested slug along, until the slug is edited by hand.
  const updateRow = useCallback(
    (i: number, key: string, patch: Partial<FieldRow>) => {
      setResults(null)
      setSpots((prev) =>
        prev.map((s, j) => {
          if (j !== i) return s
          let rows = s.rows.map((r) => (r.key === key ? {...r, ...patch} : r))
          const changed = rows.find((r) => r.key === key)
          if (changed?.field === 'name' && patch.text !== undefined) rows = followSlug(rows, s.id, regionSlugs)
          return {...s, rows}
        }),
      )
    },
    [regionSlugs],
  )
  const updateId = useCallback(
    (i: number, id: string) => {
      setResults(null)
      setSpots((prev) => prev.map((s, j) => (j !== i ? s : {...s, id, rows: followSlug(s.rows, id, regionSlugs)})))
    },
    [regionSlugs],
  )

  // Per spot: the id it is stored under, and every row's converted value.
  const spotTypeOf = useCallback(
    (s: SpotState) => {
      const row = s.rows.find((r) => r.field === 'spotType' && r.text)
      const conv = row && infos.spotType ? convertValue(row.text, infos.spotType, {index: null}) : null
      return (conv?.value as string | undefined) ?? spotTypeFromId(s.id)
    },
    [infos],
  )
  const idViews = useMemo(
    () => spots.map((s) => resolveSpotId(s.id, spotTypeOf(s), refIndex)),
    [spots, spotTypeOf, refIndex],
  )

  // Which ids already exist (draft or published), so new and existing spots are shown apart.
  const idsKey = idViews.map((v) => v.id).join('\n')
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

  const views = useMemo(
    () =>
      spots.map((s, i): SpotView => {
        const {id: matchId, note} = idViews[i]
        const region = codeOf(matchId).split('.')[0] ?? ''
        return {
          matchId,
          idNote: note,
          exists: isExisting(matchId),
          converted: s.rows.map((r) =>
            r.field && infos[r.field] ? convertValue(r.text, infos[r.field], {index: refIndex, region, picks: r.picks}) : null,
          ),
        }
      }),
    [spots, idViews, isExisting, infos, refIndex],
  )

  /** The field values a spot writes: the ticked rows that produced a value. */
  const rowFields = useCallback(
    (s: SpotState, v: SpotView) => {
      const out: Record<string, any> = {}
      s.rows.forEach((r, ri) => {
        const value = v.converted[ri]?.value
        if (rowIncluded(r, v.exists) && value !== undefined) out[r.field] = value
      })
      return out
    },
    [],
  )

  // Per-spot checks. Errors block the import.
  const checks = useMemo(() => {
    const counts = new Map<string, number>()
    views.forEach((v) => counts.set(v.matchId, (counts.get(v.matchId) ?? 0) + 1))
    return spots.map((s, i): ValidationResult => {
      const v = views[i]
      const id = v.matchId
      const errors: string[] = []
      const warnings: string[] = [...s.convertWarnings]
      if (!id) errors.push('ID is required — e.g. "BB.WE.fs - West End of the Canal".')
      else if (!parseHeadingId(id)) warnings.push('ID is not in the "CODE - Label" form other spots use.')
      if (id && (counts.get(id) ?? 0) > 1) errors.push('Another spot in this document has the same ID.')
      const fields = rowFields(s, v)
      if (id && !v.exists) {
        for (const f of CORE_FIELDS) {
          if (infos[f] && (fields[f] === undefined || fields[f] === '')) errors.push(`${infos[f].title} is required for a new spot.`)
        }
      }
      const written = new Map<string, string>()
      s.rows.forEach((r, ri) => {
        if (!rowIncluded(r, v.exists)) return
        for (const p of v.converted[ri]?.problems ?? []) warnings.push(`${r.label}: ${p}`)
        if (written.has(r.field)) warnings.push(`${r.label} and ${written.get(r.field)} both go to ${infos[r.field]?.title}; the later row wins.`)
        written.set(r.field, r.label)
      })
      const unmapped = s.rows.filter((r) => r.fromDoc && !r.field && r.text).map((r) => r.label)
      if (unmapped.length) warnings.push(`Not imported (no field chosen): ${unmapped.join(', ')}.`)
      if (!Object.keys(s.fields).length) warnings.push('No section of this spot matched a narrative field.')
      s.split.unmatched.forEach((u, ui) => {
        if (!s.assign[ui] && u.html.trim()) warnings.push(`The section "${u.heading}" matches no field and will not be imported.`)
      })
      const blocks = Object.entries(s.fields).map(([f, val]) => validateBlocks(f, val, decoratorsOf(convertTypesFor(schema, DOC_TYPE, f)?.field)))
      return mergeResults({errors, warnings}, ...blocks)
    })
  }, [spots, views, rowFields, infos, schema])

  const blocked = checks.some((c) => c.errors.length > 0) || existing === null || refIndex === null

  const recordsFor = useCallback(
    (forDownload: boolean) => {
      let dropped = 0
      const records = spots.map((s, i) => {
        const narratives: Record<string, any[]> = {}
        for (const [f, v] of Object.entries(s.fields)) {
          if (!forDownload) narratives[f] = v
          else {
            const r = withoutPendingImages(v)
            narratives[f] = r.blocks
            dropped += r.dropped
          }
        }
        return toRecord(views[i].matchId, rowFields(s, views[i]), narratives)
      })
      return {records, dropped}
    },
    [spots, views, rowFields],
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
  const fieldOptions = useMemo(() => Object.values(infos).sort((a, b) => a.title.localeCompare(b.title)), [infos])
  const newCount = views.filter((v) => v.matchId && existing && !v.exists).length
  const updateCount = views.filter((v) => v.matchId && v.exists).length

  return (
    <Box padding={4}>
      <Stack gap={4} style={{maxWidth: 1100, margin: '0 auto'}}>
        <Stack gap={2}>
          <Heading size={3}>Import Word Doc</Heading>
          <Text size={1} muted>
            Spots only. A spot starts at its “Field | Value” table (★ 1. ID, 2. Version, 3. Name …) or at a Heading 1
            written as its ID (“BB.WE.fs - West End of the Canal”). Each table row is matched to a spot field — check
            the matches and untick anything you don’t want written. Each Heading 2 starts a section: Capt Mike’s Notes,
            Historical Analysis … Q&amp;A with Capt Mike. A spot that already exists has only the ticked fields and the
            sections in the document replaced in its draft; a new spot is created as a draft. Nothing is published.
          </Text>
        </Stack>

        {!docType && (
          <Messages tone="critical" title="Cannot import" items={["This Studio's schema has no spot type."]} />
        )}
        {refError && (
          <Messages tone="critical" title="Could not load the documents references are matched against" items={[refError]} />
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
          const v = views[i]
          const check = checks[i]
          const missing = narrativeOptions.filter((f) => !s.fields[f])
          const ticked = s.rows.filter((r) => rowIncluded(r, v.exists)).length
          return (
            <Card key={i} padding={4} radius={3} shadow={1}>
              <Stack gap={4}>
                <Flex align="center" gap={2} wrap="wrap">
                  <Heading size={1}>{s.split.title || v.matchId || '(no title)'}</Heading>
                  {v.matchId &&
                    (existing === null || refIndex === null ? (
                      <Badge>checking…</Badge>
                    ) : v.exists ? (
                      <Badge tone="primary">updates existing spot</Badge>
                    ) : (
                      <Badge tone="positive">new spot</Badge>
                    ))}
                </Flex>

                <Stack gap={2}>
                  <Label size={1}>ID</Label>
                  <TextInput value={s.id} onChange={(e) => updateId(i, e.currentTarget.value)} />
                  {v.idNote && (
                    <Text size={1} muted>
                      {v.idNote}
                    </Text>
                  )}
                </Stack>

                <Card padding={3} radius={2} border>
                  <Stack gap={3}>
                    <Flex align="center" gap={2}>
                      <Text size={1} weight="semibold">
                        Fields
                      </Text>
                      <Badge>
                        {ticked} of {s.rows.length} written
                      </Badge>
                    </Flex>
                    {v.exists && (
                      <Text size={1} muted>
                        This spot already exists: only the ticked fields are replaced; empty values leave a field as it
                        is. The slug is not changed unless you tick it.
                      </Text>
                    )}
                    <Grid gap={2} style={{gridTemplateColumns: '24px minmax(130px, 1fr) minmax(170px, 1fr) minmax(220px, 2fr)', alignItems: 'start'}}>
                      <span />
                      <Label size={0} muted>
                        In the doc
                      </Label>
                      <Label size={0} muted>
                        Spot field
                      </Label>
                      <Label size={0} muted>
                        Value
                      </Label>
                      {s.rows.map((r, ri) => {
                        const conv = v.converted[ri]
                        const on = rowIncluded(r, v.exists)
                        return (
                          <RowCells
                            key={r.key}
                            row={r}
                            on={on}
                            conv={conv}
                            info={infos[r.field]}
                            fieldOptions={fieldOptions}
                            onChange={(patch) => updateRow(i, r.key, patch)}
                          />
                        )
                      })}
                    </Grid>
                  </Stack>
                </Card>

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
            <Button icon={DownloadIcon} text="Download JSON" mode="ghost" disabled={Boolean(importing) || refIndex === null} onClick={download} />
            {blocked && !importing && (
              <Text size={1} muted>
                {existing === null || refIndex === null ? 'Checking for existing spots…' : 'Fix the errors above to import.'}
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

/** The suggested slug follows the name and ID while the slug row is the tool's own and untouched. */
function followSlug(rows: FieldRow[], id: string, regionSlugs: Map<string, string>): FieldRow[] {
  const name = rows.find((r) => r.field === 'name')?.text ?? ''
  return rows.map((r) =>
    r.field === 'slug' && !r.fromDoc && !r.touched ? {...r, text: name ? defaultSlug(id, name, regionSlugs) : r.text} : r,
  )
}

function RowCells({
  row,
  on,
  conv,
  info,
  fieldOptions,
  onChange,
}: {
  row: FieldRow
  on: boolean
  conv: ConvertedValue | null
  info?: FieldInfo
  fieldOptions: FieldInfo[]
  onChange: (patch: Partial<FieldRow>) => void
}) {
  const result =
    !row.field ? null : !row.text.trim() ? (
      <Text size={0} muted>
        empty — left as it is
      </Text>
    ) : info?.kind === 'ref' && conv?.refs ? (
      <RefChips conv={conv} picks={row.picks} onPick={(idx, id) => onChange({picks: {...row.picks, [idx]: id}})} />
    ) : conv?.value !== undefined ? (
      <Text size={0} muted>
        → {shown(conv.value)}
      </Text>
    ) : null
  return (
    <>
      <Box paddingTop={2} style={{opacity: on ? 1 : 0.5}}>
        <Checkbox checked={on} disabled={!row.field} onChange={(e) => onChange({include: e.currentTarget.checked})} />
      </Box>
      <Box paddingTop={2} style={{opacity: on ? 1 : 0.6}}>
        <Text size={1}>
          {row.num ? `${row.num}. ` : ''}
          {row.label}
          {row.required ? ' ★' : ''}
          {!row.fromDoc && (
            <Text as="span" size={0} muted>
              {' '}
              (not in the doc)
            </Text>
          )}
        </Text>
      </Box>
      <Select fontSize={1} padding={2} value={row.field} onChange={(e) => onChange({field: e.currentTarget.value, picks: {}})}>
        <option value="">Not imported</option>
        {fieldOptions.map((o) => (
          <option key={o.name} value={o.name}>
            {o.title}
          </option>
        ))}
      </Select>
      <Stack gap={2} style={{opacity: on ? 1 : 0.6}}>
        <TextInput
          fontSize={1}
          padding={2}
          value={row.text}
          onChange={(e) => onChange({text: e.currentTarget.value, touched: true, picks: {}})}
        />
        {result}
        {on && (conv?.problems ?? []).length > 0 && info?.kind !== 'ref' && (
          <Text size={0} style={{color: 'var(--card-badge-critical-fg-color, #c00)'}}>
            {conv!.problems.join(' ')}
          </Text>
        )}
      </Stack>
    </>
  )
}

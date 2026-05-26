import {useState, useCallback, useMemo, useEffect, useRef} from 'react'
import {useClient} from 'sanity'
import {Card, Stack, Text, Button, Select, Box, Flex, Heading, Grid, Label, Badge, Checkbox} from '@sanity/ui'
import Papa from 'papaparse'
import {schemaTypes} from '../schemaTypes'

type Row = Record<string, string>
type DedupeAction = 'skip' | 'update' | 'create'
// How the raw cell of a reference / reference-array column is shaped.
type RefFormat = 'coded' | 'plain' | 'sku'

// type | reference target | array inner type | array-of-reference target
type FieldInfo = {type: string; to?: string; ofType?: string; ofTo?: string}

function getSchema(typeName: string): any {
  return (schemaTypes as any[]).find((t) => t?.name === typeName)
}

/* ===========================================================================
 * ID + token helpers
 * ======================================================================== */

// Sanity _ids allow only [A-Za-z0-9_-]. Codes like "BB.WE.fs" or "EPO.P"
// contain dots, which collide with the reserved `drafts.` / `versions.` id
// prefixes. Sanitize once, consistently, anywhere we MINT an id.
//   "BB.WE.fs" -> "BB-WE-fs" , "EPO.P" -> "EPO-P" , "B500a" -> "B500a"
function toDocId(code: string): string {
  return String(code).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

// Lowercased slug form, for matching against / minting slug fields.
function slugify(s: string): string {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Pull the bare code out of a "CODE - Label" value, e.g.
// "BB.WE.fx.B.C1 - Chasing Spring Birds" -> "BB.WE.fx.B.C1".
// Splits on the FIRST " - " (space-hyphen-space), so hyphens inside a code
// (LGC-210) or em-dashes inside a label (— 1.0 mi) are left alone.
function stripCode(value: string, enabled: boolean): string {
  const v = (value || '').trim()
  if (!enabled) return v
  const idx = v.indexOf(' - ')
  return idx === -1 ? v : v.slice(0, idx).trim()
}

// A code: starts alphanumeric, then letters / digits / dots / hyphens.
const CODE_RE = String.raw`[A-Za-z0-9][A-Za-z0-9.\-]*`
// Split a multi-value cell ONLY at a "," or ";" that is immediately followed
// by a "CODE - " token. This is the crux fix: it splits both comma- and
// semicolon-delimited arrays while leaving commas INSIDE a label untouched,
// e.g. the comma in "...[June, S. Side rips]" does not trigger a split.
const SPLIT_AT_CODE = new RegExp(String.raw`\s*[;,|]\s*(?=${CODE_RE}\s-\s)`)
// Bracketed SKU, e.g. "[PT51P-OL]" — the only reliable id in the mangled
// Lure Catalog column, whose human text was broken by an upstream comma export.
const SKU_RE = /\[([A-Za-z0-9._\-]+)\]/g

// Turn one array cell into a list of raw tokens, per the chosen format.
//  coded  -> code-anchored split, tokens look like "CODE - Label"
//  plain  -> simple split, tokens are bare names ("Spring", "Summer")
//  sku    -> every [SKU] bracket becomes a token
function splitArrayCell(value: string, format: RefFormat): string[] {
  const v = (value || '').trim()
  if (!v) return []
  if (format === 'sku') return [...v.matchAll(SKU_RE)].map((m) => m[1])
  if (format === 'plain') return v.split(/[;,|]/).map((s) => s.trim()).filter(Boolean)
  // coded (default): protects commas inside labels; falls back to the whole
  // string as a single token when no "CODE - " pattern is present.
  return v.split(SPLIT_AT_CODE).map((s) => s.trim()).filter(Boolean)
}

function transformValue(value: string, fieldType: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  switch (fieldType) {
    case 'slug':
      return {_type: 'slug', current: trimmed}
    case 'number': {
      const num = Number(trimmed)
      return isNaN(num) ? trimmed : num
    }
    case 'boolean':
      return ['true', 'yes', '1'].includes(trimmed.toLowerCase())
    case 'reference':
      // Fallback only — resolved references are built in buildDoc.
      return {_type: 'reference', _ref: trimmed}
    case 'geopoint': {
      const [lat, lng] = trimmed.split(',').map((s) => parseFloat(s.trim()))
      if (!isNaN(lat) && !isNaN(lng)) return {_type: 'geopoint', lat, lng}
      return trimmed
    }
    case 'array':
      // Plain string array. Reference arrays are handled in buildDoc.
      return trimmed.split(/[;|]/).map((s) => s.trim()).filter(Boolean)
    default:
      return trimmed
  }
}

function autoMapColumns(csvHeaders: string[], fieldNames: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const normalize = (s: string) => s.toLowerCase().trim().replace(/[\s_-]/g, '')
  for (const header of csvHeaders) {
    if (fieldNames.includes(header)) {
      mapping[header] = header
      continue
    }
    const match = fieldNames.find((f) => normalize(f) === normalize(header))
    mapping[header] = match || ''
  }
  return mapping
}

// Candidate fields on a target type that we can match a reference against.
// '_id' means "the CSV value is already the document _id" (old behavior).
function refMatchOptions(targetType?: string): string[] {
  const opts = ['_id']
  const s = getSchema(targetType || '')
  if (s?.fields) {
    for (const f of s.fields) {
      if (['string', 'slug', 'number'].includes(f.type)) opts.push(f.name)
    }
  }
  return opts
}

function defaultRefMatch(targetType?: string): string {
  const opts = refMatchOptions(targetType)
  if (opts.includes('id')) return 'id'
  if (opts.includes('slug')) return 'slug'
  if (opts.includes('title')) return 'title'
  return '_id'
}

function targetFieldType(targetType: string, fieldName: string): string {
  if (fieldName === '_id') return 'string'
  const s = getSchema(targetType)
  const f = s?.fields?.find((x: any) => x.name === fieldName)
  return f?.type || 'string'
}

type Pending = {_id: string; _type: string; field: string; fieldType: string; value: string}

export function BulkImportTool() {
  const client = useClient({apiVersion: '2024-01-01'})

  const importableTypes = useMemo(() => {
    return (schemaTypes as any[])
      .filter((t) => t && t.type === 'document')
      .map((t) => ({value: t.name, label: t.title || t.name}))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  const [docType, setDocType] = useState(importableTypes[0]?.value || '')
  const [rows, setRows] = useState<Row[]>([])
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [refMatch, setRefMatch] = useState<Record<string, string>>({})
  const [refFormat, setRefFormat] = useState<Record<string, RefFormat>>({})
  const [stripPrefix, setStripPrefix] = useState(true)
  const [createStubs, setCreateStubs] = useState(false)
  const [dedupeField, setDedupeField] = useState<string>('')
  const [dedupeAction, setDedupeAction] = useState<DedupeAction>('skip')
  const [status, setStatus] = useState<string>('')
  const [importing, setImporting] = useState(false)

  // value -> resolved _id (or null), keyed by target|matchField|value. Cleared per import.
  const refCache = useRef<Map<string, string | null>>(new Map())
  // Placeholder docs to create when "create stubs" is on. Keyed by _id.
  const pendingStubs = useRef<Map<string, Pending>>(new Map())

  const fieldMap = useMemo(() => {
    const schema = getSchema(docType)
    const map: Record<string, FieldInfo> = {}
    if (schema?.fields) {
      for (const f of schema.fields) {
        const entry: FieldInfo = {type: f.type}
        if (f.type === 'reference') {
          entry.to = f.to?.[0]?.type
        }
        if (f.type === 'array') {
          const inner = f.of?.[0]
          entry.ofType = inner?.type
          if (inner?.type === 'reference') entry.ofTo = inner?.to?.[0]?.type
        }
        map[f.name] = entry
      }
    }
    return map
  }, [docType])

  const schemaFieldNames = useMemo(() => Object.keys(fieldMap), [fieldMap])

  // Reference and reference-array fields that need resolution config.
  const referenceFields = useMemo(
    () => schemaFieldNames.filter((n) => fieldMap[n].type === 'reference' || fieldMap[n].ofTo),
    [schemaFieldNames, fieldMap],
  )

  // Default the match field + value format for each reference field when the
  // doc type changes.
  useEffect(() => {
    const match: Record<string, string> = {}
    const fmt: Record<string, RefFormat> = {}
    for (const name of referenceFields) {
      const target = fieldMap[name].to || fieldMap[name].ofTo
      match[name] = defaultRefMatch(target)
      fmt[name] = 'coded'
    }
    setRefMatch(match)
    setRefFormat(fmt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType])

  // Re-map columns when docType changes if a CSV is already loaded.
  useEffect(() => {
    if (csvHeaders.length > 0) {
      setMapping(autoMapColumns(csvHeaders, schemaFieldNames))
      setDedupeField('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType])

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setFileName(file.name)
      setStatus('')
      Papa.parse<Row>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const headers = results.meta.fields || []
          setCsvHeaders(headers)
          setRows(results.data)
          setMapping(autoMapColumns(headers, schemaFieldNames))
          setStatus(`Parsed ${results.data.length} rows. Map columns and import.`)
        },
        error: (err) => setStatus(`Parse error: ${err.message}`),
      })
    },
    [schemaFieldNames],
  )

  const updateMapping = useCallback((csvCol: string, schemaField: string) => {
    setMapping((prev) => ({...prev, [csvCol]: schemaField}))
  }, [])

  const updateRefMatch = useCallback((field: string, matchField: string) => {
    setRefMatch((prev) => ({...prev, [field]: matchField}))
  }, [])

  const updateRefFormat = useCallback((field: string, format: RefFormat) => {
    setRefFormat((prev) => ({...prev, [field]: format}))
  }, [])

  // Resolve a raw CSV token to a real document _id.
  //  1. Strip the "CODE - Label" suffix to a bare code.
  //  2. Mint a dot-safe id from it. If that id belongs to a row in THIS
  //     import, use it directly (handles cross-references regardless of order).
  //  3. Otherwise look the code up in the Content Lake by the chosen field.
  //  4. If unresolved and "create stubs" is on, register a placeholder and
  //     return its id so the reference still points somewhere real.
  const resolveRef = useCallback(
    async (
      rawValue: string,
      targetType: string | undefined,
      matchField: string | undefined,
      importIds: Set<string>,
    ): Promise<string | null> => {
      const code = stripCode(rawValue, stripPrefix) // human code, e.g. "BB.WE.fs"
      if (!code || !targetType) return null
      const id = toDocId(code) // dot-safe minted id, e.g. "BB-WE-fs"

      // Cross-reference to another row in this import.
      if (importIds.has(id)) return id

      const mf = matchField || '_id'
      const cacheKey = `${targetType}|${mf}|${code}`
      if (refCache.current.has(cacheKey)) return refCache.current.get(cacheKey) || null

      let resolved: string | null = null
      if (mf === '_id') {
        // Value is already the document id — use the dot-safe form.
        resolved = id
      } else {
        const ft = targetFieldType(targetType, mf)
        const lookupVal = ft === 'slug' ? slugify(code) : code
        const path = ft === 'slug' ? `${mf}.current` : mf
        const query = `*[_type == $t && ${path} == $v][0]._id`
        resolved = await client.fetch(query, {t: targetType, v: lookupVal})

        // Not found — optionally mint a placeholder so the ref resolves.
        if (!resolved && createStubs) {
          pendingStubs.current.set(id, {
            _id: id,
            _type: targetType,
            field: mf,
            fieldType: ft,
            value: ft === 'slug' ? slugify(code) : code,
          })
          resolved = id
        }
      }

      refCache.current.set(cacheKey, resolved || null)
      return resolved || null
    },
    [client, stripPrefix, createStubs],
  )

  const buildDoc = useCallback(
    async (
      row: Row,
      importIds: Set<string>,
    ): Promise<{doc: Record<string, unknown>; unresolved: string[]}> => {
      const doc: Record<string, unknown> = {_type: docType}
      const unresolved: string[] = []

      for (const [csvCol, schemaField] of Object.entries(mapping)) {
        if (!schemaField) continue
        const value = row[csvCol]
        if (value === '' || value == null) continue
        const field = fieldMap[schemaField]
        if (!field) continue

        // Single reference — resolve to a real _id.
        if (field.type === 'reference') {
          const id = await resolveRef(value, field.to, refMatch[schemaField], importIds)
          if (id) {
            // Weak ref: Sanity requires the PUBLISHED target to exist for a
            // strong ref. We import as drafts and targets may not exist yet,
            // so weak avoids "references non-existent document" failures.
            doc[schemaField] = {_type: 'reference', _ref: id, _weak: true}
          } else {
            unresolved.push(`${schemaField}="${value.trim()}"`)
          }
          continue
        }

        // Array of references — split per the column's format, resolve each,
        // wrap with a deterministic _key (stable across re-imports).
        if (field.ofTo) {
          const parts = splitArrayCell(value, refFormat[schemaField] || 'coded')
          const refs: any[] = []
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i]
            const id = await resolveRef(part, field.ofTo, refMatch[schemaField], importIds)
            if (id) {
              refs.push({_type: 'reference', _ref: id, _key: `${id}-${i}`, _weak: true})
            } else {
              unresolved.push(`${schemaField}="${part}"`)
            }
          }
          if (refs.length) doc[schemaField] = refs
          continue
        }

        // The id/code key field: store the bare code, not "CODE - Label".
        if (schemaField === 'id' && stripPrefix) {
          doc[schemaField] = stripCode(value, true)
          continue
        }

        // Everything else.
        const transformed = transformValue(value, field.type)
        if (transformed !== undefined) doc[schemaField] = transformed
      }

      return {doc, unresolved}
    },
    [docType, mapping, fieldMap, refMatch, refFormat, stripPrefix, resolveRef],
  )

  const findExisting = useCallback(
    async (dedupeValue: string) => {
      if (!dedupeField || !dedupeValue) return null
      const field = fieldMap[dedupeField]
      if (!field) return null
      const fieldPath = field.type === 'slug' ? `${dedupeField}.current` : dedupeField
      const query = `*[_type == $type && ${fieldPath} == $value]`
      const results: any[] = await client.fetch(query, {type: docType, value: dedupeValue})
      if (!results.length) return null
      const draft = results.find((r) => r._id.startsWith('drafts.'))
      return draft || results[0]
    },
    [client, docType, dedupeField, fieldMap],
  )

  const handleImport = useCallback(async () => {
    if (!rows.length || !docType) return
    setImporting(true)
    setStatus(`Importing ${rows.length} documents...`)
    refCache.current.clear()
    pendingStubs.current.clear()

    const dedupeCsvCol = Object.entries(mapping).find(([, sf]) => sf === dedupeField)?.[0]

    // First pass: collect the dot-safe id of every row's code column. Created
    // docs are keyed by this id, so cross-references inside the file resolve
    // directly (independent of row order).
    const idCol = Object.entries(mapping).find(([, sf]) => sf === 'id')?.[0]
    const idFor = (row: Row) => (idCol ? toDocId(stripCode(row[idCol] ?? '', stripPrefix)) : '')
    const importIds = new Set<string>(rows.map(idFor).filter(Boolean))

    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    const unresolvedAll = new Set<string>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const {doc, unresolved} = await buildDoc(row, importIds)
      unresolved.forEach((u) => unresolvedAll.add(u))

      try {
        if (dedupeField && dedupeCsvCol) {
          const dedupeValue = row[dedupeCsvCol]?.trim()
          if (dedupeValue) {
            const existing = await findExisting(dedupeValue)
            if (existing) {
              if (dedupeAction === 'skip') {
                skipped++
                continue
              }
              if (dedupeAction === 'update') {
                const baseId = existing._id.replace(/^drafts\./, '')
                doc._id = `drafts.${baseId}`
                await client.createOrReplace(doc as any)
                updated++
                continue
              }
              // 'create' falls through
            }
          }
        }

        const id = idFor(row)
        doc._id = `drafts.${id || crypto.randomUUID()}`
        await client.create(doc as any)
        created++
      } catch (err) {
        errors.push(`Row ${i + 1}: ${(err as Error).message}`)
      }
    }

    // Create any placeholder docs collected for unresolved references. These
    // are PUBLISHED minimal docs so the spot references resolve immediately;
    // enrich them later. createIfNotExists never clobbers a real doc.
    let stubs = 0
    if (createStubs && pendingStubs.current.size) {
      for (const s of pendingStubs.current.values()) {
        try {
          const stub: Record<string, unknown> = {_id: s._id, _type: s._type, _stub: true}
          stub[s.field === '_id' ? 'code' : s.field] =
            s.fieldType === 'slug' ? {_type: 'slug', current: s.value} : s.value
          await client.createIfNotExists(stub as any)
          stubs++
        } catch (err) {
          errors.push(`Stub ${s._id}: ${(err as Error).message}`)
        }
      }
    }

    setImporting(false)

    const parts: string[] = []
    if (created) parts.push(`Created ${created}`)
    if (updated) parts.push(`Updated ${updated}`)
    if (skipped) parts.push(`Skipped ${skipped}`)
    if (stubs) parts.push(`${stubs} placeholder${stubs === 1 ? '' : 's'}`)
    if (unresolvedAll.size) parts.push(`${unresolvedAll.size} unresolved ref${unresolvedAll.size === 1 ? '' : 's'}`)
    if (errors.length) parts.push(`${errors.length} error${errors.length === 1 ? '' : 's'}`)

    const hasProblems = errors.length || unresolvedAll.size
    const prefix = hasProblems ? '⚠️' : '✅'
    const detail: string[] = []
    if (unresolvedAll.size) {
      detail.push('Unresolved (left empty): ' + Array.from(unresolvedAll).slice(0, 5).join(', '))
    }
    if (errors.length) detail.push('First error: ' + errors[0])
    setStatus(`${prefix} ${parts.join(', ')}.${detail.length ? ' ' + detail.join(' | ') : ''}`)

    if (!hasProblems) {
      setRows([])
      setCsvHeaders([])
      setFileName('')
      setMapping({})
    }
  }, [rows, docType, mapping, dedupeField, dedupeAction, stripPrefix, createStubs, buildDoc, findExisting, client])

  return (
    <Box padding={4}>
      <Stack space={5}>
        <Heading size={2}>Bulk Import</Heading>

        <Card padding={4} radius={2} tone="primary" border>
          <Stack space={3}>
            <Text size={1} weight="semibold">1. Choose document type</Text>
            <Select value={docType} onChange={(e) => setDocType(e.currentTarget.value)}>
              {importableTypes.length === 0 ? (
                <option value="">No document types found</option>
              ) : (
                importableTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))
              )}
            </Select>
          </Stack>
        </Card>

        <Card padding={4} radius={2} tone="primary" border>
          <Stack space={3}>
            <Text size={1} weight="semibold">2. Upload CSV</Text>
            <input type="file" accept=".csv" onChange={handleFile} />
            {fileName && <Text size={1} muted>Selected: {fileName} ({rows.length} rows)</Text>}
          </Stack>
        </Card>

        {csvHeaders.length > 0 && (
          <Card padding={4} radius={2} tone="primary" border>
            <Stack space={4}>
              <Text size={1} weight="semibold">3. Map CSV columns to schema fields</Text>
              <Text size={0} muted>
                Auto-matched where names are similar. Pick "— Skip —" to ignore a column.
              </Text>
              <Stack space={2}>
                {csvHeaders.map((header) => (
                  <Grid key={header} columns={2} gap={3}>
                    <Box>
                      <Text size={1} style={{fontFamily: 'monospace'}}>{header}</Text>
                    </Box>
                    <Select
                      value={mapping[header] || ''}
                      onChange={(e) => updateMapping(header, e.currentTarget.value)}
                    >
                      <option value="">— Skip —</option>
                      {schemaFieldNames.map((f) => (
                        <option key={f} value={f}>
                          {f} ({fieldMap[f].ofTo ? `array<ref→${fieldMap[f].ofTo}>` : fieldMap[f].type})
                        </option>
                      ))}
                    </Select>
                  </Grid>
                ))}
              </Stack>
            </Stack>
          </Card>
        )}

        {csvHeaders.length > 0 && referenceFields.length > 0 && (
          <Card padding={4} radius={2} tone="primary" border>
            <Stack space={4}>
              <Text size={1} weight="semibold">4. Resolve references</Text>
              <Text size={0} muted>
                For each reference field, pick which field on the <em>target</em> document to match
                against, and how the CSV cell is shaped. The match is looked up and the real{' '}
                <code>_id</code> is written. Unresolved values are left empty unless "create
                placeholders" is on.
              </Text>

              <Flex align="center" gap={2} paddingY={1}>
                <Checkbox
                  id="strip-prefix"
                  checked={stripPrefix}
                  onChange={(e) => setStripPrefix(e.currentTarget.checked)}
                />
                <Box>
                  <Text size={1} as="label" htmlFor="strip-prefix">
                    Strip <code>CODE - Label</code> prefix before matching
                  </Text>
                  <Text size={0} muted>
                    Matches the bare code (e.g. <code>BB.WE.fx.B.C1 - Chasing Spring Birds</code> →{' '}
                    <code>BB.WE.fx.B.C1</code>). Cross-references to other rows in this file resolve
                    automatically. Dots in codes are made id-safe (<code>BB.WE.fs</code> →{' '}
                    <code>BB-WE-fs</code>).
                  </Text>
                </Box>
              </Flex>

              <Flex align="center" gap={2} paddingY={1}>
                <Checkbox
                  id="create-stubs"
                  checked={createStubs}
                  onChange={(e) => setCreateStubs(e.currentTarget.checked)}
                />
                <Box>
                  <Text size={1} as="label" htmlFor="create-stubs">
                    Create placeholder docs for unresolved references
                  </Text>
                  <Text size={0} muted>
                    Mints a minimal published document for any reference target that doesn't exist
                    yet, so every reference points somewhere real. Enrich them later; safe to re-run.
                  </Text>
                </Box>
              </Flex>

              <Stack space={3}>
                {referenceFields.map((field) => {
                  const target = fieldMap[field].to || fieldMap[field].ofTo
                  const isArray = Boolean(fieldMap[field].ofTo)
                  const mapped = Object.values(mapping).includes(field)
                  return (
                    <Grid key={field} columns={2} gap={3}>
                      <Box>
                        <Flex align="center" gap={2}>
                          <Text size={1} style={{fontFamily: 'monospace'}}>{field}</Text>
                          {isArray && <Badge tone="primary" fontSize={0}>array</Badge>}
                          {!mapped && <Badge tone="caution" fontSize={0}>not mapped</Badge>}
                        </Flex>
                        <Text size={0} muted>→ {target}</Text>
                      </Box>
                      <Stack space={2}>
                        <Select
                          value={refMatch[field] || '_id'}
                          onChange={(e) => updateRefMatch(field, e.currentTarget.value)}
                        >
                          {refMatchOptions(target).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt === '_id' ? '_id (value is already the ID)' : `match on ${opt}`}
                            </option>
                          ))}
                        </Select>
                        {isArray && (
                          <Select
                            value={refFormat[field] || 'coded'}
                            onChange={(e) => updateRefFormat(field, e.currentTarget.value as RefFormat)}
                          >
                            <option value="coded">format: CODE - Label (comma/semicolon)</option>
                            <option value="plain">format: plain names (Spring, Summer)</option>
                            <option value="sku">format: bracketed [SKU]</option>
                          </Select>
                        )}
                      </Stack>
                    </Grid>
                  )
                })}
              </Stack>
            </Stack>
          </Card>
        )}

        {csvHeaders.length > 0 && (
          <Card padding={4} radius={2} tone="primary" border>
            <Stack space={4}>
              <Text size={1} weight="semibold">5. Deduplication (optional)</Text>
              <Text size={0} muted>
                Pick a field to check against existing documents. If a match is found, choose what to do.
              </Text>
              <Grid columns={2} gap={3}>
                <Stack space={2}>
                  <Label size={1}>Dedupe field</Label>
                  <Select value={dedupeField} onChange={(e) => setDedupeField(e.currentTarget.value)}>
                    <option value="">— None (always create) —</option>
                    {schemaFieldNames
                      .filter((f) => ['string', 'slug', 'number'].includes(fieldMap[f].type))
                      .map((f) => (
                        <option key={f} value={f}>{f} ({fieldMap[f].type})</option>
                      ))}
                  </Select>
                </Stack>
                <Stack space={2}>
                  <Label size={1}>When duplicate found</Label>
                  <Select
                    value={dedupeAction}
                    onChange={(e) => setDedupeAction(e.currentTarget.value as DedupeAction)}
                    disabled={!dedupeField}
                  >
                    <option value="skip">Skip — leave existing alone</option>
                    <option value="update">Update — overwrite existing</option>
                    <option value="create">Create anyway (allows duplicates)</option>
                  </Select>
                </Stack>
              </Grid>
            </Stack>
          </Card>
        )}

        {status && (
          <Card
            padding={3}
            radius={2}
            tone={status.startsWith('⚠️') ? 'caution' : status.startsWith('✅') ? 'positive' : 'primary'}
          >
            <Text size={1}>{status}</Text>
          </Card>
        )}

        {rows.length > 0 && (
          <Stack space={3}>
            <Text size={1} weight="semibold">Preview (first 5 rows)</Text>
            <Card padding={3} radius={2} border overflow="auto">
              <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 13}}>
                <thead>
                  <tr>
                    {csvHeaders.map((h) => (
                      <th key={h} style={{textAlign: 'left', padding: 4, borderBottom: '1px solid #ddd'}}>
                        {h}
                        {mapping[h] ? (
                          <div style={{fontSize: 11, color: '#999', fontWeight: 400}}>→ {mapping[h]}</div>
                        ) : (
                          <div style={{fontSize: 11, color: '#c00', fontWeight: 400}}>(skipped)</div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {csvHeaders.map((h) => (
                        <td key={h} style={{padding: 4, borderBottom: '1px solid #eee'}}>{row[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Flex>
              <Button
                text={importing ? 'Importing...' : `Import ${rows.length} rows`}
                tone="primary"
                disabled={importing || !docType}
                onClick={handleImport}
              />
            </Flex>
          </Stack>
        )}
      </Stack>
    </Box>
  )
}

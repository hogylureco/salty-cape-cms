import {useState, useCallback, useMemo, useEffect, useRef} from 'react'
import {useClient} from 'sanity'
import {Card, Stack, Text, Button, Select, Box, Flex, Heading, Grid, Label, Badge} from '@sanity/ui'
import Papa from 'papaparse'
import {schemaTypes} from '../schemaTypes'

type Row = Record<string, string>
type DedupeAction = 'skip' | 'update' | 'create'

// type | reference target | array inner type | array-of-reference target
type FieldInfo = {type: string; to?: string; ofType?: string; ofTo?: string}

function getSchema(typeName: string): any {
  return (schemaTypes as any[]).find((t) => t?.name === typeName)
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
  const [dedupeField, setDedupeField] = useState<string>('')
  const [dedupeAction, setDedupeAction] = useState<DedupeAction>('skip')
  const [status, setStatus] = useState<string>('')
  const [importing, setImporting] = useState(false)

  // value -> resolved _id (or null), keyed by target|matchField|value. Cleared per import.
  const refCache = useRef<Map<string, string | null>>(new Map())

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

  // Default the match field for each reference field whenever the doc type changes.
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const name of referenceFields) {
      const target = fieldMap[name].to || fieldMap[name].ofTo
      next[name] = defaultRefMatch(target)
    }
    setRefMatch(next)
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

  // Resolve a raw CSV value to a real document _id by matching against a target field.
  const resolveRef = useCallback(
    async (rawValue: string, targetType?: string, matchField?: string): Promise<string | null> => {
      const value = (rawValue || '').trim()
      if (!value || !targetType || !matchField) return null

      const cacheKey = `${targetType}|${matchField}|${value}`
      if (refCache.current.has(cacheKey)) return refCache.current.get(cacheKey) || null

      let id: string | null = null
      if (matchField === '_id') {
        // Value is already the document _id — use as-is (legacy behavior).
        id = value
      } else {
        const ft = targetFieldType(targetType, matchField)
        const path = ft === 'slug' ? `${matchField}.current` : matchField
        const query = `*[_type == $t && ${path} == $v][0]._id`
        id = await client.fetch(query, {t: targetType, v: value})
      }

      refCache.current.set(cacheKey, id || null)
      return id || null
    },
    [client],
  )

  const buildDoc = useCallback(
    async (row: Row): Promise<{doc: Record<string, unknown>; unresolved: string[]}> => {
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
          const id = await resolveRef(value, field.to, refMatch[schemaField])
          if (id) {
            doc[schemaField] = {_type: 'reference', _ref: id}
          } else {
            unresolved.push(`${schemaField}="${value.trim()}"`)
          }
          continue
        }

        // Array of references — split, resolve each, wrap with a _key.
        if (field.ofTo) {
          const parts = value.split(/[;|]/).map((s) => s.trim()).filter(Boolean)
          const refs: any[] = []
          for (const part of parts) {
            const id = await resolveRef(part, field.ofTo, refMatch[schemaField])
            if (id) {
              refs.push({_type: 'reference', _ref: id, _key: crypto.randomUUID().slice(0, 12)})
            } else {
              unresolved.push(`${schemaField}="${part}"`)
            }
          }
          if (refs.length) doc[schemaField] = refs
          continue
        }

        // Everything else.
        const transformed = transformValue(value, field.type)
        if (transformed !== undefined) doc[schemaField] = transformed
      }

      return {doc, unresolved}
    },
    [docType, mapping, fieldMap, refMatch, resolveRef],
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

    const dedupeCsvCol = Object.entries(mapping).find(([, sf]) => sf === dedupeField)?.[0]

    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    const unresolvedAll = new Set<string>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const {doc, unresolved} = await buildDoc(row)
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

        const customId = row._id || row.id
        doc._id = `drafts.${customId ? customId.trim() : crypto.randomUUID()}`
        await client.create(doc as any)
        created++
      } catch (err) {
        errors.push(`Row ${i + 1}: ${(err as Error).message}`)
      }
    }

    setImporting(false)

    const parts: string[] = []
    if (created) parts.push(`Created ${created}`)
    if (updated) parts.push(`Updated ${updated}`)
    if (skipped) parts.push(`Skipped ${skipped}`)
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
  }, [rows, docType, mapping, dedupeField, dedupeAction, buildDoc, findExisting, client])

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
                For each reference field, pick which field on the <em>target</em> document to match the
                CSV value against. The match is looked up and the real <code>_id</code> is written as the
                reference. Pick <code>_id</code> if your CSV already contains document IDs. Unresolved
                values are left empty (not imported as broken refs).
              </Text>
              <Stack space={2}>
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

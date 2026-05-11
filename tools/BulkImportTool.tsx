import {useState, useCallback, useMemo, useEffect} from 'react'
import {useClient} from 'sanity'
import {Card, Stack, Text, Button, Select, Box, Flex, Heading, Grid, Label} from '@sanity/ui'
import Papa from 'papaparse'
import {schemaTypes} from '../schemaTypes'

type Row = Record<string, string>
type DedupeAction = 'skip' | 'update' | 'create'

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
      return {_type: 'reference', _ref: trimmed}
    case 'geopoint': {
      const [lat, lng] = trimmed.split(',').map((s) => parseFloat(s.trim()))
      if (!isNaN(lat) && !isNaN(lng)) return {_type: 'geopoint', lat, lng}
      return trimmed
    }
    case 'array':
      return trimmed.split('|').map((s) => s.trim()).filter(Boolean)
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
  const [dedupeField, setDedupeField] = useState<string>('')
  const [dedupeAction, setDedupeAction] = useState<DedupeAction>('skip')
  const [status, setStatus] = useState<string>('')
  const [importing, setImporting] = useState(false)

  const fieldMap = useMemo(() => {
    const schema = (schemaTypes as any[]).find((t) => t?.name === docType)
    const map: Record<string, {type: string}> = {}
    if (schema?.fields) {
      for (const f of schema.fields) map[f.name] = {type: f.type}
    }
    return map
  }, [docType])

  const schemaFieldNames = useMemo(() => Object.keys(fieldMap), [fieldMap])

  // Re-map when docType changes if a CSV is already loaded
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

  const buildDoc = useCallback(
    (row: Row) => {
      const doc: Record<string, unknown> = {_type: docType}
      for (const [csvCol, schemaField] of Object.entries(mapping)) {
        if (!schemaField) continue
        const value = row[csvCol]
        if (value === '' || value == null) continue
        const field = fieldMap[schemaField]
        if (!field) continue
        const transformed = transformValue(value, field.type)
        if (transformed !== undefined) doc[schemaField] = transformed
      }
      return doc
    },
    [docType, mapping, fieldMap],
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

    const dedupeCsvCol = Object.entries(mapping).find(([, sf]) => sf === dedupeField)?.[0]

    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const doc = buildDoc(row)

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
    if (errors.length) parts.push(`${errors.length} error${errors.length === 1 ? '' : 's'}`)

    const prefix = errors.length ? '⚠️' : '✅'
    setStatus(`${prefix} ${parts.join(', ')}.${errors.length ? ' First error: ' + errors[0] : ''}`)

    if (!errors.length) {
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
                        <option key={f} value={f}>{f} ({fieldMap[f].type})</option>
                      ))}
                    </Select>
                  </Grid>
                ))}
              </Stack>
            </Stack>
          </Card>
        )}

        {csvHeaders.length > 0 && (
          <Card padding={4} radius={2} tone="primary" border>
            <Stack space={4}>
              <Text size={1} weight="semibold">4. Deduplication (optional)</Text>
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

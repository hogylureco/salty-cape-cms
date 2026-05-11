import {useState, useCallback, useMemo} from 'react'
import {useClient} from 'sanity'
import {Card, Stack, Text, Button, Select, Box, Flex, Heading} from '@sanity/ui'
import Papa from 'papaparse'
import {schemaTypes} from '../schemaTypes'

type Row = Record<string, string>

export function BulkImportTool() {
  const client = useClient({apiVersion: '2024-01-01'})

  // Auto-discover every document type from the schema array
  const importableTypes = useMemo(() => {
    return (schemaTypes as any[])
      .filter((t) => t && t.type === 'document')
      .map((t) => ({
        value: t.name,
        label: t.title || t.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  const [docType, setDocType] = useState(importableTypes[0]?.value || '')
  const [rows, setRows] = useState<Row[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [importing, setImporting] = useState(false)

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setStatus('')

    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRows(results.data)
        setStatus(`Parsed ${results.data.length} rows. Review and click Import.`)
      },
      error: (err) => {
        setStatus(`Parse error: ${err.message}`)
      },
    })
  }, [])

  const handleImport = useCallback(async () => {
    if (!rows.length || !docType) return
    setImporting(true)
    setStatus(`Importing ${rows.length} documents...`)

    try {
      let created = 0
      for (const row of rows) {
        const cleaned: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) {
          if (v === '' || v == null) continue
          const num = Number(v)
          cleaned[k] = !isNaN(num) && v.trim() !== '' ? num : v
        }

        await client.create({
          _type: docType,
          _id: `drafts.${crypto.randomUUID()}`,
          ...cleaned,
        })
        created++
      }
      setStatus(`✅ Created ${created} drafts. Find them under "${docType}" in the Structure tab.`)
      setRows([])
      setFileName('')
    } catch (err) {
      setStatus(`❌ Import failed: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }, [rows, docType, client])

  const headers = rows.length ? Object.keys(rows[0]) : []

  return (
    <Box padding={4}>
      <Stack space={5}>
        <Heading size={2}>Bulk Import</Heading>

        <Card padding={4} radius={2} tone="primary" border>
          <Stack space={4}>
            <Stack space={2}>
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

            <Stack space={2}>
              <Text size={1} weight="semibold">2. Upload CSV</Text>
              <input type="file" accept=".csv" onChange={handleFile} />
              {fileName && <Text size={1} muted>Selected: {fileName}</Text>}
            </Stack>
          </Stack>
        </Card>

        {status && (
          <Card padding={3} radius={2} tone={status.startsWith('❌') ? 'critical' : 'positive'}>
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
                    {headers.map((h) => (
                      <th key={h} style={{textAlign: 'left', padding: 4, borderBottom: '1px solid #ddd'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {headers.map((h) => (
                        <td key={h} style={{padding: 4, borderBottom: '1px solid #eee'}}>{row[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Flex>
              <Button
                text={importing ? 'Importing...' : `Import ${rows.length} as drafts`}
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

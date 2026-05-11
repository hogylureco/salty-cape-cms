import {useState, useCallback, useMemo} from 'react'
import {useClient, useSchema} from 'sanity'
import {Card, Stack, Text, Button, Select, Box, Flex, Heading} from '@sanity/ui'
import Papa from 'papaparse'

type Row = Record<string, string>

export function BulkImportTool() {
  const client = useClient({apiVersion: '2024-01-01'})
  const schema = useSchema()

  // Auto-discover every document type in the schema
  const importableTypes = useMemo(() => {
    const types: {value: string; label: string}[] = []
    for (const name of schema.getTypeNames()) {
      const type = schema.get(name)
      if (
        type &&
        type.type === 'document' &&
        !name.startsWith('sanity.') &&
        !name.startsWith('system.')
      ) {
        types.push({
          value: name,
          label: (type as any).title || name,
        })
      }
    }
    return types.sort((a, b) => a.label.localeCompare(b.label))
  }, [schema])

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
                {importableTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>

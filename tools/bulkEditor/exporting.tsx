/**
 * CSV and JSON export, shared by the toolbar (the whole current view) and the selection bar.
 * CSV has the visible columns; JSON has every field of each document as stored.
 */
import {useState} from 'react'
import {Button, Spinner} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {useToast} from '@sanity/ui/toast'
import {DownloadIcon} from '@sanity/icons/Download'
import {orderByIds, toCsv, toJson} from './csv'
import {buildExportQuery, FULL_EXPORT_QUERY} from './groq'
import type {ColumnDef} from './schemaColumns'
import {useBulkClient, type RefIndex, type Row} from './useBulkData'

export type ExportFormat = 'csv' | 'json'

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], {type}))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ExportMenu({
  id,
  typeName,
  /** Ids to export, in the order they should appear in the file. */
  ids,
  columns,
  refs,
  /** Goes into the filename and the toast, e.g. "view" or "selected". */
  scope,
  mode = 'ghost',
}: {
  id: string
  typeName: string
  ids: string[]
  columns: ColumnDef[]
  refs: RefIndex
  scope: string
  mode?: 'ghost' | 'bleed'
}) {
  const client = useBulkClient()
  const toast = useToast()
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (format: ExportFormat) => {
    setBusy(format)
    try {
      const options = {perspective: 'drafts' as const, tag: `bulk-editor.export-${format}`}
      const docs =
        format === 'csv'
          ? await client.fetch<Row[]>(buildExportQuery(columns), {ids}, options)
          : await client.fetch<Row[]>(FULL_EXPORT_QUERY, {ids}, options)
      const ordered = orderByIds(docs, ids)
      const filename = `${typeName}-${scope}-${new Date().toISOString().slice(0, 10)}.${format}`
      if (format === 'csv') download(toCsv(columns, ordered, (ref) => refs.byId.get(ref)), filename, 'text/csv;charset=utf-8')
      else download(toJson(ordered), filename, 'application/json;charset=utf-8')
      toast.push({
        status: 'success',
        title: `Exported ${ordered.length} document${ordered.length === 1 ? '' : 's'} as ${format.toUpperCase()}`,
      })
    } catch (err) {
      toast.push({status: 'error', title: 'Export failed', description: (err as Error).message})
    } finally {
      setBusy(null)
    }
  }

  return (
    <MenuButton
      id={id}
      button={
        <Button
          text="Export"
          icon={busy ? Spinner : DownloadIcon}
          mode={mode}
          fontSize={1}
          padding={2}
          disabled={Boolean(busy) || ids.length === 0}
        />
      }
      menu={
        <Menu>
          <MenuItem
            text={`CSV — ${columns.length} visible column${columns.length === 1 ? '' : 's'}`}
            fontSize={1}
            onClick={() => run('csv')}
          />
          <MenuItem text="JSON — full documents, all fields" fontSize={1} onClick={() => run('json')} />
        </Menu>
      }
      popover={{portal: true, placement: 'bottom-end'}}
    />
  )
}

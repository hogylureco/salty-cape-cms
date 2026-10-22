import {useMemo, useState} from 'react'
import {Badge, Box, Button, Card, Checkbox, Dialog, Flex, Select, Spinner, Stack, Text, TextInput} from '@sanity/ui'
import {useToast} from '@sanity/ui/toast'
import {CloseIcon} from '@sanity/icons/Close'
import {DownloadIcon} from '@sanity/icons/Download'
import {EditIcon} from '@sanity/icons/Edit'
import {PublishIcon} from '@sanity/icons/Publish'
import {TrashIcon} from '@sanity/icons/Trash'
import {UnpublishIcon} from '@sanity/icons/Unpublish'
import {bulkPatch, chunk, editAction, planBulk, type BulkKind, type DocStatus} from './actions'
import {toCsv} from './csv'
import {FieldValueInput} from './editors'
import {buildExportQuery} from './groq'
import type {ColumnDef} from './schemaColumns'
import {useBulkClient, useRefIndex, type RefIndex, type Row} from './useBulkData'

type DialogKind = 'set' | BulkKind | null

interface Progress {
  done: number
  total: number
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Send actions in transactions of TRANSACTION_CHUNK; stops at the first failed transaction. */
async function runChunked(
  client: ReturnType<typeof useBulkClient>,
  actions: Parameters<ReturnType<typeof useBulkClient>['action']>[0][],
  onProgress: (p: Progress) => void,
): Promise<{done: number; error?: Error}> {
  let done = 0
  onProgress({done, total: actions.length})
  for (const part of chunk(actions)) {
    try {
      await client.action(part as any, {tag: 'bulk-editor.bulk'})
    } catch (err) {
      return {done, error: err instanceof Error ? err : new Error(String(err))}
    }
    done += part.length
    onProgress({done, total: actions.length})
  }
  return {done}
}

export function BulkBar({
  typeName,
  selectedIds,
  status,
  columns,
  exportColumns,
  refs,
  onClear,
  onDone,
}: {
  typeName: string
  selectedIds: string[]
  status: Map<string, DocStatus>
  columns: ColumnDef[]
  /** Columns written to CSV: the visible ones, in grid order. */
  exportColumns: ColumnDef[]
  refs: RefIndex
  onClear: () => void
  onDone: () => void
}) {
  const client = useBulkClient()
  const toast = useToast()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [exporting, setExporting] = useState(false)
  const count = selectedIds.length

  const exportCsv = async () => {
    setExporting(true)
    try {
      const rows = await client.fetch<Row[]>(
        buildExportQuery(exportColumns),
        {ids: selectedIds},
        {perspective: 'drafts', tag: 'bulk-editor.export'},
      )
      const csv = toCsv(exportColumns, rows, (ref) => refs.byId.get(ref))
      const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}))
      const a = document.createElement('a')
      a.href = url
      a.download = `${typeName}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.push({status: 'success', title: `Exported ${plural(rows.length, 'row')}`})
    } catch (err) {
      toast.push({status: 'error', title: 'Export failed', description: (err as Error).message})
    } finally {
      setExporting(false)
    }
  }

  const finish = () => {
    setDialog(null)
    onDone()
  }

  return (
    <Card padding={2} tone="primary" borderBottom>
      <Flex align="center" gap={2} wrap="wrap">
        <Badge tone="primary" fontSize={1} padding={2}>
          {count} selected
        </Badge>
        <Button text="Set field value…" icon={EditIcon} mode="ghost" fontSize={1} padding={2} onClick={() => setDialog('set')} />
        <Button text="Publish" icon={PublishIcon} mode="ghost" fontSize={1} padding={2} onClick={() => setDialog('publish')} />
        <Button text="Unpublish" icon={UnpublishIcon} mode="ghost" fontSize={1} padding={2} onClick={() => setDialog('unpublish')} />
        <Button
          text="Export CSV"
          icon={exporting ? Spinner : DownloadIcon}
          mode="ghost"
          fontSize={1}
          padding={2}
          disabled={exporting}
          onClick={exportCsv}
        />
        <Button text="Delete…" icon={TrashIcon} mode="ghost" tone="critical" fontSize={1} padding={2} onClick={() => setDialog('delete')} />
        <Box flex={1} />
        <Button text="Clear selection" icon={CloseIcon} mode="bleed" fontSize={1} padding={2} onClick={onClear} />
      </Flex>

      {dialog === 'set' && (
        <SetFieldDialog
          ids={selectedIds}
          columns={columns.filter((c) => c.editable)}
          onClose={() => setDialog(null)}
          onDone={finish}
          run={(actions, onProgress) => runChunked(client, actions, onProgress)}
        />
      )}
      {(dialog === 'publish' || dialog === 'unpublish' || dialog === 'delete') && (
        <ConfirmDialog
          kind={dialog}
          ids={selectedIds}
          status={status}
          onClose={() => setDialog(null)}
          onDone={finish}
          run={(actions, onProgress) => runChunked(client, actions, onProgress)}
        />
      )}
    </Card>
  )
}

type Runner = (actions: any[], onProgress: (p: Progress) => void) => Promise<{done: number; error?: Error}>

function ProgressNote({progress}: {progress: Progress | null}) {
  if (!progress) return null
  return (
    <Flex align="center" gap={2}>
      <Spinner muted />
      <Text size={1} muted>
        {progress.done} of {progress.total} done
      </Text>
    </Flex>
  )
}

function useResultToast() {
  const toast = useToast()
  return (verb: string, total: number, result: {done: number; error?: Error}, skipped = 0) => {
    const skippedNote = skipped ? ` · ${skipped} skipped` : ''
    if (result.error) {
      toast.push({
        status: 'error',
        title: `${verb} stopped after ${result.done} of ${total}`,
        description: result.error.message,
        duration: 10000,
      })
    } else {
      toast.push({status: 'success', title: `${verb} ${plural(result.done, 'document')}${skippedNote}`})
    }
  }
}

function SetFieldDialog({
  ids,
  columns,
  onClose,
  onDone,
  run,
}: {
  ids: string[]
  columns: ColumnDef[]
  onClose: () => void
  onDone: () => void
  run: Runner
}) {
  const [key, setKey] = useState(columns[0]?.key ?? '')
  const [value, setValue] = useState<unknown>(null)
  const [clear, setClear] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const report = useResultToast()
  const col = columns.find((c) => c.key === key)
  const refs = useRefIndex(col?.to ?? [])

  const hasValue = !(value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0))
  const canApply = Boolean(col) && (clear || hasValue) && !progress

  const apply = async () => {
    if (!col) return
    const patch = clear ? {unset: [col.key]} : bulkPatch(col, value)
    const result = await run(
      ids.map((id) => editAction(id, patch)),
      setProgress,
    )
    report(clear ? `Cleared ${col.title} on` : `Set ${col.title} on`, ids.length, result)
    setProgress(null)
    if (!result.error) onDone()
  }

  return (
    <Dialog
      id="bulk-editor-set-field"
      header={`Set a field on ${plural(ids.length, 'document')}`}
      width={1}
      onClose={progress ? undefined : onClose}
      footer={
        <Flex padding={3} gap={2} justify="flex-end" align="center">
          <ProgressNote progress={progress} />
          <Button text="Cancel" mode="bleed" onClick={onClose} disabled={Boolean(progress)} />
          <Button
            text={clear ? `Clear on ${ids.length}` : `Apply to ${ids.length}`}
            tone={clear ? 'caution' : 'primary'}
            disabled={!canApply}
            onClick={apply}
          />
        </Flex>
      }
    >
      <Box padding={4}>
        <Stack gap={4}>
          <Stack gap={2}>
            <Text size={1} weight="medium">
              Field
            </Text>
            <Select
              value={key}
              onChange={(e) => {
                setKey(e.currentTarget.value)
                setValue(null)
              }}
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.title} ({c.key})
                </option>
              ))}
            </Select>
          </Stack>
          {col && !clear && (
            <Stack gap={2}>
              <Text size={1} weight="medium">
                New value
              </Text>
              <FieldValueInput key={col.key} col={col} refs={refs} value={value} onChange={setValue} />
              {(col.kind === 'referenceArray' || col.kind === 'stringArray' || col.kind === 'stringListArray') && (
                <Text size={1} muted>
                  Replaces the whole list on every selected document.
                </Text>
              )}
            </Stack>
          )}
          <Flex as="label" align="center" gap={2}>
            <Checkbox checked={clear} onChange={(e) => setClear(e.currentTarget.checked)} />
            <Text size={1}>Clear this field instead (removes the value)</Text>
          </Flex>
          <Text size={1} muted>
            Changes go to each document’s draft. Publish them when you’re ready.
          </Text>
        </Stack>
      </Box>
    </Dialog>
  )
}

const VERBS: Record<BulkKind, {title: string; past: string; tone: 'positive' | 'caution' | 'critical'}> = {
  publish: {title: 'Publish', past: 'Published', tone: 'positive'},
  unpublish: {title: 'Unpublish', past: 'Unpublished', tone: 'caution'},
  delete: {title: 'Delete', past: 'Deleted', tone: 'critical'},
}

function ConfirmDialog({
  kind,
  ids,
  status,
  onClose,
  onDone,
  run,
}: {
  kind: BulkKind
  ids: string[]
  status: Map<string, DocStatus>
  onClose: () => void
  onDone: () => void
  run: Runner
}) {
  const plan = useMemo(() => planBulk(kind, ids, status), [kind, ids, status])
  const [typed, setTyped] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const report = useResultToast()
  const verb = VERBS[kind]
  const n = plan.targets.length
  const confirmed = kind !== 'delete' || typed.trim() === String(n)

  const confirm = async () => {
    const result = await run(plan.actions, setProgress)
    report(verb.past, n, result, plan.skipped)
    setProgress(null)
    if (!result.error) onDone()
  }

  const skippedReason =
    kind === 'publish'
      ? 'have no draft changes to publish'
      : kind === 'unpublish'
        ? 'are not published'
        : 'no longer exist'

  return (
    <Dialog
      id={`bulk-editor-${kind}`}
      header={`${verb.title} ${plural(n, 'document')}?`}
      width={1}
      onClose={progress ? undefined : onClose}
      footer={
        <Flex padding={3} gap={2} justify="flex-end" align="center">
          <ProgressNote progress={progress} />
          <Button text="Cancel" mode="bleed" onClick={onClose} disabled={Boolean(progress)} />
          <Button
            text={`${verb.title} ${n}`}
            tone={verb.tone}
            disabled={n === 0 || !confirmed || Boolean(progress)}
            onClick={confirm}
          />
        </Flex>
      }
    >
      <Box padding={4}>
        <Stack gap={4}>
          {plan.skipped > 0 && (
            <Text size={1}>
              {plural(plan.skipped, 'selected document')} {skippedReason} and will be skipped.
            </Text>
          )}
          {kind === 'publish' && (
            <Text size={1} muted>
              The drafts are published as they are. Required-field and other validation rules aren’t checked from here, so
              review anything you’re unsure about in the document editor first.
            </Text>
          )}
          {kind === 'unpublish' && (
            <Text size={1} muted>
              Each document is taken off the live site and kept as a draft.
            </Text>
          )}
          {kind === 'delete' && (
            <>
              <Card tone="critical" padding={3} radius={2} border>
                <Text size={1}>
                  This deletes both the draft and the published version of {plural(n, 'document')}. It can’t be undone from
                  here.
                </Text>
              </Card>
              <Stack gap={2}>
                <Text size={1} weight="medium">
                  Type {n} to confirm
                </Text>
                <TextInput
                  value={typed}
                  inputMode="numeric"
                  autoFocus
                  onChange={(e) => setTyped(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && confirmed && n > 0 && !progress) confirm()
                  }}
                />
              </Stack>
            </>
          )}
        </Stack>
      </Box>
    </Dialog>
  )
}

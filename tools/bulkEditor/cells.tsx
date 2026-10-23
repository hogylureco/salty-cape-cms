/**
 * Grid cells. Each editable cell's focusable element carries `data-cell="<row>:<col>"` so
 * Enter can move focus down a row; Tab uses the browser's own order; Esc cancels an edit.
 */
import {Component, createContext, useContext, useState, type KeyboardEvent, type ReactNode} from 'react'
import {Box, Button, Card, Checkbox, Flex, Select, Text, TextArea, TextInput, useClickOutsideEvent} from '@sanity/ui'
import {Popover} from '@sanity/ui/popover'
import {IntentLink} from 'sanity/router'
import {isRef, splitRefArray, splitStringArray} from './actions'
import {
  editorValueOf,
  isoToLocalInput,
  ListEditor,
  localInputToIso,
  parseNumber,
  RefChip,
  RefEditor,
  refLabel,
  StatusBadge,
  TagsEditor,
} from './editors'
import type {ColumnDef} from './schemaColumns'
import type {RefIndex, Row} from './useBulkData'

export interface CellContextValue {
  refs: RefIndex
  commit: (row: Row, col: ColumnDef, value: unknown) => void
  invalid: (message: string) => void
  /** Move focus to the same column in the next (+1) or previous (-1) row. */
  move: (cellId: string, delta: 1 | -1) => void
}

export const CellContext = createContext<CellContextValue | null>(null)

function useCell() {
  const ctx = useContext(CellContext)
  if (!ctx) throw new Error('Bulk Editor cell rendered outside CellContext')
  return ctx
}

interface CellProps {
  row: Row
  col: ColumnDef
  cellId: string
}

const inputStyle = {borderRadius: 0}

function InlineInput({row, col, cellId}: CellProps) {
  const {commit, invalid, move} = useCell()
  const current = row[col.key]
  const shown = col.kind === 'datetime' ? isoToLocalInput(current) : current == null ? '' : String(current)
  // null while not editing, so live updates from elsewhere show through untouched cells.
  const [draft, setDraft] = useState<string | null>(null)

  const save = () => {
    if (draft === null) return
    setDraft(null)
    if (draft === shown) return
    let next: unknown = draft === '' ? null : draft
    if (col.kind === 'number') {
      const n = parseNumber(draft)
      if (n === undefined) {
        invalid(`“${draft}” is not a number`)
        return
      }
      next = n
    } else if (col.kind === 'datetime') {
      next = localInputToIso(draft)
    }
    commit(row, col, next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'Enter' && !(col.kind === 'text' && e.shiftKey)) {
      e.preventDefault()
      save()
      move(cellId, e.shiftKey ? -1 : 1)
    }
  }

  const common = {
    'data-cell': cellId,
    value: draft ?? shown,
    disabled: col.readOnly,
    onFocus: () => setDraft((d) => d ?? shown),
    onBlur: save,
    onKeyDown,
    fontSize: 1,
    padding: 2,
    border: false,
    style: inputStyle,
  }

  if (col.kind === 'text') {
    return (
      <TextArea
        {...common}
        rows={1}
        style={{...inputStyle, resize: 'none'}}
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
    )
  }
  return (
    <TextInput
      {...common}
      type={col.kind === 'date' ? 'date' : col.kind === 'datetime' ? 'datetime-local' : col.kind === 'url' ? 'url' : 'text'}
      inputMode={col.kind === 'number' ? 'decimal' : undefined}
      onChange={(e) => setDraft(e.currentTarget.value)}
    />
  )
}

function SelectCell({row, col, cellId}: CellProps) {
  const {commit, move} = useCell()
  const current = row[col.key]
  const value = current == null ? '' : String(current)
  const inList = col.options?.some((o) => String(o.value) === value)
  return (
    <Select
      data-cell={cellId}
      fontSize={1}
      padding={2}
      style={inputStyle}
      disabled={col.readOnly}
      value={value}
      onKeyDown={(e) => {
        if (e.key === 'Enter') move(cellId, e.shiftKey ? -1 : 1)
      }}
      onChange={(e) => {
        const raw = e.currentTarget.value
        commit(row, col, col.options?.find((o) => String(o.value) === raw)?.value ?? null)
      }}
    >
      <option value="">—</option>
      {value && !inList && <option value={value}>{value} (not in list)</option>}
      {col.options?.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.title}
        </option>
      ))}
    </Select>
  )
}

function BooleanCell({row, col, cellId}: CellProps) {
  const {commit, move} = useCell()
  return (
    <Flex align="center" justify="center" height="fill" style={{height: '100%'}}>
      <Checkbox
        data-cell={cellId}
        checked={row[col.key] === true}
        disabled={col.readOnly}
        onKeyDown={(e) => {
          if (e.key === 'Enter') move(cellId, e.shiftKey ? -1 : 1)
        }}
        onChange={(e) => commit(row, col, e.currentTarget.checked)}
      />
    </Flex>
  )
}

function refIdsOf(col: ColumnDef, v: unknown): {ids: string[]; invalid: number} {
  if (col.kind === 'reference') return {ids: isRef(v) ? [v._ref] : [], invalid: 0}
  const {refs, invalid} = splitRefArray(v)
  return {ids: refs.map((r) => r._ref), invalid: invalid.length}
}

function CellPreview({row, col, refs}: {row: Row; col: ColumnDef; refs: RefIndex}) {
  const v = row[col.key]
  if (col.kind === 'reference' || col.kind === 'referenceArray') {
    const {ids, invalid} = refIdsOf(col, v)
    if (!ids.length && !invalid) return <Text size={1} muted>—</Text>
    const missing = ids.filter((id) => refLabel(id, refs).missing).length
    return (
      <Flex gap={1} align="center" style={{minWidth: 0, overflow: 'hidden'}}>
        {ids.length > 0 && (
          <Box style={{minWidth: 0, flexShrink: 1}}>
            <RefChip id={ids[0]} refs={refs} />
          </Box>
        )}
        {ids.length > 1 && (
          <Text size={1} muted style={{flexShrink: 0}}>
            +{ids.length - 1}
          </Text>
        )}
        {missing > 0 && ids.length > 1 && !refLabel(ids[0], refs).missing && (
          <Card tone="critical" radius={2} paddingX={1} paddingY={1} style={{flexShrink: 0}}>
            <Text size={0}>{missing} missing</Text>
          </Card>
        )}
        {invalid > 0 && (
          <Card
            tone="critical"
            radius={2}
            paddingX={1}
            paddingY={1}
            style={{flexShrink: 0}}
            title="Items in this list that aren't references (e.g. left over from an import). Editing keeps them; fix them in the document editor."
          >
            <Text size={0}>{invalid} invalid</Text>
          </Card>
        )}
      </Flex>
    )
  }
  const {values, invalid} = splitStringArray(v)
  if (!values.length && !invalid.length) return <Text size={1} muted>—</Text>
  const titles =
    col.kind === 'stringListArray'
      ? values.map((i) => col.options?.find((o) => String(o.value) === i)?.title ?? i)
      : values
  return (
    <Flex gap={1} align="center" style={{minWidth: 0, overflow: 'hidden'}}>
      <Box flex={1} style={{minWidth: 0}}>
        <Text size={1} textOverflow="ellipsis">
          {titles.join(', ')}
        </Text>
      </Box>
      {invalid.length > 0 && (
        <Card
          tone="critical"
          radius={2}
          paddingX={1}
          paddingY={1}
          style={{flexShrink: 0}}
          title="Items in this list that aren't text. Editing keeps them; fix them in the document editor."
        >
          <Text size={0}>{invalid.length} invalid</Text>
        </Card>
      )}
    </Flex>
  )
}

/** Reference, reference array and string array cells: a summary that opens an editor popover. */
function PopoverCell({row, col, cellId}: CellProps) {
  const {refs, commit, move} = useCell()
  const [open, setOpen] = useState(false)
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [popover, setPopover] = useState<HTMLDivElement | null>(null)
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) button?.focus()
  }
  useClickOutsideEvent(open && (() => setOpen(false)), () => [button, popover])

  const value = editorValueOf(col, row[col.key])
  const onChange = (next: unknown) => {
    commit(row, col, next)
    if (col.kind === 'reference') close()
  }

  const editor =
    col.kind === 'reference' || col.kind === 'referenceArray' ? (
      <RefEditor col={col} refs={refs} value={value as string | string[] | null} onChange={onChange} autoFocus />
    ) : col.kind === 'stringListArray' ? (
      <ListEditor col={col} value={value as string[]} onChange={onChange} />
    ) : (
      <TagsEditor value={value as string[]} onChange={onChange} autoFocus />
    )

  return (
    <Popover
      ref={setPopover}
      open={open}
      portal
      placement="bottom-start"
      constrainSize
      content={
        <Box
          padding={3}
          style={{width: 340}}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
        >
          {editor}
        </Box>
      }
    >
      <Button
        ref={setButton}
        data-cell={cellId}
        mode="bleed"
        padding={2}
        radius={0}
        disabled={col.readOnly}
        style={{width: '100%', height: '100%', textAlign: 'left'}}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault()
            move(cellId, -1)
          }
        }}
      >
        <CellPreview row={row} col={col} refs={refs} />
      </Button>
    </Popover>
  )
}

export function summaryText(col: ColumnDef, v: unknown): string {
  switch (col.summary) {
    case 'portableText': {
      const pt = v as {count?: number | null; text?: string | null} | null
      if (!pt?.count) return '—'
      const text = (pt.text ?? '').replace(/\s+/g, ' ').trim()
      if (!text) return `${pt.count} block${pt.count === 1 ? '' : 's'}`
      return text.length > 60 ? `${text.slice(0, 60)}…` : text
    }
    case 'image':
      return v ? 'Image' : '—'
    case 'file':
      return v ? 'File' : '—'
    case 'array':
      return typeof v === 'number' && v > 0 ? `${v} item${v === 1 ? '' : 's'}` : '—'
    default:
      return v ? 'Set' : '—'
  }
}

function SummaryCell({row, col}: CellProps) {
  return (
    <Flex align="center" gap={2} paddingX={2} style={{height: '100%', minWidth: 0}}>
      <Box flex={1} style={{minWidth: 0}}>
        <Text size={1} muted textOverflow="ellipsis" title={summaryText(col, row[col.key])}>
          {summaryText(col, row[col.key])}
        </Text>
      </Box>
      <Text size={1} style={{flexShrink: 0}}>
        <IntentLink intent="edit" params={{id: row._id, type: row._type}}>
          Open
        </IntentLink>
      </Text>
    </Flex>
  )
}

const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})

function MetaCell({row, col}: CellProps) {
  const v = row[col.key]
  if (col.key === '_status') {
    return (
      <Flex align="center" paddingX={2} style={{height: '100%'}}>
        <StatusBadge label={row._status} />
      </Flex>
    )
  }
  return (
    <Flex align="center" paddingX={2} style={{height: '100%', minWidth: 0}}>
      {typeof v === 'string' ? (
        <Text size={1} muted textOverflow="ellipsis" title={v}>
          {formatTimestamp(v)}
        </Text>
      ) : (
        <Text size={1} muted>
          —
        </Text>
      )}
    </Flex>
  )
}

/** Keeps one cell with unexpected data from taking down the whole Studio. */
class CellErrorBoundary extends Component<{children: ReactNode; label: string}, {error: Error | null}> {
  state = {error: null as Error | null}
  static getDerivedStateFromError(error: Error) {
    return {error}
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <Card tone="critical" style={{height: '100%'}} title={`${this.props.label}: ${this.state.error.message}`}>
        <Flex align="center" paddingX={2} style={{height: '100%'}}>
          <Text size={1}>Can’t display</Text>
        </Flex>
      </Card>
    )
  }
}

export function Cell(props: CellProps) {
  return (
    <CellErrorBoundary label={props.col.key}>
      <CellBody {...props} />
    </CellErrorBoundary>
  )
}

function CellBody(props: CellProps) {
  if (props.col.meta) return <MetaCell {...props} />
  switch (props.col.kind) {
    case 'select':
      return <SelectCell {...props} />
    case 'boolean':
      return <BooleanCell {...props} />
    case 'reference':
    case 'referenceArray':
    case 'stringArray':
    case 'stringListArray':
      return <PopoverCell {...props} />
    case 'summary':
      return <SummaryCell {...props} />
    default:
      return <InlineInput {...props} />
  }
}

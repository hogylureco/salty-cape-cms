import {useCallback, useMemo, useRef} from 'react'
import {Box, Card, Checkbox, Flex, Text} from '@sanity/ui'
import {ArrowDownIcon} from '@sanity/icons/ArrowDown'
import {ArrowUpIcon} from '@sanity/icons/ArrowUp'
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef as TableColumn,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table'
import {useVirtualizer} from '@tanstack/react-virtual'
import type {DocStatus} from './actions'
import {Cell, CellContext, type CellContextValue} from './cells'
import {StatusBadge} from './editors'
import type {ColumnDef, ColumnKind} from './schemaColumns'
import type {Row} from './useBulkData'

const ROW_HEIGHT = 37
const SELECT_WIDTH = 44
const STATUS_WIDTH = 100

const WIDTHS: Record<ColumnKind, number> = {
  string: 200,
  text: 260,
  number: 110,
  url: 220,
  slug: 200,
  select: 190,
  boolean: 84,
  date: 150,
  datetime: 210,
  reference: 220,
  referenceArray: 260,
  stringArray: 200,
  stringListArray: 200,
  summary: 240,
}

const cellBorder = {borderRight: '1px solid var(--card-border-color)'}
const stickyLeft = (left: number) => ({position: 'sticky' as const, left, zIndex: 1})

/** Nulls last; numbers and booleans by value; strings case-insensitively with numeric runs. */
export function compareValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || a === ''
  const bNull = b === null || b === undefined || b === ''
  if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: 'base'})
}

export interface GridProps {
  rows: Row[]
  columns: ColumnDef[]
  status: Map<string, DocStatus>
  selected: Set<string>
  onToggleRow: (id: string) => void
  onToggleAll: () => void
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  cell: Omit<CellContextValue, 'move'>
}

export function Grid({rows, columns, status, selected, onToggleRow, onToggleAll, sorting, onSortingChange, cell}: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const tableColumns = useMemo<TableColumn<Row>[]>(
    () =>
      columns.map((col) => ({
        id: col.key,
        accessorFn: (row) => row[col.key],
        enableSorting: col.sortable,
        sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
      })),
    [columns],
  )

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    state: {sorting},
    onSortingChange,
    getRowId: (row) => row._id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const sortedRows = table.getRowModel().rows

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const move = useCallback(
    (cellId: string, delta: 1 | -1) => {
      const [r, c] = cellId.split(':').map(Number)
      const target = r + delta
      if (target < 0 || target >= sortedRows.length) return
      virtualizer.scrollToIndex(target, {align: 'auto'})
      // Two frames: one for the virtualizer to render the row, one for layout.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${target}:${c}"]`)?.focus()
        }),
      )
    },
    [sortedRows.length, virtualizer],
  )
  const cellContext = useMemo(() => ({...cell, move}), [cell, move])

  const totalWidth = SELECT_WIDTH + STATUS_WIDTH + columns.reduce((sum, c) => sum + WIDTHS[c.kind], 0)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r._id))
  const someSelected = !allSelected && rows.some((r) => selected.has(r._id))
  const headers = table.getHeaderGroups()[0]?.headers ?? []

  return (
    <CellContext.Provider value={cellContext}>
      <Box ref={scrollRef} style={{overflow: 'auto', height: '100%'}} role="grid" aria-rowcount={rows.length}>
        <Box style={{width: totalWidth, minWidth: '100%'}}>
          <Card borderBottom style={{position: 'sticky', top: 0, zIndex: 2, display: 'flex', height: ROW_HEIGHT}} role="row">
            <Card style={{...stickyLeft(0), ...cellBorder, width: SELECT_WIDTH, flexShrink: 0}}>
              <Flex align="center" justify="center" style={{height: '100%'}}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={rows.length === 0}
                  onChange={onToggleAll}
                  aria-label={allSelected ? 'Clear selection' : `Select all ${rows.length} matching`}
                  title={allSelected ? 'Clear selection' : `Select all ${rows.length} matching`}
                />
              </Flex>
            </Card>
            <Card style={{...stickyLeft(SELECT_WIDTH), ...cellBorder, width: STATUS_WIDTH, flexShrink: 0}}>
              <Flex align="center" paddingX={2} style={{height: '100%'}}>
                <Text size={1} weight="medium">
                  Status
                </Text>
              </Flex>
            </Card>
            {headers.map((header, i) => {
              const col = columns[i]
              const sorted = header.column.getIsSorted()
              return (
                <Box
                  key={header.id}
                  role="columnheader"
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  title={`${col.key} · ${col.schemaType}${col.readOnly ? ' · read-only' : ''}`}
                  onClick={col.sortable ? header.column.getToggleSortingHandler() : undefined}
                  style={{...cellBorder, width: WIDTHS[col.kind], flexShrink: 0, cursor: col.sortable ? 'pointer' : 'default'}}
                >
                  <Flex align="center" gap={1} paddingX={2} style={{height: '100%'}}>
                    <Box flex={1} style={{minWidth: 0}}>
                      <Text size={1} weight="medium" textOverflow="ellipsis" muted={col.readOnly}>
                        {col.title}
                      </Text>
                    </Box>
                    {sorted && (
                      <Text size={1}>{sorted === 'asc' ? <ArrowUpIcon /> : <ArrowDownIcon />}</Text>
                    )}
                  </Flex>
                </Box>
              )
            })}
          </Card>

          <Box style={{height: virtualizer.getTotalSize(), position: 'relative'}}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = sortedRows[item.index].original
              const isSelected = selected.has(row._id)
              return (
                <Card
                  key={row._id}
                  role="row"
                  aria-selected={isSelected}
                  tone={isSelected ? 'primary' : 'default'}
                  borderBottom
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: totalWidth,
                    minWidth: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start}px)`,
                    display: 'flex',
                  }}
                >
                  <Card tone={isSelected ? 'primary' : 'default'} style={{...stickyLeft(0), ...cellBorder, width: SELECT_WIDTH, flexShrink: 0}}>
                    <Flex align="center" justify="center" style={{height: '100%'}}>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => onToggleRow(row._id)}
                        aria-label={`Select ${row.id || row._id}`}
                      />
                    </Flex>
                  </Card>
                  <Card
                    tone={isSelected ? 'primary' : 'default'}
                    style={{...stickyLeft(SELECT_WIDTH), ...cellBorder, width: STATUS_WIDTH, flexShrink: 0}}
                  >
                    <Flex align="center" paddingX={2} style={{height: '100%'}}>
                      <StatusBadge status={status.get(row._id)} />
                    </Flex>
                  </Card>
                  {columns.map((col, c) => (
                    <Box key={col.key} role="gridcell" style={{...cellBorder, width: WIDTHS[col.kind], flexShrink: 0, overflow: 'hidden'}}>
                      <Cell row={row} col={col} cellId={`${item.index}:${c}`} />
                    </Box>
                  ))}
                </Card>
              )
            })}
          </Box>
        </Box>
      </Box>
    </CellContext.Provider>
  )
}

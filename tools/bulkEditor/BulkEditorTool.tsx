/**
 * Bulk Editor — a Studio tool that shows any document type as an editable grid.
 *
 * Route: /bulk-editor/<type>. Everything about the grid (columns, editors, filters) is derived
 * from the schema at runtime by schemaColumns.ts, so new types and fields need no changes here.
 * In `sanity dev`, /bulk-editor/_columns shows the derived column model for every type.
 */
import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react'
import {Box, Button, Card, Flex, Heading, Select, Spinner, Stack, Text} from '@sanity/ui'
import {Code} from '@sanity/ui/code'
import {useToast} from '@sanity/ui/toast'
import type {SortingState} from '@tanstack/react-table'
import {useSchema} from 'sanity'
import {useRouter} from 'sanity/router'
import {BulkBar} from './BulkBar'
import {ExportMenu} from './exporting'
import {compareValues, Grid} from './Grid'
import {ROW_LIMIT, type ColumnFilter, type GridFilters} from './groq'
import {deriveColumns, listDocumentTypes, META_COLUMNS, unhandledColumns, type ColumnDef} from './schemaColumns'
import {ColumnPicker, FilterControls, RowCount, SearchBox, StatusToggle, type StatusFilter} from './Toolbar'
import {defaultVisibleColumns, useColumnVisibility, useGridData, useRefIndex, type Row} from './useBulkData'

const COLUMN_DUMP_ROUTE = '_columns'
const isDev = (import.meta as {env?: {DEV?: boolean}}).env?.DEV === true

function refTypesOf(columns: ColumnDef[]): string[] {
  return columns.flatMap((c) => (c.kind === 'reference' || c.kind === 'referenceArray' ? (c.to ?? []) : []))
}

function TypeView({typeName, typeTitle}: {typeName: string; typeTitle: string}) {
  const schema = useSchema()
  const toast = useToast()
  const columns = useMemo(() => [...META_COLUMNS, ...deriveColumns(schema, typeName)], [schema, typeName])
  const defaultKeys = useMemo(() => defaultVisibleColumns(columns), [columns])
  const {visible, visibleKeys, setVisibleKeys} = useColumnVisibility(typeName, columns)

  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [activeFilters, setActiveFilters] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sorting, setSorting] = useState<SortingState>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filters = useMemo<GridFilters>(() => ({search, columns: columnFilters}), [search, columnFilters])
  const data = useGridData(typeName, visible, columns, filters)

  const filterColumns = columns.filter((c) => activeFilters.includes(c.key))
  const refs = useRefIndex(refTypesOf([...visible, ...filterColumns]))

  const shownRows = useMemo(() => {
    if (statusFilter === 'all') return data.rows
    return data.rows.filter((r) => {
      const s = data.status.get(r._id)
      return statusFilter === 'drafts' ? s?.draft : s?.published && !s.draft
    })
  }, [data.rows, data.status, statusFilter])

  // Ids in the order the grid shows them (same comparison as the grid's sort), for exports.
  const viewIds = useMemo(() => {
    if (!sorting.length) return shownRows.map((r) => r._id)
    return [...shownRows]
      .sort((a, b) => {
        for (const s of sorting) {
          const d = compareValues(a[s.id], b[s.id])
          if (d) return s.desc ? -d : d
        }
        return 0
      })
      .map((r) => r._id)
  }, [shownRows, sorting])
  const selectedInViewOrder = useMemo(() => viewIds.filter((id) => selected.has(id)), [viewIds, selected])

  // Selection only ever covers rows in the current result, so a bulk action never reaches
  // documents the filters are hiding.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev
      const ids = new Set(shownRows.map((r) => r._id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [shownRows])

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      shownRows.length > 0 && shownRows.every((r) => prev.has(r._id)) ? new Set() : new Set(shownRows.map((r) => r._id)),
    )
  }, [shownRows])

  const {commitEdit} = data
  const cell = useMemo(
    () => ({
      refs,
      commit: (row: Row, col: ColumnDef, value: unknown) => {
        commitEdit(row, col, value).catch((err: Error) =>
          toast.push({status: 'error', title: `Couldn’t save ${col.title}`, description: err.message, duration: 8000}),
        )
      },
      invalid: (message: string) => toast.push({status: 'warning', title: message}),
    }),
    [refs, commitEdit, toast],
  )

  // The search box owns its text; bumping its key remounts it empty.
  const [searchKey, setSearchKey] = useState(0)
  const hasFilters = Boolean(search.trim()) || Object.keys(columnFilters).length > 0 || statusFilter !== 'all'
  const clearFilters = () => {
    setColumnFilters({})
    setActiveFilters([])
    setStatusFilter('all')
    setSearchKey((k) => k + 1)
    setSearch('')
  }

  let body: ReactNode
  if (data.error && !data.loaded) {
    body = (
      <Card tone="critical" padding={4} radius={2} border margin={4}>
        <Stack gap={3}>
          <Text weight="medium">Couldn’t load {typeTitle} documents</Text>
          <Text size={1}>{data.error.message}</Text>
          <Box>
            <Button text="Try again" onClick={data.reload} />
          </Box>
        </Stack>
      </Card>
    )
  } else if (!data.loaded) {
    body = (
      <Flex align="center" justify="center" style={{height: '100%'}}>
        <Spinner muted />
      </Flex>
    )
  } else if (shownRows.length === 0) {
    body = (
      <Flex align="center" justify="center" style={{height: '100%'}}>
        <Stack gap={3} style={{textAlign: 'center'}}>
          <Text weight="medium">{hasFilters ? 'No documents match these filters' : `No ${typeTitle} documents yet`}</Text>
          {hasFilters && (
            <Box>
              <Button text="Clear filters" mode="ghost" onClick={clearFilters} />
            </Box>
          )}
        </Stack>
      </Flex>
    )
  } else if (visible.length === 0) {
    body = (
      <Flex align="center" justify="center" style={{height: '100%'}}>
        <Stack gap={3} style={{textAlign: 'center'}}>
          <Text weight="medium">No columns shown</Text>
          <Box>
            <Button text="Show default columns" mode="ghost" onClick={() => setVisibleKeys(defaultKeys)} />
          </Box>
        </Stack>
      </Flex>
    )
  } else {
    body = (
      <Grid
        rows={shownRows}
        columns={visible}
        selected={selected}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        sorting={sorting}
        onSortingChange={setSorting}
        cell={cell}
      />
    )
  }

  return (
    <Flex direction="column" style={{height: '100%', minHeight: 0}}>
      <Card padding={2} borderBottom>
        <Flex align="center" gap={2} wrap="wrap">
          <SearchBox key={searchKey} onSearch={setSearch} />
          <StatusToggle value={statusFilter} onChange={setStatusFilter} />
          <FilterControls
            columns={columns}
            active={activeFilters}
            filters={columnFilters}
            refs={refs}
            onAdd={(key) => setActiveFilters((a) => [...a, key])}
            onChange={(key, f) =>
              setColumnFilters(({[key]: _old, ...rest}) => (f ? {...rest, [key]: f} : rest))
            }
            onRemove={(key) => {
              setActiveFilters((a) => a.filter((k) => k !== key))
              setColumnFilters(({[key]: _old, ...rest}) => rest)
            }}
          />
          <ColumnPicker columns={columns} visibleKeys={visibleKeys} defaultKeys={defaultKeys} onChange={setVisibleKeys} />
          <ExportMenu id="bulk-editor-export-view" typeName={typeName} ids={viewIds} columns={visible} refs={refs} status={data.status} scope="view" />
          <Box flex={1} />
          <RowCount
            shown={shownRows.length}
            total={data.total}
            limit={ROW_LIMIT}
            loading={data.loading}
            liveError={data.liveError}
            onRefresh={data.reload}
          />
        </Flex>
      </Card>
      {selected.size > 0 && (
        <BulkBar
          typeName={typeName}
          selectedIds={selectedInViewOrder}
          status={data.status}
          columns={columns}
          exportColumns={visible}
          refs={refs}
          onClear={() => setSelected(new Set())}
          onDone={data.reload}
        />
      )}
      <Box flex={1} style={{minHeight: 0}}>
        {body}
      </Box>
    </Flex>
  )
}

function ColumnDump() {
  const schema = useSchema()
  const types = listDocumentTypes(schema)
  const all = types.map((t) => ({type: t.name, columns: deriveColumns(schema, t.name)}))
  const unhandled = all.flatMap(({type, columns}) => unhandledColumns(columns).map((c) => `${type}.${c.key} (${c.schemaType})`))
  return (
    <Box padding={4} style={{overflow: 'auto', height: '100%'}}>
      <Stack gap={4}>
        <Heading size={1}>Derived column model (dev only)</Heading>
        <Text size={1}>
          {types.length} document types · unhandled field types: {unhandled.length ? unhandled.join(', ') : 'none'}
        </Text>
        {all.map(({type, columns}) => (
          <Card key={type} padding={3} radius={2} border>
            <Stack gap={3}>
              <Text weight="medium">
                {type} — {columns.length} columns
              </Text>
              <Code size={1} language="json">
                {JSON.stringify(columns, null, 1)}
              </Code>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Box>
  )
}

export function BulkEditorTool() {
  const router = useRouter()
  const schema = useSchema()
  const types = useMemo(() => listDocumentTypes(schema).sort((a, b) => a.title.localeCompare(b.title)), [schema])
  const typeName = (router.state as {type?: string}).type
  const current = types.find((t) => t.name === typeName)

  return (
    <Flex direction="column" style={{height: '100%', minHeight: 0}}>
      <Card padding={3} borderBottom>
        <Flex align="center" gap={3} wrap="wrap">
          <Heading size={1} as="h1">
            Bulk Editor
          </Heading>
          <Box style={{width: 260}}>
            <Select
              fontSize={1}
              padding={2}
              value={current ? current.name : ''}
              onChange={(e) => router.navigate(e.currentTarget.value ? {type: e.currentTarget.value} : {})}
              aria-label="Document type"
            >
              <option value="">Choose a document type…</option>
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Box>
          {isDev && (
            <Button
              text="Column model"
              mode="bleed"
              fontSize={1}
              padding={2}
              onClick={() => router.navigate({type: COLUMN_DUMP_ROUTE})}
            />
          )}
        </Flex>
      </Card>
      <Box flex={1} style={{minHeight: 0}}>
        {isDev && typeName === COLUMN_DUMP_ROUTE ? (
          <ColumnDump />
        ) : current ? (
          <TypeView key={current.name} typeName={current.name} typeTitle={current.title} />
        ) : (
          <Flex align="center" justify="center" style={{height: '100%'}}>
            <Text muted>
              {typeName ? `There’s no document type called “${typeName}”.` : 'Choose a document type to edit its documents.'}
            </Text>
          </Flex>
        )}
      </Box>
    </Flex>
  )
}

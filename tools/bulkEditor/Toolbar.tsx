import {useEffect, useState} from 'react'
import {Box, Button, Card, Checkbox, Flex, Select, Stack, Text, TextInput, useClickOutsideEvent} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {Popover} from '@sanity/ui/popover'
import {CloseIcon} from '@sanity/icons/Close'
import {FilterIcon} from '@sanity/icons/Filter'
import {RefreshIcon} from '@sanity/icons/Refresh'
import {SearchIcon} from '@sanity/icons/Search'
import {ThListIcon} from '@sanity/icons/ThList'
import {WarningOutlineIcon} from '@sanity/icons/WarningOutline'
import {refLabel} from './editors'
import type {ColumnFilter} from './groq'
import type {ColumnDef} from './schemaColumns'
import type {RefIndex} from './useBulkData'

export type StatusFilter = 'all' | 'drafts' | 'published'

const SEARCH_DEBOUNCE_MS = 300
const EMPTY = '__empty__'

export function SearchBox({onSearch}: {onSearch: (q: string) => void}) {
  const [text, setText] = useState('')
  useEffect(() => {
    const t = setTimeout(() => onSearch(text), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text, onSearch])
  return (
    <Box style={{width: 260}}>
      <TextInput
        icon={SearchIcon}
        fontSize={1}
        padding={2}
        placeholder="Search text fields and ID"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        clearButton={Boolean(text)}
        onClear={() => setText('')}
      />
    </Box>
  )
}

export function StatusToggle({value, onChange}: {value: StatusFilter; onChange: (v: StatusFilter) => void}) {
  const opts: [StatusFilter, string, string][] = [
    ['all', 'All', 'Every document'],
    ['drafts', 'Drafts', 'Has unpublished changes, or was never published'],
    ['published', 'Published', 'Published, with no pending draft'],
  ]
  return (
    <Card radius={2} border>
      <Flex>
        {opts.map(([v, label, hint]) => (
          <Button
            key={v}
            text={label}
            title={hint}
            fontSize={1}
            padding={2}
            radius={0}
            mode={value === v ? 'default' : 'bleed'}
            tone={value === v ? 'primary' : 'default'}
            onClick={() => onChange(v)}
          />
        ))}
      </Flex>
    </Card>
  )
}

function filterOptions(col: ColumnDef, refs: RefIndex): {value: string; title: string}[] {
  if (col.kind === 'boolean')
    return [
      {value: 'true', title: 'True'},
      {value: 'false', title: 'False'},
    ]
  if (col.kind === 'reference' || col.kind === 'referenceArray') {
    return refs.list
      .filter((t) => col.to?.includes(t._type))
      .map((t) => ({value: t._id, title: refLabel(t._id, refs).text}))
      .sort((a, b) => a.title.localeCompare(b.title))
  }
  return (col.options ?? []).map((o) => ({value: String(o.value), title: o.title}))
}

function FilterChip({
  col,
  filter,
  refs,
  onChange,
  onRemove,
}: {
  col: ColumnDef
  filter: ColumnFilter | undefined
  refs: RefIndex
  onChange: (f: ColumnFilter | undefined) => void
  onRemove: () => void
}) {
  const options = filterOptions(col, refs)
  const current = !filter ? '' : filter.op === 'empty' ? EMPTY : String(filter.value)
  return (
    <Card radius={2} border tone={filter ? 'primary' : 'default'}>
      <Flex align="center">
        <Box paddingLeft={2}>
          <Text size={1} weight="medium">
            {col.title}
          </Text>
        </Box>
        <Box style={{width: 180}}>
          <Select
            fontSize={1}
            padding={2}
            value={current}
            onChange={(e) => {
              const raw = e.currentTarget.value
              if (!raw) return onChange(undefined)
              if (raw === EMPTY) return onChange({op: 'empty'})
              if (col.kind === 'boolean') return onChange({op: 'eq', value: raw === 'true'})
              const opt = col.options?.find((o) => String(o.value) === raw)
              onChange({op: 'eq', value: opt ? opt.value : raw})
            }}
          >
            <option value="">Any</option>
            <option value={EMPTY}>(empty)</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.title}
              </option>
            ))}
          </Select>
        </Box>
        <Button mode="bleed" padding={2} icon={CloseIcon} aria-label={`Remove ${col.title} filter`} onClick={onRemove} />
      </Flex>
    </Card>
  )
}

export function FilterControls({
  columns,
  active,
  filters,
  refs,
  onAdd,
  onChange,
  onRemove,
}: {
  columns: ColumnDef[]
  /** Keys of filter chips shown, including ones with no value picked yet. */
  active: string[]
  filters: Record<string, ColumnFilter>
  refs: RefIndex
  onAdd: (key: string) => void
  onChange: (key: string, f: ColumnFilter | undefined) => void
  onRemove: (key: string) => void
}) {
  const filterable = columns.filter((c) => c.filterable)
  const available = filterable.filter((c) => !active.includes(c.key))
  return (
    <>
      {active.map((key) => {
        const col = columns.find((c) => c.key === key)
        return col ? (
          <FilterChip
            key={key}
            col={col}
            filter={filters[key]}
            refs={refs}
            onChange={(f) => onChange(key, f)}
            onRemove={() => onRemove(key)}
          />
        ) : null
      })}
      {filterable.length > 0 && (
        <MenuButton
          id="bulk-editor-add-filter"
          button={<Button text="Filter" icon={FilterIcon} mode="ghost" fontSize={1} padding={2} disabled={!available.length} />}
          menu={
            <Menu style={{maxHeight: 360, overflowY: 'auto'}}>
              {available.map((c) => (
                <MenuItem key={c.key} text={c.title} fontSize={1} onClick={() => onAdd(c.key)} />
              ))}
            </Menu>
          }
          popover={{portal: true, placement: 'bottom-start'}}
        />
      )}
    </>
  )
}

export function ColumnPicker({
  columns,
  visibleKeys,
  defaultKeys,
  onChange,
}: {
  columns: ColumnDef[]
  visibleKeys: string[]
  defaultKeys: string[]
  onChange: (keys: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [popover, setPopover] = useState<HTMLDivElement | null>(null)
  useClickOutsideEvent(open && (() => setOpen(false)), () => [button, popover])

  const toggle = (key: string) =>
    onChange(
      visibleKeys.includes(key)
        ? visibleKeys.filter((k) => k !== key)
        : // Keep schema order no matter the order columns are switched on.
          columns.map((c) => c.key).filter((k) => k === key || visibleKeys.includes(k)),
    )
  // A popover of checkboxes rather than a Menu: menu items close the menu on every click.
  return (
    <Popover
      ref={setPopover}
      open={open}
      portal
      placement="bottom-end"
      constrainSize
      content={
        <Box
          padding={3}
          style={{width: 280}}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              button?.focus()
            }
          }}
        >
          <Stack gap={3}>
            <Flex gap={2}>
              <Button text="Show all" mode="ghost" fontSize={1} padding={2} onClick={() => onChange(columns.map((c) => c.key))} />
              <Button text="Reset" mode="ghost" fontSize={1} padding={2} onClick={() => onChange(defaultKeys)} />
            </Flex>
            <Stack gap={3} style={{maxHeight: 360, overflowY: 'auto'}}>
              {columns.map((c) => (
                <Flex key={c.key} as="label" align="center" gap={2}>
                  <Checkbox checked={visibleKeys.includes(c.key)} onChange={() => toggle(c.key)} />
                  <Text size={1} textOverflow="ellipsis" muted={c.kind === 'summary'}>
                    {c.title}
                  </Text>
                </Flex>
              ))}
            </Stack>
          </Stack>
        </Box>
      }
    >
      <Button
        ref={setButton}
        text={`Columns (${visibleKeys.length}/${columns.length})`}
        icon={ThListIcon}
        mode="ghost"
        fontSize={1}
        padding={2}
        selected={open}
        onClick={() => setOpen((o) => !o)}
      />
    </Popover>
  )
}

export function RowCount({
  shown,
  total,
  limit,
  loading,
  liveError,
  onRefresh,
}: {
  shown: number
  total: number
  limit: number
  loading: boolean
  liveError: Error | null
  onRefresh: () => void
}) {
  return (
    <Flex align="center" gap={2}>
      {liveError && (
        <Text size={1} title={`Live updates paused: ${liveError.message}`}>
          <WarningOutlineIcon />
        </Text>
      )}
      <Text size={1} muted>
        {shown === total ? `${total}` : `${shown} of ${total}`} document{total === 1 ? '' : 's'}
        {total > limit ? ` · first ${limit} loaded, narrow the search to see the rest` : ''}
      </Text>
      <Button
        mode="bleed"
        padding={2}
        icon={RefreshIcon}
        aria-label="Refresh"
        title="Refresh"
        disabled={loading}
        onClick={onRefresh}
      />
    </Flex>
  )
}

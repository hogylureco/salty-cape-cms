/**
 * Value editors shared by grid cells (inside a popover) and the "Set field value" dialog.
 * Editor values match what actions.buildEdit expects: scalars as-is, slug as a string,
 * references as ids, arrays as arrays.
 */
import {useMemo, useState, type KeyboardEvent} from 'react'
import {Badge, Box, Button, Card, Checkbox, Flex, Select, Stack, Text, TextArea, TextInput} from '@sanity/ui'
import {CloseIcon} from '@sanity/icons/Close'
import {isRef, splitRefArray, splitStringArray} from './actions'
import type {ColumnDef} from './schemaColumns'
import type {RefIndex, RefTarget} from './useBulkData'

/** Title for a reference; `missing` when the target can't be found (dangling reference). */
export function refLabel(ref: string, refs: RefIndex): {text: string; missing: boolean} {
  const target = refs.byId.get(ref)
  if (target) return {text: target.title || target.id || ref, missing: false}
  return {text: ref, missing: refs.loaded}
}

export function RefChip({id, refs, onRemove}: {id: string; refs: RefIndex; onRemove?: () => void}) {
  const {text, missing} = refLabel(id, refs)
  return (
    <Card
      radius={2}
      tone={missing ? 'critical' : 'transparent'}
      border
      paddingY={1}
      paddingLeft={2}
      paddingRight={onRemove ? 1 : 2}
      style={{maxWidth: '100%'}}
      title={missing ? `Missing document: ${id}` : text}
    >
      <Flex align="center" gap={1}>
        <Text size={1} textOverflow="ellipsis">
          {text}
        </Text>
        {onRemove && (
          <Button mode="bleed" padding={1} icon={CloseIcon} onClick={onRemove} aria-label={`Remove ${text}`} />
        )}
      </Flex>
    </Card>
  )
}

const MAX_REF_RESULTS = 50

// A search box with an inline result list rather than an Autocomplete: the Autocomplete's own
// popover would count as an outside click for the grid cell's popover and close it mid-pick.
function RefSearch({
  to,
  refs,
  exclude,
  onPick,
  autoFocus,
}: {
  to: string[]
  refs: RefIndex
  exclude: string[]
  onPick: (id: string) => void
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return refs.list.filter(
      (t) =>
        to.includes(t._type) &&
        !exclude.includes(t._id) &&
        (!needle || [t.title, t.id].some((s) => s?.toLowerCase().includes(needle))),
    )
  }, [refs.list, to, exclude, query])
  const pick = (target: RefTarget) => {
    setQuery('')
    onPick(target._id)
  }
  return (
    <Stack gap={2}>
      <TextInput
        value={query}
        autoFocus={autoFocus}
        fontSize={1}
        placeholder={refs.loaded ? `Search ${to.join(', ')}` : 'Loading…'}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            if (matches[0]) pick(matches[0])
          }
        }}
      />
      <Card border radius={2} style={{maxHeight: 220, overflowY: 'auto'}}>
        {matches.length === 0 ? (
          <Box padding={3}>
            <Text size={1} muted>
              {refs.loaded ? 'No matches' : 'Loading…'}
            </Text>
          </Box>
        ) : (
          <Stack gap={0}>
            {matches.slice(0, MAX_REF_RESULTS).map((t) => (
              <Button key={t._id} mode="bleed" radius={0} padding={2} justify="flex-start" onClick={() => pick(t)}>
                <Stack gap={2}>
                  <Text size={1} weight="medium" textOverflow="ellipsis">
                    {t.title || t.id || t._id}
                  </Text>
                  {(t.id || to.length > 1) && (
                    <Text size={0} muted textOverflow="ellipsis">
                      {[to.length > 1 ? t._type : null, t.id].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </Stack>
              </Button>
            ))}
            {matches.length > MAX_REF_RESULTS && (
              <Box padding={2}>
                <Text size={0} muted>
                  {matches.length - MAX_REF_RESULTS} more — keep typing to narrow
                </Text>
              </Box>
            )}
          </Stack>
        )}
      </Card>
    </Stack>
  )
}

export function RefEditor({
  col,
  refs,
  value,
  onChange,
  autoFocus,
}: {
  col: ColumnDef
  refs: RefIndex
  /** An id for a single reference, ids for an array. */
  value: string | null | string[]
  onChange: (next: string | null | string[]) => void
  autoFocus?: boolean
}) {
  const to = col.to ?? []
  if (col.kind === 'reference') {
    const id = value as string | null
    return (
      <Stack gap={2}>
        {id && <RefChip id={id} refs={refs} onRemove={() => onChange(null)} />}
        <RefSearch to={to} refs={refs} exclude={id ? [id] : []} onPick={(picked) => onChange(picked)} autoFocus={autoFocus} />
      </Stack>
    )
  }
  const ids = (value as string[] | null) ?? []
  return (
    <Stack gap={2}>
      {ids.length > 0 && (
        <Flex wrap="wrap" gap={1}>
          {ids.map((id) => (
            <RefChip key={id} id={id} refs={refs} onRemove={() => onChange(ids.filter((x) => x !== id))} />
          ))}
        </Flex>
      )}
      <RefSearch to={to} refs={refs} exclude={ids} onPick={(picked) => onChange([...ids, picked])} autoFocus={autoFocus} />
      {col.mixedWeak && (
        <Text size={0} muted>
          Members of this field disagree on weak references; new references are written as strong.
        </Text>
      )}
    </Stack>
  )
}

export function TagsEditor({
  value,
  onChange,
  autoFocus,
}: {
  value: string[]
  onChange: (next: string[]) => void
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft('')
  }
  return (
    <Stack gap={2}>
      {value.length > 0 && (
        <Flex wrap="wrap" gap={1}>
          {value.map((tag) => (
            <Card key={tag} radius={2} border paddingY={1} paddingLeft={2} paddingRight={1}>
              <Flex align="center" gap={1}>
                <Text size={1}>{tag}</Text>
                <Button
                  mode="bleed"
                  padding={1}
                  icon={CloseIcon}
                  aria-label={`Remove ${tag}`}
                  onClick={() => onChange(value.filter((t) => t !== tag))}
                />
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
      <TextInput
        value={draft}
        autoFocus={autoFocus}
        placeholder="Type a value and press Enter"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            add()
          }
        }}
        onBlur={add}
      />
    </Stack>
  )
}

export function ListEditor({
  col,
  value,
  onChange,
}: {
  col: ColumnDef
  value: string[]
  onChange: (next: string[]) => void
}) {
  const options = col.options ?? []
  const known = new Set(options.map((o) => String(o.value)))
  const extra = value.filter((v) => !known.has(v))
  return (
    <Stack gap={3}>
      {options.map((o) => {
        const v = String(o.value)
        const checked = value.includes(v)
        return (
          <Flex key={v} as="label" align="center" gap={2}>
            <Checkbox
              checked={checked}
              onChange={() =>
                // Keep the schema's list order regardless of click order.
                onChange(options.map((x) => String(x.value)).filter((x) => (x === v ? !checked : value.includes(x))).concat(extra))
              }
            />
            <Text size={1}>{o.title}</Text>
          </Flex>
        )
      })}
      {extra.length > 0 && (
        <Text size={0} muted>
          Not in the list: {extra.join(', ')}
        </Text>
      )}
    </Stack>
  )
}

/** ISO datetime <-> the `datetime-local` input's local "YYYY-MM-DDTHH:mm". */
export function isoToLocalInput(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function localInputToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Turn the text of a number input into a value, or `undefined` when it isn't a number. */
export function parseNumber(text: string): number | null | undefined {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Controlled editor for any editable column kind, used by the "Set field value" dialog. */
export function FieldValueInput({
  col,
  refs,
  value,
  onChange,
}: {
  col: ColumnDef
  refs: RefIndex
  value: unknown
  onChange: (next: unknown) => void
}) {
  const stop = (e: KeyboardEvent) => e.key === 'Enter' && e.stopPropagation()
  switch (col.kind) {
    case 'select':
      return (
        <Select
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => {
            const raw = e.currentTarget.value
            const opt = col.options?.find((o) => String(o.value) === raw)
            onChange(opt ? opt.value : null)
          }}
        >
          <option value="">— Choose a value —</option>
          {col.options?.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.title}
            </option>
          ))}
        </Select>
      )
    case 'boolean':
      return (
        <Flex as="label" align="center" gap={2}>
          <Checkbox checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} />
          <Text size={1}>{value === true ? 'True' : 'False'}</Text>
        </Flex>
      )
    case 'text':
      return <TextArea rows={4} value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value)} />
    case 'number':
      return (
        <TextInput
          inputMode="decimal"
          value={value === null || value === undefined ? '' : String(value)}
          onKeyDown={stop}
          onChange={(e) => {
            const n = parseNumber(e.currentTarget.value)
            onChange(n === undefined ? value : n)
          }}
        />
      )
    case 'date':
      return <TextInput type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)} />
    case 'datetime':
      return (
        <TextInput
          type="datetime-local"
          value={isoToLocalInput(value)}
          onChange={(e) => onChange(localInputToIso(e.currentTarget.value))}
        />
      )
    case 'reference':
    case 'referenceArray':
      return (
        <RefEditor
          col={col}
          refs={refs}
          value={(value as string | string[] | null) ?? (col.kind === 'reference' ? null : [])}
          onChange={onChange}
        />
      )
    case 'stringArray':
      return <TagsEditor value={(value as string[]) ?? []} onChange={onChange} />
    case 'stringListArray':
      return <ListEditor col={col} value={(value as string[]) ?? []} onChange={onChange} />
    default:
      return (
        <TextInput
          type={col.kind === 'url' ? 'url' : 'text'}
          value={(value as string) ?? ''}
          onKeyDown={stop}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      )
  }
}

/** Editor value for a row's current field value (inverse of the row shape the grid fetches). */
export function editorValueOf(col: ColumnDef, rowValue: unknown): unknown {
  if (col.kind === 'reference') return isRef(rowValue) ? rowValue._ref : null
  if (col.kind === 'referenceArray') return splitRefArray(rowValue).refs.map((r) => r._ref)
  if (col.kind === 'stringArray' || col.kind === 'stringListArray') return splitStringArray(rowValue).values
  return rowValue ?? null
}

export function StatusBadge({status}: {status?: {draft: boolean; published: boolean}}) {
  if (!status) return null
  if (status.draft && status.published) return <Badge tone="caution">Changed</Badge>
  if (status.draft) return <Badge tone="default">Draft</Badge>
  return <Badge tone="positive">Published</Badge>
}

import {set, type InputProps, type ObjectInputProps} from 'sanity'
import {isReferenceSchemaType} from '@sanity/types'
import {Badge, Box, Button, Card, Checkbox, Flex, Stack, Text} from '@sanity/ui'
import {useCallback, useRef, useState} from 'react'

// Document-level fields Sanity manages itself — patching these via a field
// onChange is rejected, so they are never written from an import.
const SYSTEM_FIELDS = new Set(['_id', '_type', '_rev', '_createdAt', '_updatedAt'])

// A valid Sanity document _id: letters, digits, dot, dash, underscore. No spaces.
const VALID_ID = /^[A-Za-z0-9._-]+$/

// Reference cells often arrive as "CODE - Human Label". Split only on an ASCII
// hyphen flanked by spaces so codes containing hyphens (BAIT-POG, LGC-100) survive.
const ID_SEPARATOR = /\s-\s/

/** Default: take the CODE before " - ". Correct when the code IS the target _id. */
function defaultRefId(raw: string): string {
  const code = raw.split(ID_SEPARATOR)[0].trim()
  return VALID_ID.test(code) ? code : raw
}

/**
 * Coerce any string into a valid Sanity _id: spaces -> underscore, drop any
 * other illegal characters, collapse consecutive dots, strip a leading dash,
 * cap at 128 chars. (Sanity _ids allow only A-Za-z0-9._- .)
 */
function sanitizeId(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^-+/, '')
    .slice(0, 128)
}

// Per-field overrides: map a raw cell to the *target document _id* for fields
// whose _id is NOT just the bare code. nearbySpots keeps the full "CODE - Label"
// structure, sanitized to a valid id:
//   "BB.CL.fs - Cleveland Ledge"  ->  "BB.CL.fs_-_Cleveland_Ledge"
// NOTE: dots in an _id make the document auth-only (private). If your spots use
// the underscore convention seen on this file (BB_WE_fs_West_End_of_the_Canal),
// swap the line below for: nearbySpots: (raw) => sanitizeId(raw).replace(/\./g, '_')
const REF_ID_RESOLVERS: Record<string, (raw: string) => string> = {
  nearbySpots: sanitizeId,
  // approaches: sanitizeId,
  // relatedVideos: sanitizeId,
}

type Status = 'new' | 'changed' | 'unchanged'

type FieldReport = {
  key: string
  status: Status
  isRef: boolean
  refCount: number
  badRefs: string[]
  oldValue: unknown
  newValue: unknown
}

/* ---------------------------------------------------------------- helpers */

function randomKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 14)
}

/** Ensure every object that is a *member of an array* has a `_key`. */
function addKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = addKeys(item)
      if (next && typeof next === 'object' && !Array.isArray(next)) {
        const obj = next as Record<string, unknown>
        if (typeof obj._key !== 'string') return {...obj, _key: randomKey()}
      }
      return next
    })
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = addKeys(v)
    }
    return out
  }
  return value
}

/** Normalize the members of a reference-array field into reference objects. */
function coerceReferences(value: unknown, resolveId: (raw: string) => string): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => {
    if (typeof item === 'string') {
      return {_type: 'reference', _ref: resolveId(item), _key: randomKey()}
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      return {
        ...obj,
        _ref: typeof obj._ref === 'string' ? resolveId(obj._ref) : obj._ref,
        _type: typeof obj._type === 'string' ? obj._type : 'reference',
        _key: typeof obj._key === 'string' ? obj._key : randomKey(),
      }
    }
    return item
  })
}

/** _ref values in a reference array that won't resolve as document IDs. */
function findBadRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const bad: string[] = []
  for (const item of value) {
    const ref = item && typeof item === 'object' ? (item as Record<string, unknown>)._ref : undefined
    if (typeof ref === 'string' && !VALID_ID.test(ref)) bad.push(ref)
  }
  return bad
}

/** Strip _key recursively so comparisons reflect content, not freshly minted keys. */
function stripKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_key') continue
      out[k] = stripKeys(v)
    }
    return out
  }
  return value
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k])
    return out
  }
  return value
}

function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(stripKeys(a))) === JSON.stringify(sortKeys(stripKeys(b)))
}

function summarize(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (Array.isArray(value)) return `Array · ${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    return `Object · {${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`
  }
  if (typeof value === 'string') return value.length > 60 ? value.slice(0, 60) + '…' : value
  return String(value)
}

function fullPreview(value: unknown): string {
  let s: string
  try {
    s = JSON.stringify(value, null, 2)
  } catch {
    s = String(value)
  }
  if (s == null) return '—'
  return s.length > 4000 ? s.slice(0, 4000) + '\n… (truncated)' : s
}

const STATUS_TONE: Record<Status, 'primary' | 'caution' | 'positive'> = {
  new: 'primary',
  changed: 'caution',
  unchanged: 'positive',
}

/* -------------------------------------------------------------- component */

function DocumentImporter(props: ObjectInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<FieldReport[] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [deployedCount, setDeployedCount] = useState<number | null>(null)

  const resetInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setDeployedCount(null)
      try {
        const data = JSON.parse(await file.text())
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          alert('JSON must be a single object (not an array or primitive).')
          return
        }

        // Which top-level fields does the schema declare as reference arrays?
        const refArrayFields = new Set<string>()
        for (const field of props.schemaType?.fields ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = field.type as any
          if (t?.jsonType === 'array' && Array.isArray(t.of) && t.of.some(isReferenceSchemaType)) {
            refArrayFields.add(field.name)
          }
        }

        const existing = (props.value ?? {}) as Record<string, unknown>
        const rows: FieldReport[] = []
        const nextSelected: Record<string, boolean> = {}

        for (const [key, rawValue] of Object.entries(data)) {
          if (SYSTEM_FIELDS.has(key)) continue

          const isRef = refArrayFields.has(key)
          const resolveId = REF_ID_RESOLVERS[key] ?? defaultRefId
          let value: unknown = isRef ? coerceReferences(rawValue, resolveId) : rawValue
          value = addKeys(value)

          const old = existing[key]
          const status: Status = !(key in existing) || old === undefined
            ? 'new'
            : sameContent(old, value)
            ? 'unchanged'
            : 'changed'

          rows.push({
            key,
            status,
            isRef,
            refCount: isRef && Array.isArray(value) ? value.length : 0,
            badRefs: isRef ? findBadRefs(value) : [],
            oldValue: old,
            newValue: value,
          })
          // default: apply everything that actually changes
          nextSelected[key] = status !== 'unchanged'
        }

        setReport(rows)
        setSelected(nextSelected)
        setExpanded({})
      } catch (err) {
        alert('Failed to parse JSON: ' + (err as Error).message)
      }
    },
    [props.schemaType, props.value],
  )

  const deploy = useCallback(() => {
    if (!report) return
    let count = 0
    for (const r of report) {
      if (!selected[r.key]) continue
      props.onChange(set(r.newValue, [r.key]))
      count++
    }
    setDeployedCount(count)
    setReport(null)
    setSelected({})
    setExpanded({})
    resetInput()
  }, [report, selected, props])

  const cancel = useCallback(() => {
    setReport(null)
    setSelected({})
    setExpanded({})
    resetInput()
  }, [])

  const toggle = (key: string) => setSelected((s) => ({...s, [key]: !s[key]}))
  const toggleExpand = (key: string) => setExpanded((s) => ({...s, [key]: !s[key]}))
  const setAll = (val: boolean) => {
    if (!report) return
    const next: Record<string, boolean> = {}
    for (const r of report) next[r.key] = val
    setSelected(next)
  }

  const counts = report
    ? {
        new: report.filter((r) => r.status === 'new').length,
        changed: report.filter((r) => r.status === 'changed').length,
        unchanged: report.filter((r) => r.status === 'unchanged').length,
        bad: report.reduce((n, r) => n + r.badRefs.length, 0),
        selected: report.filter((r) => selected[r.key]).length,
      }
    : null

  return (
    <Stack space={4}>
      <Card padding={3} radius={2} tone="primary" border>
        <Stack space={3}>
          <Text size={1} weight="semibold">
            Import from JSON
          </Text>
          <Text size={1} muted>
            Upload a .json file to stage an import. You can review old vs. new values
            and choose which fields to apply before deploying. Array items are keyed
            automatically; reference arrays accept reference objects or bare target IDs.
          </Text>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
          />
        </Stack>
      </Card>

      {deployedCount !== null && (
        <Card padding={3} radius={2} tone="positive" border>
          <Text size={1}>
            Applied {deployedCount} field{deployedCount === 1 ? '' : 's'}. Review the editor
            below, then publish to save.
          </Text>
        </Card>
      )}

      {report && counts && (
        <Card padding={3} radius={2} tone="transparent" border>
          <Stack space={4}>
            <Flex align="center" justify="space-between" gap={2}>
              <Text size={1} weight="semibold">
                Review import
              </Text>
              <Flex gap={2} align="center">
                <Badge tone="primary" mode="outline" fontSize={0}>
                  {counts.new} new
                </Badge>
                <Badge tone="caution" mode="outline" fontSize={0}>
                  {counts.changed} changed
                </Badge>
                <Badge tone="positive" mode="outline" fontSize={0}>
                  {counts.unchanged} unchanged
                </Badge>
              </Flex>
            </Flex>

            {counts.bad > 0 && (
              <Card padding={3} radius={2} tone="critical" border>
                <Text size={1}>
                  {counts.bad} reference value{counts.bad === 1 ? '' : 's'} don&apos;t look like
                  valid document IDs (they contain spaces or other illegal characters). These
                  will import but show as broken references. Each <code>_ref</code> must be the
                  target document&apos;s <code>_id</code>.
                </Text>
              </Card>
            )}

            <Flex gap={2}>
              <Button mode="ghost" fontSize={1} text="Select all" onClick={() => setAll(true)} />
              <Button mode="ghost" fontSize={1} text="Select none" onClick={() => setAll(false)} />
            </Flex>

            <Stack space={2}>
              {report.map((r) => {
                const isOpen = !!expanded[r.key]
                return (
                  <Card key={r.key} padding={3} radius={2} border tone="default">
                    <Stack space={3}>
                      <Flex align="center" gap={3}>
                        <Checkbox
                          checked={!!selected[r.key]}
                          onChange={() => toggle(r.key)}
                        />
                        <Box flex={1}>
                          <Flex align="center" gap={2}>
                            <Text size={1} weight="medium">
                              {r.key}
                            </Text>
                            <Badge tone={STATUS_TONE[r.status]} fontSize={0}>
                              {r.status}
                            </Badge>
                            {r.isRef && (
                              <Badge
                                tone={r.badRefs.length ? 'critical' : 'default'}
                                mode="outline"
                                fontSize={0}
                              >
                                {r.refCount} ref{r.refCount === 1 ? '' : 's'}
                                {r.badRefs.length ? ` · ${r.badRefs.length} invalid` : ''}
                              </Badge>
                            )}
                          </Flex>
                        </Box>
                        <Button
                          mode="bleed"
                          fontSize={1}
                          text={isOpen ? 'Hide' : 'Compare'}
                          onClick={() => toggleExpand(r.key)}
                        />
                      </Flex>

                      {!isOpen && (
                        <Flex gap={3} wrap="wrap">
                          <Text size={0} muted style={{flex: 1, minWidth: 180}}>
                            old: {summarize(r.oldValue)}
                          </Text>
                          <Text size={0} muted style={{flex: 1, minWidth: 180}}>
                            new: {summarize(r.newValue)}
                          </Text>
                        </Flex>
                      )}

                      {isOpen && (
                        <Flex gap={3} wrap="wrap" align="stretch">
                          <Box flex={1} style={{minWidth: 240}}>
                            <Stack space={2}>
                              <Text size={0} weight="semibold" muted>
                                EXISTING
                              </Text>
                              <Card padding={2} radius={1} tone="transparent" border>
                                <pre style={preStyle}>{fullPreview(r.oldValue)}</pre>
                              </Card>
                            </Stack>
                          </Box>
                          <Box flex={1} style={{minWidth: 240}}>
                            <Stack space={2}>
                              <Text size={0} weight="semibold" muted>
                                INCOMING
                              </Text>
                              <Card padding={2} radius={1} tone="transparent" border>
                                <pre style={preStyle}>{fullPreview(r.newValue)}</pre>
                              </Card>
                            </Stack>
                          </Box>
                        </Flex>
                      )}
                    </Stack>
                  </Card>
                )
              })}
            </Stack>

            <Flex gap={2} justify="flex-end">
              <Button mode="ghost" fontSize={1} text="Cancel" onClick={cancel} />
              <Button
                tone="primary"
                fontSize={1}
                text={`Deploy ${counts.selected} field${counts.selected === 1 ? '' : 's'}`}
                disabled={counts.selected === 0}
                onClick={deploy}
              />
            </Flex>
          </Stack>
        </Card>
      )}

      {props.renderDefault(props)}
    </Stack>
  )
}

const preStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 11,
  lineHeight: 1.5,
  fontFamily: 'var(--card-code-fg-color, monospace)',
  maxHeight: 280,
  overflow: 'auto',
}

/**
 * Renders the importer at the document root and passes every other input straight
 * through. Register this on the SPOT DOCUMENT TYPE (components.input), NOT globally
 * at form.components.input — global registration puts it in the render chain for
 * every nested field (Portable Text, arrays, etc.) and breaks the form.
 *
 * Scoped to the document type, it only ever fires at the root, so the `props.id`
 * check is just a safety net against accidental global registration.
 */
export function JsonImportField(props: InputProps) {
  if (props.id !== 'root') {
    return props.renderDefault(props)
  }
  return <DocumentImporter {...(props as ObjectInputProps)} />
}

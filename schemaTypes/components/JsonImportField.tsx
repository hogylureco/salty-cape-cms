import {set, type ObjectInputProps, type ObjectSchemaType} from 'sanity'
import {Card, Stack, Text} from '@sanity/ui'
import {useCallback, useRef} from 'react'

// Document-level fields that Sanity manages itself. Patching these through a
// field onChange is rejected, so we never write them from an import.
const SYSTEM_FIELDS = new Set(['_id', '_type', '_rev', '_createdAt', '_updatedAt'])

/** Generate a Sanity-style array item key. */
function randomKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 14)
}

/**
 * Recursively ensure every object that is a *member of an array* has a `_key`.
 * Existing keys are preserved. Plain scalars and single object fields (e.g. a
 * `slug` object) are left untouched — only array items get keyed.
 * This covers reference arrays, Portable Text blocks, and any array of objects.
 */
function addKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = addKeys(item)
      if (next && typeof next === 'object' && !Array.isArray(next)) {
        const obj = next as Record<string, unknown>
        if (typeof obj._key !== 'string') {
          return {...obj, _key: randomKey()}
        }
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

/** Walk a compiled schema type's `.type` chain collecting type names. */
function typeNameChain(t: unknown): string[] {
  const names: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur = t as any
  let guard = 0
  while (cur && guard++ < 20) {
    if (typeof cur.name === 'string') names.push(cur.name)
    cur = cur.type
  }
  return names
}

/** True if a schema field is an array whose members are references. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isReferenceArrayField(field: any): boolean {
  const t = field?.type
  if (!t || t.jsonType !== 'array') return false
  const members = Array.isArray(t.of) ? t.of : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return members.some((m: any) => typeNameChain(m).includes('reference'))
}

/**
 * Coerce the members of a reference-array field into valid reference objects.
 * - A bare string becomes {_type:'reference', _ref:<string>, _key}.
 *   NOTE: the string must already be the *target document's _id*.
 * - An existing object is given _type:'reference' and a _key if missing.
 */
function coerceReferences(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => {
    if (typeof item === 'string') {
      return {_type: 'reference', _ref: item, _key: randomKey()}
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      return {
        ...obj,
        _type: typeof obj._type === 'string' ? obj._type : 'reference',
        _key: typeof obj._key === 'string' ? obj._key : randomKey(),
      }
    }
    return item
  })
}

export function JsonImportField(props: ObjectInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          alert('JSON must be a single object (not an array or primitive).')
          return
        }

        // Build the set of fields the schema declares as reference arrays.
        const schema = props.schemaType as ObjectSchemaType
        const refArrayFields = new Set<string>()
        for (const field of schema?.fields ?? []) {
          if (isReferenceArrayField(field)) refArrayFields.add(field.name)
        }

        // Patch each top-level field from the JSON onto the document.
        Object.entries(data).forEach(([key, rawValue]) => {
          if (SYSTEM_FIELDS.has(key)) return

          // 1) If the schema says this field is a reference array, normalize
          //    its members into reference objects (handles bare-string IDs).
          let value: unknown = refArrayFields.has(key)
            ? coerceReferences(rawValue)
            : rawValue

          // 2) Ensure every array-item object (refs, blocks, etc.) has a _key.
          value = addKeys(value)

          props.onChange(set(value, [key]))
        })
      } catch (err) {
        alert('Failed to parse JSON: ' + (err as Error).message)
      }
      // Reset so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [props],
  )

  return (
    <Stack space={4}>
      <Card padding={3} radius={2} tone="primary" border>
        <Stack space={3}>
          <Text size={1} weight="semibold">
            Import from JSON
          </Text>
          <Text size={1} muted>
            Upload a .json file to pre-populate the fields below. Matching field
            names will be overwritten. Array items get keys automatically, and
            reference arrays accept either reference objects or bare target IDs.
          </Text>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
          />
        </Stack>
      </Card>
      {props.renderDefault(props)}
    </Stack>
  )
}

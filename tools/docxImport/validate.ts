// The checks the batch pipeline runs before anything is written. Errors block the import;
// warnings are shown but do not.

export interface ValidationResult {
  errors: string[]
  warnings: string[]
}

const DEFAULT_DECORATORS = ['strong', 'em', 'code', 'underline', 'strike-through']

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** Validate one Portable Text field value. `decorators` are the block type's allowed decorators. */
export function validateBlocks(
  field: string,
  blocks: unknown,
  decorators: string[] = DEFAULT_DECORATORS,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!Array.isArray(blocks)) return {errors: [`${field}: not an array.`], warnings}

  // _key must be unique among siblings (Sanity's rule), and keys are never reused anywhere in
  // the field — a repeat is a copy/paste bug even where Sanity would accept it.
  const seen = new Map<string, string>()
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      const siblings = new Set<string>()
      value.forEach((item, i) => {
        const p = `${path}[${i}]`
        if (isObj(item)) {
          if (typeof item._key !== 'string' || !item._key) errors.push(`${p}: missing _key.`)
          else {
            if (siblings.has(item._key)) errors.push(`${p}: duplicate _key "${item._key}" in the same array.`)
            else if (seen.has(item._key)) errors.push(`${p}: _key "${item._key}" is also used at ${seen.get(item._key)}.`)
            siblings.add(item._key)
            if (!seen.has(item._key)) seen.set(item._key, p)
          }
          if (typeof item._type !== 'string' || !item._type) errors.push(`${p}: missing _type.`)
        }
        walk(item, p)
      })
    } else if (isObj(value)) {
      if (value._type === 'block') checkBlock(value, path)
      if (value._type === 'richTableBlock' || value._type === 'richTable') checkTable(value, path)
      for (const [k, v] of Object.entries(value)) if (typeof v === 'object') walk(v, `${path}.${k}`)
    }
  }

  const checkBlock = (block: Record<string, any>, path: string) => {
    const defs = new Set<string>((block.markDefs ?? []).map((d: any) => d?._key))
    for (const [i, span] of (block.children ?? []).entries()) {
      if (span?._type !== 'span') continue
      for (const mark of span.marks ?? []) {
        if (!decorators.includes(mark) && !defs.has(mark)) {
          errors.push(`${path}.children[${i}]: mark "${mark}" is neither an allowed decorator nor in markDefs.`)
        }
      }
      const text = String(span.text ?? '')
      const stray = [
        text.includes('**') && '"**"',
        /(^|\s)##/.test(text) && '"##"',
        i === 0 && /^\s*- /.test(text) && 'a leading "- "',
      ].filter(Boolean)
      if (stray.length) {
        warnings.push(`${path}: text contains ${stray.join(' and ')} — leftover Markdown? "${text.slice(0, 60)}"`)
      }
    }
  }

  const checkTable = (table: Record<string, any>, path: string) => {
    const headers: any[] = table.columnHeaders ?? []
    const rows: any[] = table.rows ?? []
    if (!rows.length) errors.push(`${path}: table has no rows.`)
    headers.forEach((h, i) => {
      if (h?.cellIndex !== i) errors.push(`${path}.columnHeaders[${i}]: cellIndex is ${h?.cellIndex}, expected ${i}.`)
    })
    const width = headers.length || (rows[0]?.cells?.length ?? 0)
    rows.forEach((r, i) => {
      const n = r?.cells?.length ?? 0
      if (n !== width) errors.push(`${path}.rows[${i}]: ${n} cells, expected ${width} — table is not rectangular.`)
    })
  }

  walk(blocks, field)
  return {errors, warnings}
}

export function mergeResults(...results: ValidationResult[]): ValidationResult {
  return {errors: results.flatMap((r) => r.errors), warnings: results.flatMap((r) => r.warnings)}
}

/** Decorators allowed by a compiled Portable Text array type (falls back to Sanity's defaults). */
export function decoratorsOf(arrayType: any): string[] {
  const block = arrayType?.of?.find((m: any) => m?.name === 'block')
  const list = block?.marks?.decorators?.map((d: any) => d?.value).filter(Boolean)
  return list?.length ? list : DEFAULT_DECORATORS
}

/**
 * JsonImportField — Sanity Studio v3 custom input
 * ------------------------------------------------
 * Paste a `spot` JSON (lean code-string form OR fully-expanded object form),
 * and this resolves every reference field against existing documents, generates
 * _key/_ref, and patches the current document. Unmatched codes BLOCK the import
 * and are listed, so nothing is ever silently dropped.
 *
 * SETUP
 *   1) Save this as components/JsonImportField.jsx
 *   2) Add a trigger field to your `spot` schema:
 *
 *        import {JsonImportField} from '../components/JsonImportField'
 *        defineField({
 *          name: 'jsonImport',
 *          title: 'Import from JSON',
 *          type: 'string',
 *          components: {input: JsonImportField},
 *        })
 *
 *   3) Edit FIELD_MAP below so each reference field matches YOUR schema:
 *      `type` = the referenced document _type, `field` = the field that holds
 *      the code/name you're matching on (e.g. 'code', 'spotId', 'title').
 *      Anything not in FIELD_MAP (macroRegion, platform, slug, Portable Text)
 *      is passed through untouched.
 */
import {useState, useCallback} from 'react'
import {useClient, useFormValue, set, unset} from 'sanity'
import {Stack, Card, Button, TextArea, Text, Flex, Badge, Spinner, useToast} from '@sanity/ui'

// reference field -> { type: target _type, field: field on that type to match }
const FIELD_MAP = {
  zone: {type: 'zone', field: 'code'},
  region: {type: 'region', field: 'code'},
  seasons: {type: 'season', field: 'title'},
  targetSpecies: {type: 'targetSpecies', field: 'code'},
  baitfish: {type: 'baitfish', field: 'code'},
  mode: {type: 'mode', field: 'code'},
  structure: {type: 'structure', field: 'code'},
  approaches: {type: 'approach', field: 'code'},
  techniqueRetrieve: {type: 'techniqueRetrieve', field: 'code'},
  parentLure: {type: 'parentLure', field: 'code'},
  lureGearCategory: {type: 'lureGearCategory', field: 'code'},
  lureCatalog: {type: 'lure', field: 'code'},
  nearbySpots: {type: 'spot', field: 'spotId'},
  relatedVideos: {type: 'video', field: 'youtubeId'},
}

const SYSTEM = new Set(['_id', '_rev', '_type', '_createdAt', '_updatedAt', 'jsonImport'])

const rkey = () => Math.random().toString(36).slice(2, 12)

// "STB - Striped Bass" -> "STB"; bare names pass through; objects -> their _ref
const codeOf = (v) => {
  if (v && typeof v === 'object') return v._ref ?? ''
  return String(v).includes(' - ') ? String(v).split(' - ')[0].trim() : String(v).trim()
}

// recursively guarantee every object inside an array has a _key
function ensureKeys(node) {
  if (Array.isArray(node)) {
    node.forEach((it) => {
      if (it && typeof it === 'object' && !Array.isArray(it) && !('_key' in it)) it._key = rkey()
      ensureKeys(it)
    })
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach(ensureKeys)
  }
}

// resolve every reference field; returns the mutated doc + a list of misses
async function resolveReferences(doc, client) {
  const unresolved = []
  for (const [refField, cfg] of Object.entries(FIELD_MAP)) {
    if (!Array.isArray(doc[refField])) continue

    // codes we still need to look up (skip items that are already real refs)
    const stringItems = doc[refField].filter((v) => typeof v === 'string')
    const codes = [...new Set(stringItems.map(codeOf))]

    let byCode = {}
    if (codes.length) {
      const hits = await client.fetch(
        `*[_type == $type && ${cfg.field} in $codes]{ _id, "code": ${cfg.field} }`,
        {type: cfg.type, codes},
      )
      byCode = Object.fromEntries(hits.map((h) => [h.code, h._id]))
    }

    doc[refField] = doc[refField].flatMap((item) => {
      // already an expanded reference object — keep it (ensureKeys adds _key later)
      if (item && typeof item === 'object') {
        return item._ref ? [item] : []
      }
      const code = codeOf(item)
      const id = byCode[code]
      if (!id) {
        unresolved.push(`${refField}: "${code}"`)
        return []
      }
      return [{_type: 'reference', _ref: id, _key: rkey()}]
    })
  }
  return {doc, unresolved}
}

export function JsonImportField(props) {
  const {onChange} = props
  const client = useClient({apiVersion: '2024-01-01'})
  const docId = useFormValue(['_id'])
  const toast = useToast()

  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [misses, setMisses] = useState([])

  const handleImport = useCallback(async () => {
    setMisses([])

    if (!docId) {
      toast.push({status: 'warning', title: 'Save the document once before importing.'})
      return
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      toast.push({status: 'error', title: 'Invalid JSON', description: e.message})
      return
    }
    if (Array.isArray(parsed)) parsed = parsed[0] // single doc only

    setBusy(true)
    try {
      const {doc, unresolved} = await resolveReferences(parsed, client)

      if (unresolved.length) {
        setMisses(unresolved)
        toast.push({
          status: 'error',
          title: `Import blocked — ${unresolved.length} unmatched reference(s)`,
          description: 'Fix the codes or create the missing docs, then re-import.',
        })
        return
      }

      ensureKeys(doc)

      // strip system fields + the trigger field, patch everything else
      const fields = {}
      for (const [k, v] of Object.entries(doc)) if (!SYSTEM.has(k)) fields[k] = v

      await client.patch(docId).set(fields).commit()

      onChange(unset()) // clear the paste box
      setRaw('')
      toast.push({status: 'success', title: 'Imported and references linked.'})
    } catch (e) {
      toast.push({status: 'error', title: 'Import failed', description: e.message})
    } finally {
      setBusy(false)
    }
  }, [raw, docId, client, toast, onChange])

  return (
    <Stack space={3}>
      <TextArea
        rows={10}
        value={raw}
        placeholder="Paste spot JSON here…"
        onChange={(e) => setRaw(e.currentTarget.value)}
        disabled={busy}
        style={{fontFamily: 'Inconsolata, monospace', fontSize: 13}}
      />
      <Flex align="center" gap={3}>
        <Button
          text={busy ? 'Importing…' : 'Resolve refs & import'}
          tone="primary"
          disabled={busy || !raw.trim()}
          onClick={handleImport}
        />
        {busy && <Spinner muted />}
        {!busy && raw.trim() && <Text size={1} muted>{Math.round(raw.length / 1024)} KB</Text>}
      </Flex>

      {misses.length > 0 && (
        <Card tone="critical" padding={3} radius={2} shadow={1}>
          <Stack space={2}>
            <Flex align="center" gap={2}>
              <Badge tone="critical">{misses.length}</Badge>
              <Text size={1} weight="semibold">Unmatched references — nothing was imported</Text>
            </Flex>
            {misses.map((m, i) => (
              <Text key={i} size={1} muted style={{fontFamily: 'monospace'}}>{m}</Text>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}

export default JsonImportField

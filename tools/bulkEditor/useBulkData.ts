/**
 * Data hooks for the Bulk Editor, on the Studio's own client (no second SDK/App provider).
 *
 * Reads use the `drafts` perspective, so a document shows its draft when one exists. Freshness
 * comes from `client.listen()`, which reports draft mutations under both Studio login methods
 * (cookie and token); every mutation event schedules a debounced refetch.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useClient, useSchema} from 'sanity'
import {buildEdit, editAction, statusFromIds, type DocStatus} from './actions'
import {buildRefIndexQuery, buildRowsQuery, STATUS_QUERY, type GridFilters} from './groq'
import {previewTitleField, type ColumnDef} from './schemaColumns'

// 2025-02-19 is the first API version that accepts the `drafts` perspective name.
export const API_VERSION = '2025-02-19'
// One stable object: useClient() hands back a new client whenever this object's identity changes.
const CLIENT_OPTIONS = {apiVersion: API_VERSION}
const REFETCH_DEBOUNCE_MS = 400

export function useBulkClient() {
  return useClient(CLIENT_OPTIONS)
}

export interface Row {
  _id: string
  _type: string
  _updatedAt: string
  _rev: string
  id?: string | null
  [key: string]: unknown
}

interface GridState {
  rows: Row[]
  total: number
  status: Map<string, DocStatus>
  loading: boolean
  loaded: boolean
  error: Error | null
}

// Optimistic values per document, kept until a fetch returns a newer revision of it.
type Overlay = Map<string, {rev: string; values: Record<string, unknown>}>

/** Debounced refetch on every mutation to documents matching `query`. */
function useListenRefetch(query: string, params: Record<string, unknown>, onChange: () => void, enabled = true) {
  const client = useBulkClient()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const paramsKey = JSON.stringify(params)
  const [liveError, setLiveError] = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => onChangeRef.current(), REFETCH_DEBOUNCE_MS)
    }
    const sub = client
      .listen(query, JSON.parse(paramsKey), {
        events: ['welcome', 'mutation', 'reconnect'],
        includeResult: false,
        visibility: 'query',
        tag: 'bulk-editor.listen',
      })
      .subscribe({
        next: (event) => {
          if (event.type === 'welcome') setLiveError(null)
          else schedule()
        },
        error: (err) => setLiveError(err instanceof Error ? err : new Error(String(err))),
      })
    return () => {
      clearTimeout(timer)
      sub.unsubscribe()
    }
  }, [client, query, paramsKey, enabled])

  return liveError
}

export function useGridData(typeName: string, visible: ColumnDef[], all: ColumnDef[], filters: GridFilters) {
  const client = useBulkClient()
  const [state, setState] = useState<GridState>({
    rows: [],
    total: 0,
    status: new Map(),
    loading: true,
    loaded: false,
    error: null,
  })
  const [overlay, setOverlay] = useState<Overlay>(new Map())
  const {query, params} = useMemo(
    () => buildRowsQuery(typeName, visible, all, filters),
    [typeName, visible, all, filters],
  )
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setState((s) => ({...s, loading: true}))
    try {
      const [result, ids] = await Promise.all([
        client.fetch<{rows: Row[]; total: number}>(query, params, {perspective: 'drafts', tag: 'bulk-editor.rows'}),
        client.fetch<string[]>(STATUS_QUERY, {type: typeName}, {perspective: 'raw', tag: 'bulk-editor.status'}),
      ])
      if (request !== requestRef.current) return
      setState({rows: result.rows, total: result.total, status: statusFromIds(ids), loading: false, loaded: true, error: null})
      setOverlay((prev) => {
        if (!prev.size) return prev
        const revs = new Map(result.rows.map((r) => [r._id, r._rev]))
        const next: Overlay = new Map()
        for (const [id, entry] of prev) if (revs.get(id) === entry.rev) next.set(id, entry)
        return next
      })
    } catch (err) {
      if (request !== requestRef.current) return
      setState((s) => ({...s, loading: false, error: err instanceof Error ? err : new Error(String(err))}))
    }
  }, [client, query, params, typeName])

  useEffect(() => {
    load()
  }, [load])

  const liveError = useListenRefetch('*[_type == $type]', {type: typeName}, load)

  const rows = useMemo(
    () =>
      overlay.size
        ? state.rows.map((r) => {
            const entry = overlay.get(r._id)
            return entry ? {...r, ...entry.values} : r
          })
        : state.rows,
    [state.rows, overlay],
  )

  const setOptimistic = useCallback((row: Row, key: string, value: unknown) => {
    setOverlay((prev) => {
      const next = new Map(prev)
      const entry = next.get(row._id)
      next.set(row._id, {rev: entry?.rev ?? row._rev, values: {...entry?.values, [key]: value}})
      return next
    })
  }, [])

  const dropOptimistic = useCallback((row: Row, key: string) => {
    setOverlay((prev) => {
      const entry = prev.get(row._id)
      if (!entry || !(key in entry.values)) return prev
      const next = new Map(prev)
      const {[key]: _dropped, ...values} = entry.values
      if (Object.keys(values).length) next.set(row._id, {...entry, values})
      else next.delete(row._id)
      return next
    })
  }, [])

  /** Inline edit: show the value at once, write the draft, roll back on failure. */
  const commitEdit = useCallback(
    async (row: Row, col: ColumnDef, value: unknown) => {
      const edit = buildEdit(col, value, row[col.key])
      if (!edit) return
      setOptimistic(row, col.key, edit.rowValue)
      try {
        await client.action(editAction(row._id, edit.patch), {tag: 'bulk-editor.edit'})
      } catch (err) {
        dropOptimistic(row, col.key)
        throw err
      }
    },
    [client, setOptimistic, dropOptimistic],
  )

  return {...state, rows, liveError, reload: load, commitEdit}
}

export interface RefTarget {
  _id: string
  _type: string
  id?: string | null
  title?: string | null
}

export interface RefIndex {
  byId: Map<string, RefTarget>
  list: RefTarget[]
  loaded: boolean
}

/** Labels for every document of the given types, for reference cells and pickers. */
export function useRefIndex(types: string[]): RefIndex {
  const client = useBulkClient()
  const schema = useSchema()
  const typesKey = [...new Set(types)].sort().join(',')
  const [state, setState] = useState<{list: RefTarget[]; loaded: boolean}>({list: [], loaded: false})

  const query = useMemo(() => {
    const titles: Record<string, string | undefined> = {}
    for (const t of typesKey.split(',').filter(Boolean)) titles[t] = previewTitleField(schema, t)
    return buildRefIndexQuery(titles)
  }, [schema, typesKey])

  const load = useCallback(async () => {
    if (!typesKey) {
      setState({list: [], loaded: true})
      return
    }
    try {
      const list = await client.fetch<RefTarget[]>(
        query,
        {types: typesKey.split(',')},
        {perspective: 'drafts', tag: 'bulk-editor.refs'},
      )
      setState({list, loaded: true})
    } catch {
      // Labels are a nicety: cells fall back to showing the raw _ref.
      setState((s) => ({...s, loaded: true}))
    }
  }, [client, query, typesKey])

  useEffect(() => {
    load()
  }, [load])

  useListenRefetch('*[_type in $types]', {types: typesKey.split(',')}, load, Boolean(typesKey))

  return useMemo(
    () => ({byId: new Map(state.list.map((t) => [t._id, t])), list: state.list, loaded: state.loaded}),
    [state],
  )
}

const VISIBLE_KEY = (typeName: string) => `bulkEditor.columns.${typeName}`
const DEFAULT_VISIBLE = 12

function readStoredColumns(typeName: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(VISIBLE_KEY(typeName))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : null
  } catch {
    return null
  }
}

export function defaultVisibleColumns(columns: ColumnDef[]): string[] {
  return columns
    .filter((c) => c.kind !== 'summary')
    .slice(0, DEFAULT_VISIBLE)
    .map((c) => c.key)
}

/** Which columns show, per document type, remembered in this browser. */
export function useColumnVisibility(typeName: string, columns: ColumnDef[]) {
  const [visibleKeys, setVisibleKeys] = useState<string[]>(
    () => readStoredColumns(typeName) ?? defaultVisibleColumns(columns),
  )
  const update = useCallback(
    (keys: string[]) => {
      setVisibleKeys(keys)
      try {
        window.localStorage.setItem(VISIBLE_KEY(typeName), JSON.stringify(keys))
      } catch {
        // Storage can be unavailable (private window); the choice just won't persist.
      }
    },
    [typeName],
  )
  const known = new Set(columns.map((c) => c.key))
  const visible = useMemo(
    () => columns.filter((c) => visibleKeys.includes(c.key)),
    [columns, visibleKeys],
  )
  return {visible, visibleKeys: visibleKeys.filter((k) => known.has(k)), setVisibleKeys: update}
}

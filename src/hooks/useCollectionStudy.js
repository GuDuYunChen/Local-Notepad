import { useCallback, useEffect, useRef, useState } from 'react'
import { collectionStudy, COLLECTION_STUDY_PREFIX } from '~/services/collectionStudy'
import { searchCollections, SEARCH_COLLECTION_PREFIX } from '~/services/searchCollections'

export default function useCollectionStudy(entry, { sourceStore = searchCollections, studyStore = collectionStudy } = {}) {
  const [state, setState] = useState({ snapshot: null, error: '', loading: false })
  const [busy, setBusy] = useState(false)
  const life = useRef(0)
  const sequence = useRef(0), mounted = useRef(false), writing = useRef(false)
  const currentEntry = useRef(entry); currentEntry.current = entry
  const refresh = useCallback(async () => {
    const seq = ++sequence.current
    if (!entry) { setState({ snapshot: null, error: '', loading: false }); return }
    setState(previous => ({ ...previous, loading: true, error: '' }))
    try {
      const snapshot = await studyStore.load(entry, sourceStore)
      if (mounted.current && seq === sequence.current) setState({ snapshot, error: '', loading: false })
    } catch (failure) {
      if (mounted.current && seq === sequence.current) setState({ snapshot: null, error: failure.message || '阅读记录暂不可用', loading: false })
    }
  }, [entry?.key, entry?.raw, studyStore, sourceStore])
  useEffect(() => {
    mounted.current = true; void refresh()
    const storage = event => { if (event.key === null || event.key?.startsWith(COLLECTION_STUDY_PREFIX) || event.key?.startsWith(SEARCH_COLLECTION_PREFIX)) void refresh() }
    const listener = () => { void refresh() }
    const off = studyStore.subscribe(listener), offSource = sourceStore.subscribe(listener)
    window.addEventListener('storage', storage); window.addEventListener('focus', listener)
    return () => { mounted.current = false; life.current++; sequence.current++; off(); offSource(); window.removeEventListener('storage', storage); window.removeEventListener('focus', listener) }
  }, [refresh, studyStore, sourceStore])
  const write = async (action, expected = state.snapshot) => {
    if (writing.current || !expected) return null
    writing.current = true; setBusy(true)
    const generation = life.current
    const options = { sourceStore, isCurrent: () => mounted.current && life.current === generation && currentEntry.current?.key === expected.entry.key && currentEntry.current?.raw === expected.entry.raw }
    try {
      const result = await action(expected, options)
      if (options.isCurrent()) { sequence.current++; setState({ snapshot: result, error: '', loading: false }) }
      return result
    } catch (failure) {
      if (mounted.current) setState(previous => ({ ...previous, error: failure.message || '阅读记录未保存' }))
      return null
    } finally { writing.current = false; if (mounted.current) setBusy(false) }
  }
  // Hide a prior collection snapshot immediately, before the new effect runs.
  const snapshot = state.snapshot?.entry.key === entry?.key && state.snapshot?.entry.raw === entry?.raw ? state.snapshot : null
  return { ...state, snapshot, busy, refresh, write, studyStore, sourceStore }
}

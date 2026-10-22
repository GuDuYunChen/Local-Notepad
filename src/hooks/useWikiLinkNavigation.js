import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { api } from '~/services/api'
import { rememberReference } from '../components/Editor/utils/referenceUtils.js'
import { createWikiNavigator } from '../services/wikiNavigation.mjs'

export default function useWikiLinkNavigation({ currentId, content, workspace, navigationEpoch, onOpenFile }) {
  const latest = useRef({ currentId, content, workspace, onOpenFile })
  useLayoutEffect(() => { latest.current = { currentId, content, workspace, onOpenFile } })
  const model = useRef(null)
  if (!model.current) model.current = createWikiNavigator({
    getContext: () => ({ ...latest.current, epoch: navigationEpoch.current }),
    openFile: (id, options) => latest.current.onOpenFile(id, options),
    api,
    remember: rememberReference,
  })
  const navigator = model.current
  const state = useSyncExternalStore(navigator.subscribe, navigator.snapshot, navigator.snapshot)
  useEffect(() => { navigator.contextChanged() }, [navigator, currentId, workspace])
  useEffect(() => {
    const open = event => { void navigator.open(event.detail) }
    window.addEventListener('wikiLink:open', open)
    return () => { window.removeEventListener('wikiLink:open', open); navigator.close() }
  }, [navigator])
  return { state, stop: navigator.stop, close: navigator.close, retry: navigator.retry }
}

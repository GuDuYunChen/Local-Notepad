import { useSyncExternalStore } from 'react'
import { getShortcutSnapshot, subscribeShortcuts } from '../services/localShortcuts'

export default function useLocalShortcuts() {
  return useSyncExternalStore(subscribeShortcuts, getShortcutSnapshot, getShortcutSnapshot)
}

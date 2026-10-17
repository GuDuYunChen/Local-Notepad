import React from 'react'
import { api } from '~/services/api'
import TrashWorkspacePanel from './TrashWorkspacePanel'
import { createTrashWorkspace } from '../services/trashWorkspace.mjs'
import './TrashWorkspacePanel.css'

export { trashDaysRemaining, formatTrashDeletedAt } from '../services/trashWorkspace.mjs'

// One local session owns in-flight requests across panel navigation. Merely
// importing this module does not read data, and no state is written to storage.
const workspace = createTrashWorkspace(api)
export default function TrashPanel(props) {
  return <TrashWorkspacePanel {...props} store={workspace} />
}

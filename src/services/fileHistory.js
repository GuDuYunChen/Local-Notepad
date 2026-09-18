import { api } from './api'

export async function executeFileHistoryAction(action, direction, request = api) {
  if (!action?.type || !action?.data?.id) {
    throw new Error('无效的文件历史操作')
  }

  const undo = direction === 'undo'
  if (!undo && direction !== 'redo') {
    throw new Error('无效的历史操作方向')
  }

  const { id } = action.data

  switch (action.type) {
    case 'delete':
      if (undo) {
        return request(`/api/files/${id}/restore`, { method: 'POST' })
      }
      return request(`/api/files/${id}`, { method: 'DELETE' })

    case 'create':
      if (undo) {
        return request(`/api/files/${id}`, { method: 'DELETE' })
      }
      return request(`/api/files/${id}/restore`, { method: 'POST' })

    case 'rename':
      return request(`/api/files/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: undo ? action.data.oldTitle : action.data.newTitle,
        }),
      })

    case 'move':
      return request(`/api/files/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          parent_id: undo ? action.data.oldParentId : action.data.newParentId,
          sort_order: undo ? action.data.oldSortOrder : action.data.newSortOrder,
        }),
      })

    default:
      throw new Error(`不支持的文件历史操作: ${action.type}`)
  }
}

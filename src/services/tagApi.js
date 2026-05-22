import { api } from './api'

export const tagApi = {
  list: () => api('/api/tags'),
  create: (data) => api('/api/tags', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id) => api(`/api/tags/${id}`, { method: 'DELETE' }),
  getFileTags: (fileId) => api(`/api/files/${fileId}/tags`),
  addFileTag: (fileId, tagId) => api(`/api/files/${fileId}/tags`, { method: 'POST', body: JSON.stringify({ file_id: fileId, tag_id: tagId }) }),
  removeFileTag: (fileId, tagId) => api(`/api/files/${fileId}/tags/${tagId}`, { method: 'DELETE' }),
  getFilesByTag: (tagId) => api(`/api/tags/${tagId}/files`),
}

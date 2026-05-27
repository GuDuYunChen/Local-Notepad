const ERROR_MESSAGES = {
  1001: '文件不存在',
  1002: '文件内容不能为空',
  1003: '文件标题不能为空',
  1004: '标题长度不能超过 255 个字符',
  1005: '参数错误',
  1006: '保存失败',
  1007: '删除失败',
  1008: '导出失败',
  1009: '导入失败',
  1010: '文件上传失败',
  1011: '文件处理失败',
  1012: '不支持的文件类型',
  1013: '目标位置已存在同名文件或文件夹',
  1014: '不能将文件夹移动到其自身内部',
}

const DEFAULT_BASE = 'http://127.0.0.1:27121'

function getBaseURL() {
  const injected = window.__API_BASE__
  return injected || DEFAULT_BASE
}

export async function api(path, init) {
  const url = `${getBaseURL()}${path}`
  let res;
  try {
      res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...(init || {}),
      })
  } catch (e) {
      throw new Error('网络连接失败，请检查网络后重试')
  }
  
  if (!res.ok) {
    if (res.status === 404) throw new Error('服务未启动，请先启动后端服务')
    if (res.status >= 500) throw new Error('服务器内部错误，请查看日志')
    throw new Error(`请求失败 (HTTP ${res.status})`)
  }
  const body = await res.json()
  if (body.code !== 0) {
    const msg = ERROR_MESSAGES[body.code] || body.message || '请求失败'
    throw new Error(msg)
  }
  return body.data
}

export async function getBacklinks(fileId) {
  const res = await api(`/api/files/${fileId}/backlinks`)
  return res
}

export async function searchFiles(query) {
  const res = await api(`/api/files/search?q=${encodeURIComponent(query)}`)
  return res
}

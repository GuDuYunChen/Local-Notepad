const DEFAULT_BASE = 'http://127.0.0.1:27121'

function getBaseURL() {
  const injected = window.__API_BASE__
  return injected || DEFAULT_BASE
}

export async function api(path, init) {
  const url = `${getBaseURL()}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...(init || {}),
  })
  if (!res.ok) throw new Error(`网络错误: ${res.status}`)
  const body = await res.json()
  if (body.code !== 0) throw new Error(body.message || '请求失败')
  return body.data
}

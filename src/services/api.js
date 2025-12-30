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
  
  if (!res.ok) throw new Error(`网络连接失败，请检查网络后重试`)
  const body = await res.json()
  if (body.code !== 0) throw new Error(body.message || '请求失败')
  return body.data
}

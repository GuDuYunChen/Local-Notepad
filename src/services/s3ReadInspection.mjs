// Form admission only. The existing native bridge and Go reader remain the
// authority for URLs, signatures, budgets and response acceptance.
const TEXT_FIELDS = ['endpoint', 'bucket', 'region', 'prefix', 'key', 'accessKeyId', 'secretAccessKey', 'sessionToken']
const FIELDS = [...TEXT_FIELDS, 'maxBytes', 'consent']
const utf8 = value => new TextEncoder().encode(value).length
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key)
export const INSPECTION_MAX_BYTES = 1048576
export const INSPECTION_PRIVACY = '输入仅供本次检查使用，不保存到配置或备份；清空、关闭检查面板或离开设置会移除本面板中的输入。不能保证运行时内存被安全擦除。'
export const INSPECTION_STOP_NOTICE = '已停止采用本次结果，不代表底层读取已经取消。旧调用结束前，重新检查会被拒绝；不会自动重试。'
export const INSPECTION_FORM_FAILURE = '无法使用这些检查参数；本次没有发起读取。'
export function emptyInspectionDraft() {
  return { endpoint: '', bucket: '', region: '', prefix: '', key: '', accessKeyId: '', secretAccessKey: '', sessionToken: '', maxBytes: String(INSPECTION_MAX_BYTES), consent: false }
}
function wellFormed(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false
  }
  return true
}
function supportedKey(value) {
  return value.length > 0 && wellFormed(value) && utf8(value) <= 1024 &&
    !value.startsWith('/') && !/[\u0000-\u001f\u007f\\]/u.test(value) &&
    !value.split('/').some(part => part === '.' || part === '..')
}
function supportedEndpoint(value) {
  try {
    // Reject browser URL repair, credentials and even empty query/fragment
    // delimiters. Never send the URL parser's normalized value as the input.
    if (!/^https?:\/\//.test(value) || /[\s\\?#]/u.test(value)) return false
    const url = new URL(value), authority = value.slice(value.indexOf('://') + 3).split('/')[0]
    if (!url.hostname || authority.includes('@') || url.username || url.password || url.pathname !== '/') return false
    if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) return false
    if (url.protocol === 'https:') return true
    const rawHost = authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1) : authority.split(':')[0]
    const host = rawHost.toLowerCase()
    if (host !== url.hostname.toLowerCase()) return false
    return host === 'localhost' || host === '[::1]' ||
      (/^127(?:\.\d{1,3}){3}$/.test(host) && host.split('.').every(n => Number(n) <= 255))
  } catch { return false }
}
const invalid = errors => Object.freeze({ ok: false, payload: null, errors: Object.freeze(errors) })
export function prepareS3Inspection(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid({ form: INSPECTION_FORM_FAILURE })
    const proto = Object.getPrototypeOf(input)
    if (proto !== Object.prototype && proto !== null) return invalid({ form: INSPECTION_FORM_FAILURE })
    const keys = Reflect.ownKeys(input)
    if (keys.length !== FIELDS.length || keys.some(key => typeof key !== 'string' || !FIELDS.includes(key))) return invalid({ form: INSPECTION_FORM_FAILURE })
    const draft = Object.create(null)
    for (const key of FIELDS) {
      const d = Object.getOwnPropertyDescriptor(input, key)
      if (!d || !d.enumerable || !own(d, 'value')) return invalid({ form: INSPECTION_FORM_FAILURE })
      draft[key] = d.value
    }
    const errors = {}
    for (const key of [...TEXT_FIELDS, 'maxBytes']) {
      if (typeof draft[key] !== 'string' || draft[key].length > 65536 || !wellFormed(draft[key])) errors[key] = '请输入长度受支持、字符完整的文本。'
    }
    if (Object.keys(errors).length) return invalid(errors)
    if (!supportedEndpoint(draft.endpoint)) errors.endpoint = '填写根地址，例如 https://s3.example.com；不能包含账号、路径、查询或片段。HTTP 仅支持明确的本机回环地址。'
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(draft.bucket) || /\.\.|\.-|-\./.test(draft.bucket) || /^\d+\.\d+\.\d+\.\d+$/.test(draft.bucket)) errors.bucket = '填写 3–63 位小写字母、数字、点或连字符的桶名称，不能使用 IP 地址或相邻的点与连字符。'
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(draft.region)) errors.region = '填写服务商指定的区域；仅支持小写字母、数字和连字符，不自动探测。'
    if (draft.prefix && (!supportedKey(draft.prefix) || draft.prefix.endsWith('/'))) errors.prefix = '前缀不能以斜线开头或结尾，不能含 .、.. 路径段、反斜线或控制字符，最多 1024 个 UTF-8 字节。'
    if (!supportedKey(draft.key)) errors.key = '填写相对对象键；不能以斜线开头，不能含 .、.. 路径段、反斜线或控制字符，最多 1024 个 UTF-8 字节。'
    if (!errors.prefix && !errors.key && utf8(draft.prefix ? draft.prefix + '/' + draft.key : draft.key) > 1024) errors.key = '前缀与对象键拼接后超过 1024 个 UTF-8 字节，请缩短输入。'
    if (!/^[A-Za-z0-9]{1,128}$/.test(draft.accessKeyId)) errors.accessKeyId = '访问密钥 ID 必须为 1–128 位英文字母或数字。'
    if (!/^[\x21-\x7e]{1,4096}$/.test(draft.secretAccessKey)) errors.secretAccessKey = '填写访问密钥；仅支持不含空格的可见 ASCII 字符，最多 4096 字节。'
    if (!/^[\x21-\x7e]{0,16384}$/.test(draft.sessionToken)) errors.sessionToken = '临时令牌仅支持不含空格的可见 ASCII 字符，最多 16384 字节；不使用时留空。'
    if (!/^[0-9]{1,7}$/.test(draft.maxBytes) || Number(draft.maxBytes) < 1 || Number(draft.maxBytes) > INSPECTION_MAX_BYTES) errors.maxBytes = '读取上限必须是 1–1048576 之间的整数字节数。'
    if (draft.consent !== true) errors.consent = '请先确认只读取指定对象，不上传、不删除、不启动同步。'
    if (Object.keys(errors).length) return invalid(errors)
    // Preserve all text exactly, including composed Unicode, spaces and literal
    // % in keys. Prefix joining and request signing belong to the original Go reader.
    const payload = { endpoint: draft.endpoint, bucket: draft.bucket, region: draft.region,
      prefix: draft.prefix, key: draft.key, accessKeyId: draft.accessKeyId,
      secretAccessKey: draft.secretAccessKey, sessionToken: draft.sessionToken,
      maxBytes: Number(draft.maxBytes), readOnly: true }
    if (utf8(JSON.stringify(payload)) > 65536) return invalid({ form: '检查参数合计超过 64 KiB；本次没有发起读取。' })
    return Object.freeze({ ok: true, errors: Object.freeze({}), payload: Object.freeze(payload) })
  } catch { return invalid({ form: INSPECTION_FORM_FAILURE }) }
}
const NEXT_STEPS = Object.freeze({
  readable: '本次检查已结束。可以修改目标后重新检查；这里不会启用任何同步。',
  'access-denied': '核对服务商的对象读取策略和访问范围，再手动重试。不能仅凭 401/403 判定密码错误。',
  'not-found': '核对桶、前缀和对象键。404 不证明对象一定不存在，也不证明配置或权限正确。',
  'redirect-refused': '从服务商处确认正确的区域和根地址；这里不会跟随重定向。',
  'too-large': '选择限额以内的对象，或在允许范围内调整读取上限；不接受部分数据。',
  'body-rejected': '核对对象响应的编码与完整性；不展示或保存未完成的正文。',
  'session-busy': '旧的原生调用尚未返回，未发起新读取。原生调用结束后再点“重新检查”。',
  'native-probe-busy': '本机原生通道正在使用，未排队。待该调用结束后再手动检查。',
  'probe-busy': '本机检查服务正在使用，未排队。待该调用结束后再手动检查。',
  'wait-stopped': INSPECTION_STOP_NOTICE,
  'wait-timeout': '界面等待已超时，不代表底层读取已结束。旧调用未返回时拒绝重入；稍后可手动重新检查。',
  'native-unavailable': '请在桌面应用中使用本模块；本页面不会通过浏览器直连云端。',
  'invalid-reply': '原生返回不符合约定，结果已拒绝。核对应用与本机服务状态后再手动检查。',
})
export function inspectionNextStep(code) {
  return own(NEXT_STEPS, code) ? NEXT_STEPS[code] : '核对当前输入和本机服务状态后手动重试；失败不会自动启动下一次检查。'
}

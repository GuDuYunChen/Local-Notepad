import hljs from 'highlight.js/lib/core'

const LANGUAGE_ALIASES = {
  text: 'plaintext',
  html: 'xml',
  markup: 'xml',
  jsx: 'javascript',
  tsx: 'typescript',
  shell: 'bash',
  sh: 'bash',
  assembly: 'x86asm',
  yml: 'yaml',
}

const LANGUAGE_LOADERS = {
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  less: () => import('highlight.js/lib/languages/less'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  json: () => import('highlight.js/lib/languages/json'),
  python: () => import('highlight.js/lib/languages/python'),
  java: () => import('highlight.js/lib/languages/java'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  php: () => import('highlight.js/lib/languages/php'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  swift: () => import('highlight.js/lib/languages/swift'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  sql: () => import('highlight.js/lib/languages/sql'),
  bash: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  dart: () => import('highlight.js/lib/languages/dart'),
  scala: () => import('highlight.js/lib/languages/scala'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  perl: () => import('highlight.js/lib/languages/perl'),
  lua: () => import('highlight.js/lib/languages/lua'),
  r: () => import('highlight.js/lib/languages/r'),
  matlab: () => import('highlight.js/lib/languages/matlab'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  lisp: () => import('highlight.js/lib/languages/lisp'),
  scheme: () => import('highlight.js/lib/languages/scheme'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  x86asm: () => import('highlight.js/lib/languages/x86asm'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  ini: () => import('highlight.js/lib/languages/ini'),
  toml: () => import('highlight.js/lib/languages/ini'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  cmake: () => import('highlight.js/lib/languages/cmake'),
  diff: () => import('highlight.js/lib/languages/diff'),
  http: () => import('highlight.js/lib/languages/http'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  latex: () => import('highlight.js/lib/languages/latex'),
  coffeescript: () => import('highlight.js/lib/languages/coffeescript'),
  handlebars: () => import('highlight.js/lib/languages/handlebars'),
  twig: () => import('highlight.js/lib/languages/twig'),
  awk: () => import('highlight.js/lib/languages/awk'),
}

const registered = new Set()
const loading = new Map()

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeLanguage(language) {
  const value = String(language || 'plaintext').toLowerCase()
  return LANGUAGE_ALIASES[value] || value
}

async function ensureLanguage(language) {
  const normalized = normalizeLanguage(language)

  if (normalized === 'plaintext') return null
  if (registered.has(normalized)) return normalized

  const loader = LANGUAGE_LOADERS[normalized]
  if (!loader) return null

  if (!loading.has(normalized)) {
    loading.set(normalized, loader().then(module => {
      hljs.registerLanguage(normalized, module.default)
      registered.add(normalized)
      loading.delete(normalized)
      return normalized
    }).catch(error => {
      loading.delete(normalized)
      throw error
    }))
  }

  return loading.get(normalized)
}

export async function highlightCode(code, language) {
  const normalized = normalizeLanguage(language)

  if (normalized === 'plaintext') {
    return escapeHtml(code)
  }

  try {
    const registeredLanguage = await ensureLanguage(normalized)
    if (!registeredLanguage) return escapeHtml(code)

    return hljs.highlight(String(code), {
      language: registeredLanguage,
      ignoreIllegals: true,
    }).value
  } catch (error) {
    console.error('Syntax highlighting failed:', error)
    return escapeHtml(code)
  }
}

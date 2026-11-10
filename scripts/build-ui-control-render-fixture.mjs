import { build, version as esbuildVersion } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'test-results/ui-controls-render/fixture')
const hashFile = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

export async function buildUiControlRenderFixture() {
  fs.mkdirSync(output, { recursive: true })
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['scripts/ui-control-render-fixture.jsx'],
    outfile: path.join(output, 'fixture.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome126',
    alias: { '~': path.join(root, 'src') },
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
    assetNames: 'assets/[name]-[hash]',
    metafile: true, legalComments: 'none', logLevel: 'warning',
  })
  if (Object.values(result.metafile.outputs).some(file => file.imports.some(entry => entry.external))) {
    throw new Error('Native control fixture must not load external code or styles')
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'">
<title>Shared control regression fixture</title><link rel="stylesheet" href="fixture.css">
<style>
html,body,#root{height:100%;margin:0}body{overflow:auto;background:var(--paper);color:var(--ink)}
.ui-render-fixture{padding:16px;max-width:1600px;margin:auto;min-width:0}
.ui-render-fixture h1{font-size:19px;font-weight:600;line-height:1.4;margin:0 0 6px}.ui-render-fixture h2{font-size:14px;margin:14px 0 6px}
.probe-description{margin:0 0 10px;font-size:12px;color:var(--ink-soft)}
.probe-density{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.probe-cell{min-width:0;display:flex;flex-direction:column;gap:4px}.probe-cell>label{font-size:12px}
.probe-cell>[data-ui-control]{width:100%;min-width:0}.probe-receipt{display:block;overflow-wrap:anywhere;font-size:11px;margin:8px 0}
.probe-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.probe-fieldset{margin:12px 0;padding:12px;min-width:0;border:1px solid var(--line)}
.probe-fieldset legend{max-width:100%;padding:0 6px}.probe-fieldset legend>[data-ui-control]{width:200px;max-width:100%}
.probe-form-actions{display:flex;gap:12px;margin:12px 0;flex-wrap:wrap}
.probe-error{margin:12px 0}.probe-error>p{font-size:12px;color:var(--danger)}
.probe-dialog-overlay{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center}
.probe-dialog{padding:20px;max-width:480px;width:calc(100% - 32px);background:var(--surface);border:1px solid var(--line);border-radius:12px}
.probe-dialog>[data-ui-control="select"]{width:100%;margin-bottom:14px}
</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`
  fs.writeFileSync(path.join(output, 'fixture.html'), html)
  const sourcePaths = new Set(Object.keys(result.metafile.inputs).filter(name => !name.startsWith('node_modules/')))
  for (const filename of ['package.json', 'package-lock.json', 'scripts/build-ui-control-render-fixture.mjs',
    'scripts/check-ui-control-render.cjs']) sourcePaths.add(filename)
  const sources = Object.fromEntries([...sourcePaths].sort().map(name => [name, hashFile(path.join(root, name))]))
  const artifacts = Object.fromEntries([...Object.keys(result.metafile.outputs), path.relative(root, path.join(output, 'fixture.html'))]
    .map(name => [path.relative(output, path.resolve(root, name)).replaceAll(path.sep, '/'), hashFile(path.resolve(root, name))]))
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const manifest = {
    schema: 1, scope: 'shared-controls-only', version: pkg.version,
    commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
    worktreeDirty: git('status', '--porcelain').length > 0,
    builtAt: new Date().toISOString(), esbuild: esbuildVersion,
    dependencies: Object.fromEntries(['react', 'react-dom', 'antd', 'electron'].map(name =>
      [name, JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version])),
    sources, artifacts,
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ output: path.relative(root, output), sources: sourcePaths.size,
    artifacts: Object.keys(artifacts).length, version: pkg.version, scope: manifest.scope }))
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildUiControlRenderFixture()

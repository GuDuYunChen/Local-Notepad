import { fixtureAntdNodeImports } from './fixture-antd-node-imports.mjs'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export async function buildLocalExportFixture() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./local-export-desktop-fixture.jsx', import.meta.url))],
    outfile: fileURLToPath(new URL('./local-export-desktop-fixture.bundle.mjs', import.meta.url)),
    bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'warning',
    // Resolve application aliases before packages:'external'. Node cannot resolve
    // Vite's ~/ imports, which now also occur in shared controls used by fixtures.
    alias: { '~': fileURLToPath(new URL('../src', import.meta.url)) },
    metafile: true,
    plugins: [fixtureAntdNodeImports(), { name: 'fixture-no-rendered-css', setup(builder) {
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-style', namespace: 'fixture-style' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture-style' }, () => ({ contents: '', loader: 'js' }))
    } }],
  })
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.some(item => item.external && /^~(?:\/|$)/.test(item.path))) {
      throw new Error('Local-export fixture contains an unresolved application alias')
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildLocalExportFixture()

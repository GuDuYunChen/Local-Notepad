import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export async function buildLocalExportFixture() {
  await build({
    entryPoints: [fileURLToPath(new URL('./local-export-desktop-fixture.jsx', import.meta.url))],
    outfile: fileURLToPath(new URL('./local-export-desktop-fixture.bundle.mjs', import.meta.url)),
    bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'warning',
    plugins: [{ name: 'fixture-no-rendered-css', setup(builder) {
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-style', namespace: 'fixture-style' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture-style' }, () => ({ contents: '', loader: 'js' }))
    } }],
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildLocalExportFixture()

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { fixtureAntdNodeImports } from './fixture-antd-node-imports.mjs'

for (const name of ['button', 'input', 'select', 'config-provider', 'theme', 'dropdown', 'message', 'space', 'tooltip']) {
  test(`Node fixture resolves the actual official ${name} export`, async () => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), '.antd-fixture-check-'))
    try {
      const outfile = path.join(directory, 'entry.mjs')
      await build({
        stdin: { contents: `export { default } from 'antd/es/${name}'`, resolveDir: process.cwd(), loader: 'js' },
        outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm',
        plugins: [fixtureAntdNodeImports()],
      })
      const actual = await import(pathToFileURL(outfile).href)
      const official = await import(`antd/lib/${name}/index.js`)
      assert.equal(actual.default, official.default.default ?? official.default)
      assert.doesNotMatch(await fs.readFile(outfile, 'utf8'), /from ["']antd\/es\//)
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })
}

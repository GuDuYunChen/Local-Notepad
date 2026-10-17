import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkAppVersion, inspectAppVersion } from './check-app-version.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const fixture = () => [JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))), JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json')))]
const setVersion = (m, l, v) => { m.version = l.version = l.packages[''].version = v }
export function registerAppVersionTests(test) {
  test('application version agrees in manifest and both lock roots', () => {
    const [m, l] = fixture(), before = JSON.stringify([m, l]), out = checkAppVersion(m, l)
    assert.equal(out.version, m.version); assert.equal(out.installer, `Notepad-${m.version}-Setup.exe`)
    assert.ok(Object.isFrozen(out)); assert.equal(JSON.stringify([m, l]), before)
  })
  for (const location of ['lock', 'root']) test(`application version refuses a stale ${location} version`, () => {
    const [m, l] = fixture(); if (location === 'lock') l.version = '1.0.0'; else l.packages[''].version = '1.0.0'
    assert.throws(() => checkAppVersion(m, l))
  })
  test('application version release gate rejects equal or lower accepted versions', () => {
    const [m, l] = fixture(); setVersion(m, l, '4.195.2')
    for (const previous of ['4.195.2', '4.195.3', '4.196.0', '5.0.0']) assert.throws(() => checkAppVersion(m, l, previous))
    assert.equal(checkAppVersion(m, l, '4.195.1').version, '4.195.2')
    setVersion(m, l, '4.196.0'); assert.equal(checkAppVersion(m, l, '4.195.99').version, '4.196.0')
  })
  test('application version is not a phase label, malformed value or oversized Windows version', () => {
    for (const v of ['2F.62.1', 'v4.195.2', '4.195', '04.195.2', '4.195.2-beta', '4.195.2+sha', '65536.0.0', null]) {
      const [m, l] = fixture(); setVersion(m, l, v); assert.throws(() => checkAppVersion(m, l))
    }
  })
  test('application version rejects stale installer names and contradictory build overrides', () => {
    for (const field of ['nsis', 'win', 'extraMetadata', 'buildVersion', 'appDirectory']) {
      const [m, l] = fixture()
      if (field === 'nsis' || field === 'win') m.build[field].artifactName = 'Notepad-4.195.1-Setup.exe'
      else if (field === 'extraMetadata') m.build.extraMetadata = { version: '1.0.0' }
      else if (field === 'appDirectory') m.build.directories.app = 'other-app'
      else m.build.buildVersion = '1.0.0'
      assert.throws(() => checkAppVersion(m, l))
    }
  })
  test('application version keeps the original dependency-lock checks active', () => {
    const [m, l] = fixture(); l.packages[''].dependencies.react = '0.0.0'
    assert.throws(() => checkAppVersion(m, l))
  })
  test('application diagnostics still obtains the runtime version from Electron', async () => {
    const [m] = fixture(), source = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8')
    const block = source.match(/ipcMain\.handle\('app:diagnostics',[\s\S]*?\n\}\)\)/)
    assert.ok(block, 'original diagnostics handler must be reviewed if its shape changes')
    let handler, reads = 0
    vm.runInNewContext(block[0], { ipcMain: { handle(channel, fn) { assert.equal(channel, 'app:diagnostics'); handler = fn } },
      app: { getVersion() { reads++; return m.version }, isPackaged: true }, process: { versions: {}, platform: 'win32', arch: 'x64' } })
    const out = await handler(); assert.equal(out.version, m.version); assert.equal(reads, 1); assert.equal(out.packaged, true)
    assert.match(source, /appVersion:\s*app\.getVersion\(\)/)
  })
  test('application version checks run before the original build commands', () => {
    const [m] = fixture()
    for (const script of ['build', 'build:main', 'build:renderer']) assert.ok(m.scripts[script].startsWith('npm run version:check && '))
    assert.equal(m.scripts['version:check'], 'node scripts/check-app-version.mjs')
  })
  test('application version inspection is independent of the calling working directory', () => {
    const child = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-app-version.mjs')], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 10000 })
    assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).version, inspectAppVersion().version)
  })
  test('application version CLI refuses same-version publication and unknown options', () => {
    for (const args of [[`--previous-version=${inspectAppVersion().version}`], ['--previous-version='], ['--unknown'], ['--previous-version=1.0.0', '--unknown']]) {
      const child = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-app-version.mjs'), ...args], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 10000 })
      assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.match(child.stderr, /^Application version check failed\./)
    }
  })
}

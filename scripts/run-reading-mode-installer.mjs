import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { validateShortcutManagementInstallerPin } from './shortcut-management-installed-evidence.mjs'
import { assertHostedWindows } from './installer-lifecycle-core.mjs'

assertHostedWindows(process.env, process.platform)
const pin = JSON.parse(readFileSync(new URL('./reading-mode-installer-pin.json', import.meta.url), 'utf8'))
validateShortcutManagementInstallerPin(pin)
assert.ok(['prepare', 'run'].includes(process.argv[2]), 'Expected prepare or run')
const child = spawnSync(process.execPath, [fileURLToPath(new URL('./run-reading-import-generated.mjs', import.meta.url)), process.argv[2]], { stdio: 'inherit' })
assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, 0, 'Original lifecycle plus required reading gate failed')

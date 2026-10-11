import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') throw new Error('This check requires actual Windows PowerShell 5.1')
const repo = fileURLToPath(new URL('../', import.meta.url))
const temp = mkdtempSync(path.join(os.tmpdir(), "notepad entry 用户 O'Brien "))
const output = path.join(repo, 'test-results', 'local-package')
mkdirSync(output, { recursive: true })
const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const invoke = (file, cwd, env = process.env, args = []) => spawnSync(ps,
  ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
  { cwd, env, encoding: 'utf8', timeout: 30000, windowsHide: true })
try {
  const legacy = path.join(temp, 'legacy'), fixed = path.join(temp, 'fixed'), bin = path.join(temp, 'stub-bin')
  for (const folder of [legacy, fixed, bin]) mkdirSync(folder)
  mkdirSync(path.join(legacy, 'node_modules')); mkdirSync(path.join(legacy, 'release'))
  writeFileSync(path.join(legacy, 'package.json'), '{}')
  writeFileSync(path.join(legacy, 'release', 'old.exe'), 'not a newly built installer')
  for (const tool of ['node', 'npm', 'go']) writeFileSync(path.join(bin, tool + '.cmd'), `@echo off\r\nexit /b ${tool === 'npm' ? 19 : 0}\r\n`)
  // Windows checkout can apply CRLF; reconstruct the committed LF body first.
  const checkedOut = readFileSync(path.join(repo, 'scripts', 'fixtures', 'legacy-pack-win.ps1.txt'))
  const source = Buffer.from(checkedOut.toString('utf8').replace(/\r\n/g, '\n'))
  const sourceBlob = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex')
  assert.equal(sourceBlob, '104a0fa05c604ccda760b9ae17907918b3237119')
  // BOM selects UTF-8 for PS5.1; the production script body remains exact.
  writeFileSync(path.join(legacy, 'old.ps1'), Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), source]))
  writeFileSync(path.join(legacy, 'driver.ps1'), "function Start-Process { param($FilePath, $ArgumentList) Write-Output 'STALE_EXE_OPENED' }\n& (Join-Path $PSScriptRoot 'old.ps1')\n")
  const legacyEnv = { ...process.env }
  for (const key of Object.keys(legacyEnv)) if (key.toLowerCase() === 'path') delete legacyEnv[key]
  legacyEnv.Path = bin + path.delimiter + process.env.Path
  const oldResult = invoke(path.join(legacy, 'driver.ps1'), legacy, legacyEnv)
  writeFileSync(path.join(output, 'legacy-entry.stdout.log'), oldResult.stdout || '')
  writeFileSync(path.join(output, 'legacy-entry.stderr.log'), oldResult.stderr || '')
  assert.equal(oldResult.error, undefined); assert.match(oldResult.stdout, /STALE_EXE_OPENED/)
  // The fixed wrapper must forward Node's failure, even if a stale EXE exists.
  mkdirSync(path.join(fixed, 'scripts')); mkdirSync(path.join(fixed, 'release'))
  for (const name of ['pack-win.ps1', 'scripts/package-windows.mjs', 'scripts/windows-package-core.mjs']) copyFileSync(path.join(repo, name), path.join(fixed, name))
  writeFileSync(path.join(fixed, 'package.json'), '{"name":"notepad-desktop","version":"4.217.1"}')
  writeFileSync(path.join(fixed, 'package-lock.json'), '{"version":"4.217.0"}')
  writeFileSync(path.join(fixed, 'release', 'old.exe'), 'keep me')
  const newResult = invoke(path.join(fixed, 'pack-win.ps1'), temp, process.env, ['-NoOpen'])
  writeFileSync(path.join(output, 'fixed-entry.stdout.log'), newResult.stdout || '')
  writeFileSync(path.join(output, 'fixed-entry.stderr.log'), newResult.stderr || '')
  assert.equal(newResult.error, undefined); assert.equal(newResult.status, 1)
  assert.match(newResult.stdout + newResult.stderr, /Manifest and lock versions do not match/)
  assert.equal(readFileSync(path.join(fixed, 'release', 'old.exe'), 'utf8'), 'keep me')
  const result = { complete: true, commit: process.env.GITHUB_SHA, realWindowsPowerShell: true, isolatedData: true,
    legacySourceBlob: sourceBlob, legacyExitCode: oldResult.status, fixedExitCode: newResult.status,
    checks: ['legacy-failed-npm-still-opens-stale-exe', 'fixed-native-failure-propagates', 'arbitrary-cwd-and-unicode-path', 'stale-file-preserved-not-delivered'] }
  writeFileSync(path.join(output, 'entry-contract.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { rmSync(temp, { recursive: true, force: true }) }

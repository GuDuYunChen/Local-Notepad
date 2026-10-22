import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const script = fs.readFileSync(new URL('../.github/scripts/electron-test-evidence.sh', import.meta.url), 'utf8')
const workflow = fs.readFileSync(new URL('../.github/workflows/ui-redesign-ci.yml', import.meta.url), 'utf8')
function isolated(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-electron-evidence-'))
  try {
    const call = (cmd, args, extra = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 10000, ...extra })
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'original\n')
    fs.writeFileSync(path.join(dir, '.gitignore'), 'test-results/\n')
    fs.writeFileSync(path.join(dir, 'capture.sh'), script)
    fs.mkdirSync(path.join(dir, 'bin'))
    fs.writeFileSync(path.join(dir, 'bin/npm'), `#!/usr/bin/env bash
printf '%s\\n' "$@" > test-results/electron-tests/actual-arguments.txt
printf 'synthetic stdout\\n'
printf 'synthetic failure stack\\n' >&2
if [[ "\${SIM_JSON:-yes}" == yes ]]; then printf '{"synthetic":true}\\n' > test-results/electron-tests/vitest.json; fi
if [[ "\${SIM_DRIFT:-no}" == yes ]]; then printf changed > tracked.txt; fi
exit "\${SIM_EXIT:-0}"
`, { mode: 0o755 })
    if (options.captureFailure) fs.writeFileSync(path.join(dir, 'bin/tee'), '#!/usr/bin/env bash\ncat > "$1"\nexit 49\n', { mode: 0o755 })
    for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=isolated-fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'isolated fixture']]) {
      const r = call('git', args); assert.equal(r.status, 0, r.stderr)
    }
    const head = call('git', ['rev-parse', 'HEAD']).stdout.trim()
    const tree = call('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim()
    if (options.stale) {
      fs.mkdirSync(path.join(dir, 'test-results/electron-tests'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'test-results/electron-tests/vitest.json'), 'KEEP EXISTING')
    }
    const env = { ...process.env, PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH,
      GITHUB_SHA: head, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'pull_request',
      SIM_EXIT: String(options.exit ?? 0), SIM_JSON: options.noJSON ? 'no' : 'yes', SIM_DRIFT: options.drift ? 'yes' : 'no' }
    const run = call('bash', ['capture.sh'], { env })
    assert.equal(run.error, undefined); assert.equal(run.signal, null)
    const read = name => fs.readFileSync(path.join(dir, 'test-results/electron-tests', name), 'utf8')
    options.verify?.({ run, read, head, tree, call })
    return run.status
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('captures original command, stdout/stderr, source identity and digest receipt', () => {
  assert.equal(isolated({ verify({ read, head, tree, call }) {
    assert.equal(read('actual-arguments.txt'), 'run\ntest:electron\n--\n--reporter=default\n--reporter=json\n--outputFile=test-results/electron-tests/vitest.json\n')
    assert.match(read('output.log'), /synthetic stdout/); assert.match(read('output.log'), /synthetic failure stack/)
    assert.equal(read('checkout.txt').trim(), head); assert.equal(read('checkout-after.txt').trim(), head)
    assert.equal(read('tree.txt').trim(), tree); assert.equal(read('tree-after.txt').trim(), tree)
    assert.equal(read('test-exit-code.txt'), '0\n'); assert.equal(read('capture-exit-code.txt'), '0\n'); assert.equal(read('source-exit-code.txt'), '0\n')
    assert.equal(read('trigger-sha.txt').trim(), head); assert.equal(read('run-id.txt'), '123\n')
    assert.equal(read('run-attempt.txt'), '1\n'); assert.equal(read('event.txt'), 'pull_request\n')
    assert.equal(call('sha256sum', ['-c', 'test-results/electron-tests/SHA256SUMS']).status, 0)
  } }), 0)
})
for (const exit of [1, 7, 27, 137]) test(`preserves npm failure exit ${exit}, report and raw stack`, () => {
  assert.equal(isolated({ exit, verify({ read }) { assert.equal(read('test-exit-code.txt'), `${exit}\n`); assert.match(read('output.log'), /synthetic failure stack/) } }), exit)
})
test('early npm failure without JSON still retains output and the original failure code', () => {
  assert.equal(isolated({ exit: 23, noJSON: true, verify({ read }) { assert.equal(read('test-exit-code.txt'), '23\n'); assert.match(read('output.log'), /synthetic failure stack/) } }), 23)
})
test('missing JSON cannot produce a passing capture', () => assert.notEqual(isolated({ noJSON: true }), 0))
test('capture failure cannot hide behind passing npm', () => assert.equal(isolated({ captureFailure: true }), 49))
test('npm failure keeps precedence over capture failure', () => assert.equal(isolated({ exit: 27, captureFailure: true }), 27))
test('tracked source mutation is rejected without undoing the mutation', () => assert.equal(isolated({ drift: true }), 1))
test('stale evidence is refused without deletion or overwrite', () => {
  assert.notEqual(isolated({ stale: true, verify({ read }) { assert.equal(read('vitest.json'), 'KEEP EXISTING') } }), 0)
})
test('workflow keeps failed Electron tests blocking editor tests and always uploads attempted evidence', () => {
  const section = workflow.slice(workflow.indexOf('      - name: Verify Electron evidence capture'), workflow.indexOf('\n\n  windows-package:'))
  assert.match(section, /node --test scripts\/electron-test-evidence\.node\.mjs/)
  assert.match(section, /name: Run Electron tests\n        id: electron_tests\n        run: bash \.github\/scripts\/electron-test-evidence\.sh/)
  assert.match(section, /if: always\(\) && steps\.electron_tests\.outcome != 'skipped'/)
  assert.match(section, /uses: actions\/upload-artifact@v4/)
  assert.match(section, /if-no-files-found: error/)
  assert.match(section, /name: Run editor tests\n        run: npm run test:editor/)
  assert.ok(!/continue-on-error|allow-failure|passWithNoTests/.test(section))
})

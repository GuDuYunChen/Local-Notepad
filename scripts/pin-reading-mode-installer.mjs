import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertHostedWindows } from './installer-lifecycle-core.mjs'
import { validateReadingModePin } from './reading-mode-installed-evidence.mjs'
import { prepareShortcutManagementVerifierSources, validateShortcutManagementInstallerPin } from './shortcut-management-installed-evidence.mjs'
import { prepareLocalExportVerifierSources, validateLocalExportInstallerPin } from './local-export-installed-evidence.mjs'
import { buildReadingModeFixture } from './build-reading-mode-fixture.mjs'

const blob = source => createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex')
export function validateReadingArtifact(pin, which, artifact) {
  validateReadingModePin(pin)
  assert.ok(['previous', 'current'].includes(which))
  const expected = pin[which + 'Source']
  const metadata = which === 'previous' ? pin.previousArtifactMetadata : expected
  assert.equal(artifact.id, expected.artifact); assert.equal(artifact.name, expected.name)
  assert.equal(artifact.expired, false)
  assert.equal(artifact.workflow_run.id, expected.run)
  assert.equal(artifact.workflow_run.repository_id, metadata.repositoryId)
  assert.equal(artifact.workflow_run.head_repository_id, metadata.repositoryId)
  assert.equal(artifact.workflow_run.head_branch, metadata.branch)
  assert.equal(artifact.workflow_run.head_sha, metadata.headSha)
  if (which === 'current') {
    // Pull-request artifacts are named with the merge-ref product SHA, while
    // GitHub artifact metadata records the source branch HEAD SHA.
    assert.equal(expected.name.slice(-40), pin.product, 'Artifact name must bind the product build identity')
  } else {
    assert.equal(expected.name.slice(-40), metadata.headSha, 'Historical seed name must bind its source commit')
  }
  assert.equal(artifact.size_in_bytes, metadata.archiveBytes, 'Pinned artifact archive size changed')
  assert.equal(artifact.digest, 'sha256:' + metadata.archiveSha256, 'Pinned artifact archive digest changed')
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pin = JSON.parse(readFileSync(new URL('./reading-mode-installer-pin.json', import.meta.url), 'utf8'))
  validateShortcutManagementInstallerPin(pin)
  validateLocalExportInstallerPin(pin)
  const command = process.argv[2]
  const out = path.resolve('test-results/installer-lifecycle')
  if (command === 'outputs') {
    assert.ok(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required for download identity outputs')
    for (const which of ['previous', 'current']) for (const key of ['run', 'artifact', 'name']) {
      const value = String(pin[which + 'Source'][key]); assert.doesNotMatch(value, /[\r\n]/)
      appendFileSync(process.env.GITHUB_OUTPUT, which + '-' + key + '=' + value + '\n')
    }
  } else if (command === 'verify-artifacts') {
    assert.equal(process.env.GITHUB_REPOSITORY, 'GuDuYunChen/Local-Notepad')
    assert.ok(process.env.GITHUB_TOKEN, 'A read-only Actions token is required for metadata verification')
    const metadata = {}
    for (const which of ['previous', 'current']) {
      const source = pin[which + 'Source']
      const response = await fetch('https://api.github.com/repos/GuDuYunChen/Local-Notepad/actions/artifacts/' + source.artifact, {
        headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15000),
      })
      assert.equal(response.status, 200, 'Unable to read pinned artifact metadata: ' + which)
      const artifact = await response.json(); validateReadingArtifact(pin, which, artifact)
      metadata[which] = artifact
    }
    mkdirSync(out, { recursive: true })
    writeFileSync(path.join(out, 'reading-artifact-source.json'), JSON.stringify({ productCommit: pin.product,
      verifierCommit: process.env.GITHUB_SHA, exactArtifactMetadataVerified: true, metadata }, null, 2), { flag: 'wx' })
  } else if (command === 'prepare') {
    assertHostedWindows(process.env, process.platform)
    const metadata = JSON.parse(readFileSync(path.join(out, 'reading-artifact-source.json'), 'utf8'))
    assert.equal(metadata.productCommit, pin.product); assert.equal(metadata.verifierCommit, process.env.GITHUB_SHA)
    assert.equal(metadata.exactArtifactMetadataVerified, true)
    for (const which of ['previous', 'current']) validateReadingArtifact(pin, which, metadata.metadata[which])
    const inherited = prepareShortcutManagementVerifierSources(pin, name => readFileSync(new URL('./' + name, import.meta.url), 'utf8'))
    const generated = prepareLocalExportVerifierSources(pin, name => readFileSync(new URL('./' + name, import.meta.url), 'utf8'))
    assert.equal(generated.length, inherited.length)
    for (const [index, item] of inherited.entries()) assert.equal(generated[index].original, item.original)
    mkdirSync(out, { recursive: true })
    for (const item of generated) {
      writeFileSync(new URL('./' + item.output, import.meta.url), item.pinned, { flag: 'wx' })
      writeFileSync(path.join(out, item.output + '.before.txt'), item.original, { flag: 'wx' })
      writeFileSync(path.join(out, item.output + '.pinned.txt'), item.pinned, { flag: 'wx' })
    }
    writeFileSync(path.join(out, 'reading-generated-verifier-source.json'), JSON.stringify({ productCommit: pin.product,
      verifierCommit: process.env.GITHUB_SHA, productionModified: false,
      generated: generated.map(item => ({ source: item.source, output: item.output,
        original: blob(item.original), pinned: blob(item.pinned), inverseBytesEqual: true,
        ...(item.productPin ? { productSource: blob(item.productSource), targetProductSourceMatches: true } : {}) })),
    }, null, 2), { flag: 'wx' })
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./pin-reading-import-generated.mjs', import.meta.url))], { stdio: 'inherit' })
    assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.status, 0, 'Original exact-binary pin validation failed')
    await buildReadingModeFixture()
  } else throw Error('Expected outputs, verify-artifacts or prepare')
}

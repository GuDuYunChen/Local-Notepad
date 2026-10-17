const crypto = require('node:crypto')
const scenarios = Object.freeze(['light', 'dark', 'narrow', 'changed', 'unavailable'])
function validateEvidence(report, commit, readImage) {
  if (!/^[a-f0-9]{40}$/.test(commit) || report?.commit !== commit || report.complete !== true || report.platform !== 'win32' ||
      report.realComponents !== true || report.syntheticRecords !== true || report.backendExercised !== false ||
      report.manualSelection !== true || report.clipboardFailureHandled !== true || !Array.isArray(report.scenes) || report.scenes.length !== scenarios.length) throw new Error('Incomplete diagnostic evidence')
  for (const [i, name] of scenarios.entries()) {
    const scene = report.scenes[i]
    if (scene?.name !== name || scene.ready !== true || scene.networkCalls !== 0 || scene.privateLeak !== false ||
        !Number.isFinite(scene.overflow) || scene.overflow > 1 || !Number.isFinite(scene.textOverflow) || scene.textOverflow > 1 ||
        scene.previewChars < 100 || scene.previewChars > 8192 || scene.areaVisible !== true ||
        !Array.isArray(scene.ratios) || scene.ratios.length < 3 || scene.ratios.some(n => !Number.isFinite(n) || n < 4.5)) throw new Error('Invalid diagnostic scene: ' + name)
    const image = readImage(name + '.png')
    if (!Buffer.isBuffer(image) || image.length < 100 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        image.readUInt32BE(16) !== scene.width || image.readUInt32BE(20) !== scene.height ||
        crypto.createHash('sha256').update(image).digest('hex') !== scene.sha256) throw new Error('Invalid diagnostic image: ' + name)
  }
  return true
}
module.exports = { scenarios, validateEvidence }

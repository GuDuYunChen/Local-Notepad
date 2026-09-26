// Accept only consecutive, identical, visibly correct frames. Other regions of
// the page may still animate; their lifecycle is not this widget's screenshot.
const expected = ['local', 'remote'].flatMap(kind =>
  ['pre', '.sync-diff-line-meta strong', '.sync-diff-line-meta span'].map(selector => [kind, selector]))
const textIDs = ['heading', 'position', 'local-column', 'remote-column', 'text-column', 'summary', 'description', 'range', 'source']
const rgb = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
const finite = value => typeof value === 'number' && Number.isFinite(value)

function createDiffFrameGate() {
  let previous = '', samples = 0
  return Object.freeze({ observe(frame) {
    const bounds = frame?.bounds, viewport = frame?.viewport
    const valid = frame?.themeColorsReady === true && frame.visible === true &&
      frame.writes === 0 && frame.activeContent === 0 && Number.isInteger(frame.rows) && frame.rows >= 2 && frame.rows <= 64 &&
      finite(frame.bodyOverflow) && frame.bodyOverflow <= 1 && finite(frame.tableOverflow) && frame.tableOverflow <= 1 &&
      viewport && finite(viewport.width) && viewport.width > 0 && finite(viewport.height) && viewport.height > 0 &&
      bounds && ['top', 'bottom', 'left', 'right'].every(key => finite(bounds[key])) &&
      bounds.top >= 0 && bounds.bottom > bounds.top && bounds.bottom <= viewport.height &&
      bounds.left >= 0 && bounds.right > bounds.left && bounds.right <= viewport.width &&
      Array.isArray(frame.colors) && frame.colors.length === expected.length && frame.colors.every((color, i) =>
        color?.kind === expected[i][0] && color.selector === expected[i][1] &&
        color.finalForeground === true && color.finalBackground === true && rgb(color.foreground) && rgb(color.background) &&
        finite(color.ratio) && color.ratio >= 4.5) &&
      Array.isArray(frame.textChecks) && frame.textChecks.length === textIDs.length && frame.textChecks.every((text, i) =>
        text?.id === textIDs[i] && text.finalForeground === true && rgb(text.foreground) && rgb(text.background) &&
        finite(text.ratio) && text.ratio >= 4.5)
    if (!valid) { previous = ''; samples = 0; return Object.freeze({ ready: false, samples }) }
    const signature = JSON.stringify({ bounds, viewport, rows: frame.rows,
      bodyOverflow: frame.bodyOverflow, tableOverflow: frame.tableOverflow, colors: frame.colors, textChecks: frame.textChecks })
    samples = signature === previous ? samples + 1 : 1
    previous = signature
    return Object.freeze({ ready: samples >= 3, samples })
  } })
}
module.exports = { createDiffFrameGate }

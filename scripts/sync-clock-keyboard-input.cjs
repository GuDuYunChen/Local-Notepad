// Native test input only. Electron keyDown/keyUp do not synthesize the char
// phase used by Chromium's Enter activation. Never substitute a DOM click.
function clockKeyboardEvents(key, shift = false) {
  if (!['Tab', 'Return', 'Space'].includes(key) || typeof shift !== 'boolean') throw new TypeError('Unsupported test key')
  const modifiers = shift ? ['shift'] : []
  const events = [{ type: 'keyDown', keyCode: key, modifiers }]
  if (key !== 'Tab') events.push({ type: 'char', keyCode: key === 'Return' ? '\r' : ' ', modifiers })
  events.push({ type: 'keyUp', keyCode: key, modifiers })
  return events
}
module.exports = { clockKeyboardEvents }

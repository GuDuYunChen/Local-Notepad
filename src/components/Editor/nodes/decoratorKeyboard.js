// Native keyboard entry to a Lexical decorator without changing text indentation.
// A genuine F6 from the owning editor root enters the first enabled action of
// this decorator type. Tab/Shift+Tab inside its controls remains browser-owned.
export function bindDecoratorKeyboardAccess(block, selector, isEditable, preserveEmptySelection) {
  const root = block?.closest('.editor-input[contenteditable="true"]');
  if (!root) return () => {};
  const doc = root.ownerDocument;
  const owns = () => root.isConnected && block.isConnected &&
    block.closest('.editor-input[contenteditable="true"]') === root &&
    root.getAttribute('contenteditable') === 'true' &&
    (typeof isEditable !== 'function' || isEditable());
  const composing = event => event.isComposing || event.keyCode === 229 || event.which === 229;
  const firstAction = () => [...root.querySelectorAll(selector)].find(node =>
    node.isConnected && !node.disabled && node.tabIndex >= 0 &&
    node.closest('.editor-input[contenteditable="true"]') === root);
  const ownsPoint = (node, offset) => node?.isConnected && node.ownerDocument === doc &&
    (node.nodeType === 1 || node.nodeType === 3) && root.contains(node) &&
    (node.nodeType === 1 ? node : node.parentElement)?.closest('.editor-input[contenteditable="true"]') === root &&
    Number.isInteger(offset) && offset >= 0 &&
    offset <= (node.nodeType === 3 ? node.data.length : node.childNodes.length);
  const readRange = selection => selection === doc.getSelection() && selection?.rangeCount === 1 ? {
    range: selection.getRangeAt(0), anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
  } : null;
  const sameRange = (a, b) => a && b && a.range === b.range &&
    a.anchorNode === b.anchorNode && a.anchorOffset === b.anchorOffset &&
    a.focusNode === b.focusNode && a.focusOffset === b.focusOffset;
  const enter = event => {
    if (!owns() || event.defaultPrevented || event.key !== 'F6' || event.altKey ||
        event.ctrlKey || event.metaKey || event.shiftKey || composing(event) ||
        event.target !== root || doc.activeElement !== root) return;
    const target = firstAction();
    if (!target || !block.contains(target)) return;
    const selection = doc.getSelection();
    const emptySelection = selection?.rangeCount === 0;
    const original = readRange(selection);
    const hasOwnedRange = original && ownsPoint(original.anchorNode, original.anchorOffset) &&
      ownsPoint(original.focusNode, original.focusOffset);
    const stillOwns = () => owns() && target.isConnected && !target.disabled &&
      target.tabIndex >= 0 && firstAction() === target && doc.activeElement === target &&
      selection === doc.getSelection();
    let focusCount = 0, focusInCount = 0, focusRange = null, unchangedDuringFocus = false;
    const onFocus = e => {
      if (e.target !== target) return;
      focusCount++;
      focusRange = readRange(selection);
      unchangedDuringFocus = focusCount === 1 && focusInCount === 0 &&
        stillOwns() && sameRange(focusRange, original);
    };
    const onFocusIn = e => {
      if (e.target !== target) return;
      focusInCount++;
      unchangedDuringFocus = unchangedDuringFocus && focusCount === 1 && focusInCount === 1 &&
        stillOwns() && sameRange(readRange(selection), focusRange);
    };
    const win = doc.defaultView;
    if (hasOwnedRange && win) {
      doc.addEventListener('focus', onFocus, true);
      win.addEventListener('focusin', onFocusIn);
    }
    try { target.focus(); }
    finally {
      if (hasOwnedRange && win) {
        doc.removeEventListener('focus', onFocus, true);
        win.removeEventListener('focusin', onFocusIn);
      }
    }
    if (!stillOwns()) return;
    const after = readRange(selection);
    if (hasOwnedRange && focusCount === 1 && focusInCount === 1 && unchangedDuringFocus &&
        ownsPoint(original.anchorNode, original.anchorOffset) &&
        ownsPoint(original.focusNode, original.focusOffset) &&
        after?.anchorNode === target && after.anchorOffset === 0 &&
        after.focusNode === target && after.focusOffset === 0 &&
        typeof selection.setBaseAndExtent === 'function') {
      selection.setBaseAndExtent(original.anchorNode, original.anchorOffset,
        original.focusNode, original.focusOffset);
    }
    if (emptySelection && selection === doc.getSelection() && selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
    if (emptySelection && stillOwns() && selection.rangeCount === 0 &&
        typeof preserveEmptySelection === 'function') preserveEmptySelection();
    event.preventDefault();
    event.stopPropagation();
  };
  const keepNativeTab = event => {
    if (!owns() || event.key !== 'Tab' || event.defaultPrevented || composing(event) ||
        event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (target?.isConnected && target.tabIndex >= 0 && doc.activeElement === target &&
        block.contains(target) && /^(BUTTON|INPUT|TEXTAREA)$/.test(target.tagName)) {
      // Never cancel the native key: only prevent Lexical's outer indent handler.
      event.stopPropagation();
    }
  };
  root.addEventListener('keydown', enter);
  block.addEventListener('keydown', keepNativeTab);
  return () => {
    root.removeEventListener('keydown', enter);
    block.removeEventListener('keydown', keepNativeTab);
  };
}

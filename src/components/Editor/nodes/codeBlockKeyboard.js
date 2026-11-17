// Keyboard access to the genuine code-language button inside a Lexical
// decorator. Ordinary Tab still belongs to Lexical indentation when its root
// is focused; F6 is a guarded entrance, matching existing embedded blocks.
export function bindCodeBlockKeyboardAccess(block, isEditable, preserveEmptySelection) {
  const root = block?.closest('.editor-input[contenteditable]');
  const header = block?.querySelector(':scope > .code-block-header');
  if (!root || !header) return () => {};

  const ownsHeader = () => root.isConnected && block.isConnected && header.isConnected &&
    block.closest('.editor-input[contenteditable]') === root &&
    block.querySelector(':scope > .code-block-header') === header;
  const composing = event => event.isComposing || event.keyCode === 229 || event.which === 229;

  const enter = event => {
    if (!ownsHeader() || root.getAttribute('contenteditable') !== 'true' ||
        (typeof isEditable === 'function' && !isEditable()) ||
        event.defaultPrevented || event.key !== 'F6' || event.altKey ||
        event.ctrlKey || event.metaKey || event.shiftKey || composing(event) ||
        event.target !== root || root.ownerDocument.activeElement !== root) return;
    // Multiple code blocks must not compete for the same F6 key event.
    const first = [...root.querySelectorAll('.code-block-wrapper > .code-block-header button.language-selector-button:not(:disabled)')]
      .find(button => button.isConnected && button.tabIndex >= 0 &&
        button.closest('.editor-input[contenteditable]') === root);
    if (!first || first.closest('.code-block-header') !== header) return;
    const ownerDocument = root.ownerDocument;
    const selection = ownerDocument.getSelection();
    const emptySelection = selection?.rangeCount === 0;
    const readRange = () => selection === ownerDocument.getSelection() && selection?.rangeCount === 1 ? {
      range: selection.getRangeAt(0),
      anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode, focusOffset: selection.focusOffset,
    } : null;
    const ownsPoint = (node, offset) => node?.isConnected && node.ownerDocument === ownerDocument &&
      (node.nodeType === 1 || node.nodeType === 3) && root.contains(node) &&
      (node.nodeType === 1 ? node : node.parentElement)?.closest('.editor-input[contenteditable]') === root &&
      Number.isInteger(offset) && offset >= 0 && offset <= (node.nodeType === 3 ? node.data.length : node.childNodes.length);
    const originalRange = readRange();
    const preserveRange = originalRange && ownsPoint(originalRange.anchorNode, originalRange.anchorOffset) &&
      ownsPoint(originalRange.focusNode, originalRange.focusOffset);
    const sameRange = (left, right) => left && right && left.range === right.range &&
      left.anchorNode === right.anchorNode && left.anchorOffset === right.anchorOffset &&
      left.focusNode === right.focusNode && left.focusOffset === right.focusOffset;
    const buttonRange = value => value && value.anchorNode === first && value.anchorOffset === 0 &&
      value.focusNode === first && value.focusOffset === 0;
    const ownsFocusedControl = () => root.ownerDocument === ownerDocument && first.ownerDocument === ownerDocument &&
      ownsHeader() && first.isConnected && !first.disabled && first.tabIndex >= 0 &&
      first.closest('.code-block-header') === header && first.closest('.editor-input[contenteditable]') === root &&
      root.getAttribute('contenteditable') === 'true' && (typeof isEditable !== 'function' || isEditable()) &&
      selection === ownerDocument.getSelection() && ownerDocument.activeElement === first;
    let focusEvents = 0, focusInEvents = 0, focusRange = null, unchangedDuringFocus = false;
    const inspectFocus = focusEvent => {
      if (focusEvent.target !== first) return;
      focusEvents += 1;
      focusRange = readRange();
      unchangedDuringFocus = focusEvents === 1 && focusInEvents === 0 && ownsFocusedControl() &&
        sameRange(focusRange, originalRange);
    };
    const inspectFocusIn = focusEvent => {
      if (focusEvent.target !== first) return;
      focusInEvents += 1;
      unchangedDuringFocus = unchangedDuringFocus && focusEvents === 1 && focusInEvents === 1 &&
        ownsFocusedControl() && sameRange(readRange(), focusRange);
    };
    const ownerWindow = ownerDocument.defaultView;
    if (preserveRange && ownerWindow) {
      // Observe existing focus handlers without replacing focus or Selection.
      // A missing event or an observed new range gives those handlers priority.
      ownerDocument.addEventListener('focus', inspectFocus, true);
      ownerWindow.addEventListener('focusin', inspectFocusIn);
    }
    try { first.focus(); }
    finally {
      if (preserveRange && ownerWindow) {
        ownerDocument.removeEventListener('focus', inspectFocus, true);
        ownerWindow.removeEventListener('focusin', inspectFocusIn);
      }
    }
    if (root.ownerDocument.activeElement !== first) return;
    // Some focus implementations collapse selection onto the button after
    // focus/focusin. Restore only that exact automatic range, with direction,
    // while all original owners and endpoints still hold. No Lexical tag is
    // needed: the subsequent selectionchange reads these restored DOM points.
    if (preserveRange && focusEvents === 1 && focusInEvents === 1 && unchangedDuringFocus &&
        ownsFocusedControl() && ownsPoint(originalRange.anchorNode, originalRange.anchorOffset) &&
        ownsPoint(originalRange.focusNode, originalRange.focusOffset) && buttonRange(readRange()) &&
        typeof selection.setBaseAndExtent === 'function') {
      selection.setBaseAndExtent(originalRange.anchorNode, originalRange.anchorOffset,
        originalRange.focusNode, originalRange.focusOffset);
    }
    // Focusing a control inside contenteditable can create a DOM caret. An F6
    // focus-only entrance must also retain an originally empty selection.
    if (emptySelection && selection === root.ownerDocument.getSelection() && selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
    // A pending Lexical selection update can otherwise recreate the caret
    // after this synchronous focus-only entrance. Only the successful owned
    // empty-selection path may opt this one update out of DOM selection sync.
    if (emptySelection && root.ownerDocument === ownerDocument && first.ownerDocument === ownerDocument &&
        selection === ownerDocument.getSelection() && selection.rangeCount === 0 &&
        ownsHeader() && first.isConnected && !first.disabled && first.tabIndex >= 0 && first.closest('.code-block-header') === header &&
        first.closest('.editor-input[contenteditable]') === root && ownerDocument.activeElement === first &&
        typeof preserveEmptySelection === 'function') {
      preserveEmptySelection();
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const preserveNativeTab = event => {
    if (!ownsHeader() || event.key !== 'Tab' || event.defaultPrevented || composing(event) ||
        event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (target?.tagName === 'BUTTON' && target.isConnected && !target.disabled &&
        root.ownerDocument.activeElement === target &&
        target.closest('.code-block-header') === header &&
        target.closest('.editor-input[contenteditable]') === root) {
      // Allow browser Tab/Shift+Tab on controls without Lexical reindenting.
      event.stopPropagation();
    }
  };
  // Existing attachment, Todo and embed capture entries keep their priority.
  root.addEventListener('keydown', enter);
  header.addEventListener('keydown', preserveNativeTab);
  return () => {
    root.removeEventListener('keydown', enter);
    header.removeEventListener('keydown', preserveNativeTab);
  };
}

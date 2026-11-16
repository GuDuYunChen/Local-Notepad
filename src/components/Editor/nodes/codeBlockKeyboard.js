// Keyboard access to the genuine code-language button inside a Lexical
// decorator. Ordinary Tab still belongs to Lexical indentation when its root
// is focused; F6 is a guarded entrance, matching existing embedded blocks.
export function bindCodeBlockKeyboardAccess(block, isEditable) {
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
    first.focus();
    if (root.ownerDocument.activeElement !== first) return;
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

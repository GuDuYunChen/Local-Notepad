// Keyboard access to the genuine code-language button inside a Lexical
// decorator. Ordinary Tab still belongs to Lexical indentation when its root
// is focused; F6 is a guarded entrance, matching existing embedded blocks.
export function bindCodeBlockKeyboardAccess(block) {
  const root = block?.closest('.editor-input[contenteditable]');
  if (!root) return () => {};

  const enter = event => {
    if (root.getAttribute('contenteditable') !== 'true' ||
        event.defaultPrevented || event.key !== 'F6' || event.altKey ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing ||
        event.target !== root || root.ownerDocument.activeElement !== root) return;
    // Multiple code blocks must not compete for the same F6 key event.
    const first = root.querySelector('.code-block-header .language-selector-button:not(:disabled)');
    if (!first || !block.contains(first) || !first.isConnected) return;
    first.focus();
    if (root.ownerDocument.activeElement !== first) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const preserveNativeTab = event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.isComposing) return;
    if ([...block.querySelectorAll('button')].includes(event.target)) {
      // Allow browser Tab/Shift+Tab on controls without Lexical reindenting.
      event.stopPropagation();
    }
  };
  root.addEventListener('keydown', enter, true);
  block.addEventListener('keydown', preserveNativeTab);
  return () => {
    root.removeEventListener('keydown', enter, true);
    block.removeEventListener('keydown', preserveNativeTab);
  };
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bindCodeBlockKeyboardAccess } from './codeBlockKeyboard';

const mounts = [];
afterEach(() => { mounts.splice(0).forEach(stop => stop()); document.body.replaceChildren(); });

function setup({ editable = true, disabled = false, two = false } = {}) {
  const root = document.createElement('div');
  root.className = 'editor-input';
  root.setAttribute('contenteditable', editable ? 'true' : 'false');
  root.tabIndex = 0;
  root.innerHTML = `<div class="code-block-wrapper"><div class="code-block-header"><button type="button" class="language-selector-button" ${disabled ? 'disabled' : ''}>JavaScript</button><button type="button" class="code-wrap">自动换行</button></div></div>${two ? '<div class="code-block-wrapper"><div class="code-block-header"><button type="button" class="language-selector-button">Python</button></div></div>' : ''}`;
  document.body.appendChild(root);
  const blocks = [...root.querySelectorAll('.code-block-wrapper')];
  mounts.push(...blocks.map(bindCodeBlockKeyboardAccess));
  return { root, blocks, buttons: [...root.querySelectorAll('.language-selector-button')] };
}
function key(node, key, options = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  node.dispatchEvent(event);
  return event;
}

describe('real code decorator keyboard ownership', () => {
  it('enters the first enabled language button using unmodified F6 from the editable root', () => {
    const { root, buttons } = setup();
    root.focus();
    const event = key(root, 'F6');
    expect(document.activeElement).toBe(buttons[0]);
    expect(event.defaultPrevented).toBe(true);
  });
  it('preserves normal native Tab propagation at the language button without changing its default', () => {
    const { root, buttons } = setup();
    let escapedToLexical = 0;
    root.addEventListener('keydown', () => escapedToLexical++);
    buttons[0].focus();
    const forward = key(buttons[0], 'Tab');
    const reverse = key(buttons[0], 'Tab', { shiftKey: true });
    expect(forward.defaultPrevented).toBe(false);
    expect(reverse.defaultPrevented).toBe(false);
    expect(escapedToLexical).toBe(0);
  });
  it('does not modify plain Tab indentation from the Lexical root', () => {
    const { root } = setup();
    let seen = 0;
    root.addEventListener('keydown', () => seen++);
    root.focus();
    const tab = key(root, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(seen).toBe(1);
    expect(document.activeElement).toBe(root);
  });
  it('refuses modifiers, IME, a nested event target and an already handled F6', () => {
    const { root, buttons } = setup();
    root.focus();
    for (const options of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]) {
      expect(key(root, 'F6', options).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(root);
    }
    expect(key(buttons[0], 'F6').defaultPrevented).toBe(false);
    const handled = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
    handled.preventDefault();
    root.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root);
  });
  it('respects live reading/editing mode changes and disabled controls', () => {
    const { root, buttons } = setup({ editable: false, disabled: true });
    root.focus();
    expect(key(root, 'F6').defaultPrevented).toBe(false);
    root.setAttribute('contenteditable', 'true');
    expect(key(root, 'F6').defaultPrevented).toBe(false);
    buttons[0].disabled = false;
    expect(key(root, 'F6').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });
  it('only the first code block owns F6; unmount removes keyboard capture', () => {
    const { root, buttons } = setup({ two: true });
    root.focus();
    expect(key(root, 'F6').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    mounts.splice(0).forEach(stop => stop());
    root.focus();
    expect(key(root, 'F6').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(root);
  });
  it('refuses detached and foreign-owner controls', () => {
    const { root, buttons, blocks } = setup({ two: true });
    blocks[0].remove();
    root.focus();
    expect(key(root, 'F6').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].remove();
    root.focus();
    expect(key(root, 'F6').defaultPrevented).toBe(false);
  });
});

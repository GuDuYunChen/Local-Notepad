// Vitest setup file
import { beforeAll } from 'vitest';

// Setup jsdom environment
beforeAll(() => {
  // Ensure global is defined for jsdom
  if (typeof global !== 'undefined') {
    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
  }
  
  // Fix for webidl-conversions issue with jsdom
  // This is needed to prevent "Cannot read properties of undefined (reading 'get')" error
  if (typeof globalThis !== 'undefined' && !globalThis.WeakMap) {
    globalThis.WeakMap = WeakMap;
  }
  if (typeof globalThis !== 'undefined' && !globalThis.Map) {
    globalThis.Map = Map;
  }
  if (typeof globalThis !== 'undefined' && !globalThis.Set) {
    globalThis.Set = Set;
  }
});

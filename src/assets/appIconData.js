// One shared PNG master for the renderer, Electron and installer asset generation.
// Encoded source SHA-256: 033c433097ed7f5422209a14f127ca8f465de0f0a753b04a31cc0d28b85e771a.
import part1 from './brand/icon-source-1.js'
import part2 from './brand/icon-source-2.js'
import part3 from './brand/icon-source-3.js'
import part4 from './brand/icon-source-4.js'
import part5 from './brand/icon-source-5.js'
import part6 from './brand/icon-source-6.js'
import part7 from './brand/icon-source-7.js'

export const APP_ICON_DATA_URL = 'data:image/png;base64,' + [part1, part2, part3, part4, part5, part6, part7].join('')

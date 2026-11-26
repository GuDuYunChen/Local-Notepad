// The existing renderer import budget also applies to toolbar Excel tables.
// Validate before expanding a worksheet or allocating Lexical nodes.
export const TABLE_IMPORT_LIMITS = Object.freeze({
  cells: 4000,
  nodes: 20000,
  lines: 10000,
  contentBytes: 2 * 1024 * 1024,
})

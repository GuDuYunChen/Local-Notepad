export function makePlan(items = [{ id: 'note-a', action: 'upload' }]) {
  const counts = { uploads: 0, downloads: 0, conflicts: 0, noops: 0 }
  const fields = { upload: 'uploads', download: 'downloads', conflict: 'conflicts', noop: 'noops' }
  for (const item of items) if (Object.hasOwn(fields, item.action)) counts[fields[item.action]]++
  return { ...counts, needs_init: false, generation: 3, store_id: 'test-store', revision: 'test-revision',
    items: items.map(item => ({ base_hash: '', local_hash: '', remote_hash: '', ...item })) }
}
export function manyPlan(size = 65) {
  return makePlan(Array.from({ length: size }, (_, i) => ({ id: 'note-' + String(i + 1).padStart(3, '0'), action: 'upload' })))
}

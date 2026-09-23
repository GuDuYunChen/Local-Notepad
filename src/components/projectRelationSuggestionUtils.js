import { collectWikiReferences } from './Editor/utils/referenceUtils'
import { buildProjectRelationGraph } from './projectRelationsUtils'

function normalizeId(value) {
  return String(value || '').trim()
}

function pairSignature(left, right) {
  return [normalizeId(left), normalizeId(right)]
    .filter(Boolean)
    .sort()
    .join('::')
}

function manuscriptCatalog(workspace) {
  const chapters = []
  let ordinal = 0
  for (const volume of workspace?.volumes || []) {
    for (const note of volume.notes || []) {
      ordinal += 1
      chapters.push({
        id: normalizeId(note.id),
        title: note.title || '未命名',
        content: note.content || '',
        ordinal,
        volumeId: normalizeId(volume.id),
        volumeTitle: volume.title || '',
      })
    }
  }
  return chapters
}

export function getProjectRelationSuggestionSignature(leftId, rightId) {
  return pairSignature(leftId, rightId)
}

export function buildProjectRelationSuggestions(
  workspace,
  projectIndexes = {},
  projectMeta = {},
  options = {},
) {
  const graph = buildProjectRelationGraph(projectIndexes, projectMeta)
  const minChapters = Math.max(1, Number(options.minChapters) || 2)
  const ignored = new Set(
    Array.isArray(projectMeta?.relationSuggestionIgnores)
      ? projectMeta.relationSuggestionIgnores.map(String)
      : []
  )

  const noteIdToNode = new Map(
    graph.nodes
      .filter(node => normalizeId(node.noteId))
      .map(node => [normalizeId(node.noteId), node])
  )
  const existingPairs = new Set(
    graph.edges.map(edge => pairSignature(edge.sourceId, edge.targetId))
  )
  const chapters = manuscriptCatalog(workspace)
  const candidates = new Map()
  let totalWikiReferences = 0
  let recognizedReferences = 0
  let chaptersWithEntityReferences = 0
  let chaptersWithCooccurrence = 0

  for (const chapter of chapters) {
    const references = collectWikiReferences(chapter.content)
    totalWikiReferences += references.length

    const entityRefs = new Map()
    for (const reference of references) {
      const node = noteIdToNode.get(normalizeId(reference.id))
      if (!node) continue
      recognizedReferences += 1

      const existing = entityRefs.get(node.id) || {
        node,
        references: [],
      }
      existing.references.push(reference)
      entityRefs.set(node.id, existing)
    }

    const entities = [...entityRefs.values()]
    if (entities.length > 0) chaptersWithEntityReferences += 1
    if (entities.length < 2) continue
    chaptersWithCooccurrence += 1

    for (let leftIndex = 0; leftIndex < entities.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < entities.length;
        rightIndex += 1
      ) {
        const left = entities[leftIndex]
        const right = entities[rightIndex]
        const signature = pairSignature(left.node.id, right.node.id)
        if (!signature || existingPairs.has(signature) || ignored.has(signature)) {
          continue
        }

        const existing = candidates.get(signature) || {
          id: 'suggestion:' + signature,
          signature,
          source: left.node,
          target: right.node,
          evidence: [],
        }

        existing.evidence.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          ordinal: chapter.ordinal,
          volumeId: chapter.volumeId,
          volumeTitle: chapter.volumeTitle,
          sourceSections: [...new Set(
            left.references
              .flatMap(item => item.sourceSectionPath || [])
              .filter(Boolean)
          )],
          targetSections: [...new Set(
            right.references
              .flatMap(item => item.sourceSectionPath || [])
              .filter(Boolean)
          )],
        })
        candidates.set(signature, existing)
      }
    }
  }

  const suggestions = [...candidates.values()]
    .map(candidate => {
      const evidence = candidate.evidence.sort((a, b) => a.ordinal - b.ordinal)
      const first = evidence[0] || null
      const last = evidence[evidence.length - 1] || null
      const volumeCount = new Set(
        evidence.map(item => item.volumeId || '__ungrouped__')
      ).size

      return {
        ...candidate,
        chapterCount: evidence.length,
        volumeCount,
        firstOrdinal: first?.ordinal || 0,
        lastOrdinal: last?.ordinal || 0,
        span: first && last
          ? Math.max(1, last.ordinal - first.ordinal + 1)
          : 0,
        coveragePercent: chapters.length
          ? Math.round((evidence.length / chapters.length) * 100)
          : 0,
        repeatedAcrossVolumes: volumeCount > 1,
      }
    })
    .filter(candidate => candidate.chapterCount >= minChapters)
    .sort((a, b) => (
      b.chapterCount - a.chapterCount ||
      b.volumeCount - a.volumeCount ||
      a.firstOrdinal - b.firstOrdinal ||
      a.source.label.localeCompare(b.source.label, 'zh-CN')
    ))

  return {
    graph,
    chapters,
    suggestions,
    stats: {
      chapters: chapters.length,
      totalWikiReferences,
      recognizedReferences,
      chaptersWithEntityReferences,
      chaptersWithCooccurrence,
      candidateCount: suggestions.length,
      ignoredCount: ignored.size,
      minChapters,
    },
  }
}

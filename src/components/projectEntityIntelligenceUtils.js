import { collectWikiReferences } from './Editor/utils/referenceUtils'
import { buildProjectRelationGraph } from './projectRelationsUtils'
import {
  buildEntityTermIndex,
  collectProjectPlainText,
  normalizeProjectEntityAliases,
  scanProjectEntityMentions,
} from './projectEntityMentionUtils'

export { normalizeProjectEntityAliases } from './projectEntityMentionUtils'

const SOURCE_WEIGHT = {
  wiki: 100,
  canonical: 84,
  alias: 70,
}

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

function classifyConfidence(score) {
  if (score >= 90) {
    return {
      id: 'high',
      label: '高置信',
      description: '包含明确 WikiLink 或多章重复的强证据',
    }
  }
  if (score >= 76) {
    return {
      id: 'medium',
      label: '中置信',
      description: '主要来自实体原名或已确认别名的重复共现',
    }
  }
  return {
    id: 'exploratory',
    label: '探索',
    description: '证据较弱，仅建议人工核对，不应自动建立关系',
  }
}

function pairEvidenceScore(left, right) {
  const leftWeight = SOURCE_WEIGHT[left.bestSource] || 0
  const rightWeight = SOURCE_WEIGHT[right.bestSource] || 0
  if (left.bestSource === 'wiki' && right.bestSource === 'wiki') return 100
  if (left.bestSource === 'wiki' || right.bestSource === 'wiki') {
    return Math.round((leftWeight + rightWeight) / 2 + 4)
  }
  return Math.round((leftWeight + rightWeight) / 2)
}

function strongestSource({ explicitCount, canonicalCount, aliasCount }) {
  if (explicitCount > 0) return 'wiki'
  if (canonicalCount > 0) return 'canonical'
  if (aliasCount > 0) return 'alias'
  return ''
}

function sourceLabel(source) {
  if (source === 'wiki') return 'WikiLink'
  if (source === 'canonical') return '原名'
  if (source === 'alias') return '别名'
  return '未知'
}

export function buildProjectEntityIntelligence(
  workspace,
  projectIndexes = {},
  projectMeta = {},
  options = {},
) {
  const graph = buildProjectRelationGraph(projectIndexes, projectMeta)
  const aliases = normalizeProjectEntityAliases(projectMeta?.entityAliases)
  const chapters = manuscriptCatalog(workspace)

  const termIndex = buildEntityTermIndex(graph.nodes, aliases)
  const { aliasConflicts, canonicalConflicts } = termIndex
  const minChapters = Math.max(1, Number(options.minChapters) || 2)
  const minConfidence = ['high', 'medium', 'exploratory'].includes(
    options.minConfidence,
  )
    ? options.minConfidence
    : 'exploratory'
  const threshold = {
    high: 90,
    medium: 76,
    exploratory: 0,
  }[minConfidence]

  const ignored = new Set(
    Array.isArray(projectMeta?.relationSuggestionIgnores)
      ? projectMeta.relationSuggestionIgnores.map(String)
      : []
  )
  const existingPairs = new Set(
    graph.edges.map(edge => pairSignature(edge.sourceId, edge.targetId))
  )
  const noteIdToNode = new Map(
    graph.nodes
      .filter(node => normalizeId(node.noteId))
      .map(node => [normalizeId(node.noteId), node])
  )

  const entityStats = new Map(
    graph.nodes.map(node => [
      node.id,
      {
        ...node,
        aliases: Object.hasOwn(aliases, node.id) ? aliases[node.id] : [],
        evidence: [],
        mentionCount: 0,
        chapterCount: 0,
        explicitChapters: 0,
        canonicalChapters: 0,
        aliasChapters: 0,
        volumeIds: new Set(),
        firstOrdinal: 0,
        lastOrdinal: 0,
      },
    ])
  )
  const chapterEntities = {}
  const candidates = new Map()
  let explicitWikiReferences = 0
  let recognizedWikiReferences = 0
  let plainTextMentions = 0
  let aliasMentions = 0
  let chaptersWithEntities = 0
  let chaptersWithCooccurrence = 0

  for (const chapter of chapters) {
    const wikiReferences = collectWikiReferences(chapter.content)
    explicitWikiReferences += wikiReferences.length
    const plainText = collectProjectPlainText(chapter.content)
    const textEvidence = scanProjectEntityMentions(plainText, termIndex)
    const evidenceByEntity = new Map()

    for (const reference of wikiReferences) {
      const node = noteIdToNode.get(normalizeId(reference.id))
      if (!node) continue
      recognizedWikiReferences += 1
      const evidence = evidenceByEntity.get(node.id) || {
        node,
        explicitCount: 0,
        canonicalCount: 0,
        aliasCount: 0,
        aliasesMatched: new Set(),
      }
      evidence.explicitCount += 1
      evidenceByEntity.set(node.id, evidence)
    }

    for (const node of graph.nodes) {
      const evidence = evidenceByEntity.get(node.id) || {
        node,
        explicitCount: 0,
        canonicalCount: 0,
        aliasCount: 0,
        aliasesMatched: new Set(),
      }

      const mentions = textEvidence.get(node.id)
      if (mentions) {
        evidence.canonicalCount += mentions.canonicalCount
        evidence.aliasCount += mentions.aliasCount
        plainTextMentions += mentions.canonicalCount
        aliasMentions += mentions.aliasCount
        evidence.aliasesMatched = mentions.aliasesMatched
      }

      if (
        evidence.explicitCount ||
        evidence.canonicalCount ||
        evidence.aliasCount
      ) {
        evidence.bestSource = strongestSource(evidence)
        evidenceByEntity.set(node.id, evidence)
      }
    }

    const chapterEvidence = [...evidenceByEntity.values()]
      .filter(item => item.bestSource)
      .map(item => ({
        ...item,
        aliasesMatched: [...item.aliasesMatched],
        sourceLabel: sourceLabel(item.bestSource),
      }))

    chapterEntities[chapter.id] = chapterEvidence
    if (chapterEvidence.length > 0) chaptersWithEntities += 1
    if (chapterEvidence.length >= 2) chaptersWithCooccurrence += 1

    for (const evidence of chapterEvidence) {
      const stats = entityStats.get(evidence.node.id)
      if (!stats) continue
      const mentions =
        evidence.explicitCount +
        evidence.canonicalCount +
        evidence.aliasCount
      stats.mentionCount += mentions
      stats.chapterCount += 1
      if (evidence.explicitCount > 0) stats.explicitChapters += 1
      if (evidence.canonicalCount > 0) stats.canonicalChapters += 1
      if (evidence.aliasCount > 0) stats.aliasChapters += 1
      if (chapter.volumeId) stats.volumeIds.add(chapter.volumeId)
      if (!stats.firstOrdinal) stats.firstOrdinal = chapter.ordinal
      stats.lastOrdinal = chapter.ordinal
      stats.evidence.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        ordinal: chapter.ordinal,
        volumeId: chapter.volumeId,
        volumeTitle: chapter.volumeTitle,
        bestSource: evidence.bestSource,
        sourceLabel: evidence.sourceLabel,
        mentionCount: mentions,
        aliasesMatched: evidence.aliasesMatched,
      })
    }

    for (let leftIndex = 0; leftIndex < chapterEvidence.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < chapterEvidence.length;
        rightIndex += 1
      ) {
        const left = chapterEvidence[leftIndex]
        const right = chapterEvidence[rightIndex]
        const signature = pairSignature(left.node.id, right.node.id)
        if (!signature || existingPairs.has(signature) || ignored.has(signature)) {
          continue
        }

        const current = candidates.get(signature) || {
          id: 'intelligence:' + signature,
          signature,
          source: left.node,
          target: right.node,
          evidence: [],
        }
        current.evidence.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          ordinal: chapter.ordinal,
          volumeId: chapter.volumeId,
          volumeTitle: chapter.volumeTitle,
          leftSource: left.bestSource,
          leftSourceLabel: left.sourceLabel,
          rightSource: right.bestSource,
          rightSourceLabel: right.sourceLabel,
          score: pairEvidenceScore(left, right),
          leftAliases: left.aliasesMatched,
          rightAliases: right.aliasesMatched,
        })
        candidates.set(signature, current)
      }
    }
  }

  const entities = [...entityStats.values()]
    .map(stats => ({
      ...stats,
      volumeCount: stats.volumeIds.size,
      volumeIds: [...stats.volumeIds],
      chapterCoveragePercent: chapters.length
        ? Math.round((stats.chapterCount / chapters.length) * 100)
        : 0,
    }))
    .sort((a, b) => (
      b.chapterCount - a.chapterCount ||
      b.mentionCount - a.mentionCount ||
      a.label.localeCompare(b.label, 'zh-CN')
    ))

  const suggestions = [...candidates.values()]
    .map(candidate => {
      const evidence = candidate.evidence.sort((a, b) => a.ordinal - b.ordinal)
      const chapterCount = evidence.length
      const volumeCount = new Set(
        evidence.map(item => item.volumeId || '__ungrouped__')
      ).size
      const average = chapterCount
        ? Math.round(
          evidence.reduce((sum, item) => sum + item.score, 0) / chapterCount
        )
        : 0
      const repetitionBonus = Math.min(9, Math.max(0, chapterCount - 2) * 3)
      const volumeBonus = volumeCount > 1 ? 4 : 0
      const confidenceScore = Math.min(100, average + repetitionBonus + volumeBonus)
      const confidence = classifyConfidence(confidenceScore)
      const sources = [...new Set(
        evidence.flatMap(item => [item.leftSource, item.rightSource])
      )]

      return {
        ...candidate,
        evidence,
        chapterCount,
        volumeCount,
        confidenceScore,
        confidence,
        sources,
        sourceLabels: sources.map(sourceLabel),
        coveragePercent: chapters.length
          ? Math.round((chapterCount / chapters.length) * 100)
          : 0,
        repeatedAcrossVolumes: volumeCount > 1,
        firstOrdinal: evidence[0]?.ordinal || 0,
        lastOrdinal: evidence[evidence.length - 1]?.ordinal || 0,
      }
    })
    .filter(candidate => (
      candidate.chapterCount >= minChapters &&
      candidate.confidenceScore >= threshold
    ))
    .sort((a, b) => (
      b.confidenceScore - a.confidenceScore ||
      b.chapterCount - a.chapterCount ||
      b.volumeCount - a.volumeCount ||
      a.firstOrdinal - b.firstOrdinal
    ))

  return {
    graph,
    chapters,
    entities,
    entityById: new Map(entities.map(entity => [entity.id, entity])),
    chapterEntities,
    suggestions,
    aliasConflicts,
    canonicalConflicts,
    stats: {
      chapters: chapters.length,
      entities: graph.nodes.length,
      activeEntities: entities.filter(entity => entity.chapterCount > 0).length,
      explicitWikiReferences,
      recognizedWikiReferences,
      plainTextMentions,
      aliasMentions,
      aliasConflictCount: aliasConflicts.length,
      canonicalConflictCount: canonicalConflicts.length,
      chaptersWithEntities,
      chaptersWithCooccurrence,
      candidateCount: suggestions.length,
      ignoredCount: ignored.size,
      minChapters,
      minConfidence,
    },
  }
}

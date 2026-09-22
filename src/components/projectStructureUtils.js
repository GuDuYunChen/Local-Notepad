import {
  getProjectChapterSummary,
  getProjectLabels,
  getProjectVolumeProgress,
} from './projectWorkspaceUtils'

function idSet(items) {
  return new Set(
    (Array.isArray(items) ? items : [])
      .map(item => String(item?.id || ''))
      .filter(Boolean)
  )
}

function median(values) {
  const sorted = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  if (!sorted.length) return 0
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function wordBand(wordCount, chapterTargetWords, medianWords, sampleSize) {
  const words = Math.max(0, Number(wordCount) || 0)
  const target = Math.max(0, Number(chapterTargetWords) || 0)

  if (!words) return 'empty'
  if (target > 0) {
    if (words < target * 0.6) return 'under'
    if (words > target * 1.5) return 'over'
    return 'normal'
  }

  if (sampleSize >= 4 && medianWords > 0) {
    if (words < medianWords * 0.5) return 'under'
    if (words > medianWords * 1.75) return 'over'
  }
  return 'normal'
}

export function buildProjectStoryMap(
  workspace,
  projectMeta = {},
  projectIndexes = {},
) {
  const labels = getProjectLabels(workspace?.project?.type || projectMeta.type)
  const volumes = workspace?.volumes || []
  const allNotes = volumes.flatMap(volume => volume.notes || [])
  const manuscriptIds = new Set(allNotes.map(note => String(note.id || '')))

  const indexSets = {
    characters: idSet(projectIndexes.characters),
    locations: idSet(projectIndexes.locations),
    foreshadows: idSet(projectIndexes.foreshadows),
  }
  const indexCounts = {
    characters: indexSets.characters.size,
    locations: indexSets.locations.size,
    foreshadows: indexSets.foreshadows.size,
  }

  const positiveWords = allNotes
    .map(note => Number(note.wordCount) || 0)
    .filter(value => value > 0)
  const medianWords = median(positiveWords)
  const chapterTargetWords = Math.max(
    0,
    Number(projectMeta.chapterTargetWords) || 0,
  )

  let ordinal = 0
  const mappedVolumes = volumes.map(volume => {
    const progress = getProjectVolumeProgress(volume, projectMeta)
    const chapters = (volume.notes || []).map(note => {
      ordinal += 1
      const id = String(note.id || '')
      const markers = []
      if (indexSets.characters.has(id)) markers.push('characters')
      if (indexSets.locations.has(id)) markers.push('locations')
      if (indexSets.foreshadows.has(id)) markers.push('foreshadows')

      return {
        id: note.id,
        ordinal,
        title: note.title,
        status: note.status || 'draft',
        wordCount: Number(note.wordCount) || 0,
        summary: getProjectChapterSummary(note, projectMeta, 120),
        hasManualSummary: Boolean(
          String(projectMeta?.summaries?.[note.id] || '').trim()
        ),
        markers,
        wordBand: wordBand(
          note.wordCount,
          chapterTargetWords,
          medianWords,
          positiveWords.length,
        ),
      }
    })

    return {
      id: volume.id,
      key: volume.id || '__ungrouped__',
      title: volume.id ? volume.title : labels.ungrouped,
      wordCount: Number(volume.wordCount) || 0,
      progress,
      chapters,
    }
  })

  const statusCounts = {
    draft: allNotes.filter(note => note.status === 'draft').length,
    review: allNotes.filter(note => note.status === 'review').length,
    done: allNotes.filter(note => note.status === 'done').length,
  }

  const taggedChapterIds = new Set()
  for (const set of Object.values(indexSets)) {
    for (const id of set) {
      if (manuscriptIds.has(id)) taggedChapterIds.add(id)
    }
  }

  const manualSummaryCount = allNotes.filter(note => (
    Boolean(String(projectMeta?.summaries?.[note.id] || '').trim())
  )).length
  const zeroWordCount = allNotes.filter(note => (
    (Number(note.wordCount) || 0) === 0
  )).length
  const wordOutlierCount = mappedVolumes
    .flatMap(volume => volume.chapters)
    .filter(chapter => (
      chapter.wordBand === 'under' || chapter.wordBand === 'over'
    )).length
  const emptyVolumeCount = mappedVolumes.filter(volume => (
    volume.chapters.length === 0
  )).length
  const targetedVolumeCount = mappedVolumes.filter(volume => (
    volume.progress.targetWords > 0
  )).length

  return {
    labels,
    project: {
      id: workspace?.project?.id || '',
      title: workspace?.project?.title || '',
      type: workspace?.project?.type || 'novel',
    },
    volumes: mappedVolumes,
    totals: {
      volumes: mappedVolumes.filter(volume => volume.id).length,
      chapters: allNotes.length,
      words: Number(workspace?.totalWords) || 0,
      statusCounts,
      donePercent: allNotes.length
        ? Math.round((statusCounts.done / allNotes.length) * 100)
        : 0,
      manualSummaryCount,
      summaryCoverage: allNotes.length
        ? Math.round((manualSummaryCount / allNotes.length) * 100)
        : 0,
      taggedChapterCount: taggedChapterIds.size,
      taggedCoverage: allNotes.length
        ? Math.round((taggedChapterIds.size / allNotes.length) * 100)
        : 0,
      medianWords,
      chapterTargetWords,
      targetedVolumeCount,
    },
    indexes: {
      ...indexCounts,
      characters: projectIndexes.characters || [],
      locations: projectIndexes.locations || [],
      foreshadows: projectIndexes.foreshadows || [],
    },
    signals: {
      emptyVolumes: emptyVolumeCount,
      zeroWordChapters: zeroWordCount,
      wordOutliers: wordOutlierCount,
      missingManualSummaries: Math.max(
        0,
        allNotes.length - manualSummaryCount,
      ),
      untaggedChapters: Math.max(
        0,
        allNotes.length - taggedChapterIds.size,
      ),
      volumesWithoutTargets: Math.max(
        0,
        mappedVolumes.filter(volume => volume.id).length - targetedVolumeCount,
      ),
    },
  }
}

export function filterProjectStoryMap(storyMap, filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase()
  const status = ['draft', 'review', 'done'].includes(filters.status)
    ? filters.status
    : 'all'
  const marker = ['characters', 'locations', 'foreshadows'].includes(filters.marker)
    ? filters.marker
    : 'all'

  return {
    ...storyMap,
    volumes: (storyMap?.volumes || []).map(volume => ({
      ...volume,
      chapters: (volume.chapters || []).filter(chapter => {
        if (status !== 'all' && chapter.status !== status) return false
        if (marker !== 'all' && !chapter.markers.includes(marker)) return false
        if (!query) return true
        return [
          chapter.title,
          chapter.summary,
        ].join(' ').toLocaleLowerCase().includes(query)
      }),
    })),
  }
}

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import theme from 'antd/es/theme'
import { UiButton } from './ControlKit'
import UiThemeProvider from './UiThemeProvider'

// These DOM paths come from the named production JSX locations. The tests read
// current production declarations and render actual Ant Design buttons; they do
// not encode the repaired selectors or replace the library's generated spans.
// Columns: stylesheet, JSX location, ancestor DOM path, original button class.
const actionCases = [
  ["src/components/AttachmentAudit.css","src/components/AttachmentAudit.jsx:63",[["div","attachment-audit-overlay"],["section","attachment-audit"],["div","attachment-audit-scroll"],["div","attachment-audit-items"],["article",""]],""],
  ["src/components/AttachmentAudit.css","src/components/AttachmentAudit.jsx:73",[["div","attachment-audit-overlay"],["section","attachment-audit"],["footer",""]],""],
  ["src/components/SearchReturnBar.css","src/components/CollectionReadingBar.jsx:62",[["section","search-return-bar collection-reading-bar"]],""],
  ["src/components/SearchReturnBar.css","src/components/CollectionReadingBar.jsx:72",[["section","search-return-bar collection-reading-bar"],["details","collection-reading-study"]],""],
  ["src/components/SearchReturnBar.css","src/components/SearchReturnBar.jsx:12",[["section","search-return-bar"]],""],
  ["src/components/CollectionStudy.css","src/components/CollectionStudyPanel.jsx:93",[["details","collection-study-panel"],["div","collection-study-list"],["article",""]],""],
  ["src/styles/redesign.css","src/components/DailyNotesPanel.jsx:128",[["section","daily-notes-panel"],["div","daily-workspace-body"],["section","daily-recent-card"],["div","daily-notes-list-header"]],"icon-btn"],
  ["src/components/DuplicateNotes.css","src/components/DuplicateNotes.jsx:90",[["div","duplicate-notes-overlay"],["section","duplicate-notes"],["footer",""]],""],
  ["src/components/Editor/nodes/BlockNodes.css","src/components/Editor/nodes/AttachmentNode.jsx:405",[["div","attachment-preview-overlay"],["section","attachment-preview-dialog"],["header","attachment-preview-header"],["div","attachment-preview-header-actions"]],""],
  ["src/components/Editor/nodes/BlockNodes.css","src/components/Editor/nodes/AttachmentNode.jsx:408",[["div","attachment-preview-overlay"],["section","attachment-preview-dialog"],["header","attachment-preview-header"],["div","attachment-preview-header-actions"]],"attachment-preview-delete"],
  ["src/components/Editor/nodes/BlockNodes.css","src/components/Editor/nodes/AttachmentNode.jsx:411",[["div","attachment-preview-overlay"],["section","attachment-preview-dialog"],["header","attachment-preview-header"],["div","attachment-preview-header-actions"]],"attachment-preview-close"],
  ["src/components/Editor/Editor.css","src/components/Editor/plugins/DocumentOutlinePlugin.jsx:200",[["div","document-outline local-outline  open"],["section","document-outline-panel"],["div","document-outline-header"]],""],
  ["src/components/Editor/Editor.css","src/components/Editor/plugins/EditorViewSettingsPlugin.jsx:280",[["div","editor-view-settings-host"],["section","editor-view-settings"],["header",""]],""],
  ["src/components/Editor/Editor.css","src/components/Editor/plugins/MarkdownSourcePlugin.jsx:124",[["div","markdown-source-overlay"],["section","markdown-source-panel"],["header","markdown-source-header"],["div","markdown-source-actions"]],""],
  ["src/components/Editor/Editor.css","src/components/Editor/plugins/ResourceManagerPlugin.jsx:170",[["div","editor-resource-manager"],["section","editor-resource-panel"],["header","editor-resource-header"]],""],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:260",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card trend"],["header",""],["div","focus-trend-switch"]],"active "],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:371",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card review"],["div","focus-session-review-list"],["div",""],["div","focus-session-review-editor"],["div",""]],""],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:380",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card review"],["div","focus-session-review-list"],["div",""],["div","focus-session-review-editor"],["div",""]],"primary"],
  ["src/components/FolderWorkspace.css","src/components/FolderWorkspace.jsx:146",[["div","folder-workspace-overlay"],["section","folder-workspace"],["footer",""]],""],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:170",[["section","library-reference-health"],["div","library-reference-health-head"]],"btn"],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:224",[["section","library-reference-health"],["div","library-reference-health-toolbar"]],"btn primary"],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:243",[["section","library-reference-health"],["div","library-reference-repair-preview"],["div","library-reference-repair-header"]],"btn primary"],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:281",[["section","library-reference-health"],["div","library-reference-repair-preview"],["div","library-reference-repair-files"],["article","library-reference-file-card repairable"],["header",""]],""],
  ["src/components/LibraryStatistics.css","src/components/LibraryStatistics.jsx:60",[["div","library-statistics-overlay"],["section","library-statistics"],["div","library-statistics-scroll"],["div","statistics-notes"],["article",""]],""],
  ["src/components/LibraryStatistics.css","src/components/LibraryStatistics.jsx:68",[["div","library-statistics-overlay"],["section","library-statistics"],["footer",""]],""],
  ["src/components/LocalActions.css","src/components/LocalActions.jsx:77",[["div","local-actions-overlay"],["section","local-actions"],["footer",""]],"btn primary"],
  ["src/components/NoteComparison.css","src/components/NoteComparison.jsx:126",[["div","note-comparison-overlay"],["section","note-comparison"],["footer",""]],""],
  ["src/components/ProjectAnalyticsPanel.css","src/components/ProjectAnalyticsPanel.jsx:105",[["section","project-analytics-panel"],["div","project-analytics-head"]],"btn small"],
  ["src/components/ProjectEntityIntelligencePanel.css","src/components/ProjectEntityIntelligencePanel.jsx:217",[["section","project-entity-intelligence"],["div","project-entity-intelligence-grid"],["article","project-entity-alias-editor"],["div","project-entity-alias-summary"]],"btn small"],
  ["src/components/ProjectInsightsPanel.css","src/components/ProjectInsightsPanel.jsx:174",[["section","project-insights-panel"],["div","project-insights-head"],["div","project-insights-head-actions"]],"btn small"],
  ["src/components/ProjectInsightsPanel.css","src/components/ProjectInsightsPanel.jsx:183",[["section","project-insights-panel"],["div","project-insights-head"],["div","project-insights-head-actions"],["div","project-insights-period"]],"active "],
  ["src/components/ProjectInsightsPanel.css","src/components/ProjectInsightsPanel.jsx:350",[["section","project-insights-panel"],["article","project-insight-report"],["header",""],["div",""]],"btn small"],
  ["src/components/ProjectInsightsPanel.css","src/components/ProjectInsightsPanel.jsx:357",[["section","project-insights-panel"],["article","project-insight-report"],["header",""],["div",""]],"btn small primary"],
  ["src/components/ProjectPlanningPanel.css","src/components/ProjectPlanningPanel.jsx:136",[["section","project-planning-panel"],["div","project-planning-head"]],"btn small"],
  ["src/components/ProjectRelationGraphPanel.css","src/components/ProjectRelationGraphPanel.jsx:627",[["section","project-relation-panel"],["div","project-relation-workspace"],["aside","project-relation-detail"],["header",""]],"btn small"],
  ["src/components/ProjectRelationGraphPanel.css","src/components/ProjectRelationGraphPanel.jsx:791",[["section","project-relation-panel"],["div","project-relation-workspace"],["aside","project-relation-detail"],["div","project-relation-evolution-list"],["div","orphan"]],"remove"],
  ["src/components/ProjectSprintPanel.css","src/components/ProjectSprintPanel.jsx:213",[["section","project-sprint-panel"],["div","project-sprint-grid"],["article","project-sprint-card calendar-card"],["header",""],["div","project-calendar-nav"]],""],
  ["src/components/ProjectSprintPanel.css","src/components/ProjectSprintPanel.jsx:489",[["section","project-sprint-panel"],["div","project-sprint-grid"],["article","project-sprint-card review-card"],["div","project-review-actions"]],"btn small primary"],
  ["src/components/ProjectStructurePanel.css","src/components/ProjectStructurePanel.jsx:329",[["section","project-structure-panel"],["header","project-structure-head"],["div",""]],"btn small"],
  ["src/components/ProjectStructurePanel.css","src/components/ProjectStructurePanel.jsx:336",[["section","project-structure-panel"],["header","project-structure-head"],["div",""]],"btn small  active "],
  ["src/components/ProjectTodayCenter.css","src/components/ProjectTodayCenter.jsx:82",[["section","project-today-center"],["div","project-today-center-head"],["div","project-today-center-actions"]],"btn"],
  ["src/components/ProjectTodayCenter.css","src/components/ProjectTodayCenter.jsx:90",[["section","project-today-center"],["div","project-today-center-head"],["div","project-today-center-actions"]],"btn primary"],
  ["src/components/ProjectTodayCenter.css","src/components/ProjectTodayCenter.jsx:154",[["section","project-today-center"],["div","project-today-center-grid"],["article","project-today-card tasks"],["div","project-today-task-list"],["div","project-today-empty project-today-empty-action"],["div",""]],""],
  ["src/components/ProjectTodayCenter.css","src/components/ProjectTodayCenter.jsx:205",[["section","project-today-center"],["div","project-today-center-grid"],["article","project-today-card summary"],["div","project-today-review-state"]],""],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:1551",[["div","project-workspace-panel"],["div","project-workspace-empty"]],"btn primary"],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:1597",[["div","project-workspace-panel"],["header","project-workspace-toolbar"],["div","project-workspace-toolbar-actions"],["div","project-actions-menu-wrap"]],"btn small project-actions-trigger"],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2323",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["section","project-volume-manager"],["div","project-volume-manager-head"]],"btn small"],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2554",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["div","project-workspace-board"],["section","project-volume-column"],["header","project-volume-header"],["div","project-volume-export"]],"project-volume-settings"],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2562",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["div","project-workspace-board"],["section","project-volume-column"],["header","project-volume-header"],["div","project-volume-export"]],"project-volume-manage"],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2571",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["div","project-workspace-board"],["section","project-volume-column"],["header","project-volume-header"],["div","project-volume-export"]],"project-volume-create"],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2586",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["div","project-workspace-board"],["section","project-volume-column"],["header","project-volume-header"],["div","project-volume-export"]],""],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2790",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["div","project-board-filter-empty"]],"btn"],
  ["src/components/ReferenceRefactorDialog.css","src/components/ReferenceRefactorDialog.jsx:133",[["div","modal-overlay consumer-modal-overlay"],["section","modal consumer-modal reference-refactor-dialog"],["div","reference-refactor-source-list"],["article","reference-refactor-source"],["header",""]],""],
  ["src/styles/redesign.css","src/components/SettingsPanel.jsx:203",[["div","settings-panel"],["div","settings-content consumer-settings-content"],["section","settings-card consumer-settings-section"],["div","settings-row"]],"btn"],
  ["src/styles/redesign.css","src/components/SyncCenterPanel.jsx:367",[["section","settings-card consumer-settings-section sync-center-card"],["div","settings-row"]],"btn"],
  ["src/styles/redesign.css","src/components/SettingsPanel.jsx:323",[["div","settings-panel"],["div","settings-content consumer-settings-content"],["section","settings-card consumer-settings-section"],["div","settings-advanced-panel"],["div","settings-advanced-header"],["div","settings-toolbar-actions"]],"btn small"],
  ["src/components/SyncCenterPanel.css","src/components/SyncCenterPanel.jsx:360",[["section","settings-card consumer-settings-section sync-center-card"],["div","sync-provider-grid"],["div","sync-provider-card  active"],["div","sync-auto-controls"]],"btn"],
  ["src/components/SyncCenterPanel.css","src/components/SyncCenterPanel.jsx:371",[["section","settings-card consumer-settings-section sync-center-card"],["div","sync-rebind-notice"]],"btn"],
  ["src/components/SyncCenterPanel.css","src/components/SyncConflictReview.jsx:96",[["article","sync-conflict-item sync-conflict-review-item"],["div","sync-conflict-actions"]],"btn small"],
  ["src/components/SyncCenterPanel.css","src/components/SyncConflictReview.jsx:98",[["article","sync-conflict-item sync-conflict-review-item"],["div","sync-conflict-actions"]],"btn small primary"],
  ["src/components/SyncCenterPanel.css","src/components/SyncConflictReview.jsx:104",[["article","sync-conflict-item sync-conflict-review-item"],["section","sync-conflict-review"],["div","sync-review-heading"]],"btn small"],
  ["src/components/SyncCenterPanel.css","src/components/SyncConflictReview.jsx:121",[["article","sync-conflict-item sync-conflict-review-item"],["section","sync-conflict-review"],["div","sync-review-footer"]],"btn"],
  ["src/components/SyncCenterPanel.css","src/components/SyncConflictReview.jsx:123",[["article","sync-conflict-item sync-conflict-review-item"],["section","sync-conflict-review"],["div","sync-review-footer"]],"btn primary"],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFilePagination.jsx:33",[["div","sync-history-file-pages"]],"btn small"],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFilePagination.jsx:46",[["div","sync-history-file-pages"],["div","sync-history-file-page-jump"]],"btn small"],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFileViewer.jsx:148",[["details","sync-history-file"],["div","sync-history-file-body"],["section",""],["fieldset","sync-history-file-search"],["div","sync-history-file-object-filter"]],"btn small"],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFileViewer.jsx:155",[["details","sync-history-file"],["div","sync-history-file-body"],["section",""],["fieldset","sync-history-file-search"],["div","sync-history-file-record-filter"]],"btn small"],
  ["src/components/SyncPlanPanel.css","src/components/SyncPlanPanel.jsx:23",[["section","sync-plan-view"],["div","sync-plan-view-heading"]],"btn small"],
  ["src/components/TagWorkspace.css","src/components/TagWorkspace.jsx:169",[["div","tag-workspace-overlay"],["section","tag-workspace"],["footer",""]],""],
  ["src/components/TaskCenter.css","src/components/TaskCenter.jsx:79",[["div","task-center-overlay"],["section","task-center"],["div","task-center-scroll"],["div","task-center-items"],["article",""]],""],
  ["src/components/TaskCenter.css","src/components/TaskCenter.jsx:88",[["div","task-center-overlay"],["section","task-center"],["footer",""]],""],
  ["src/components/TrashRecovery.css","src/components/TrashRecovery.jsx:125",[["div","trash-recovery-overlay"],["section","trash-recovery"],["footer",""]],""],
]
// Caption paths include the authored leaf. Keep its existing text declarations,
// including deliberately authored text inside mixed-content buttons.
const captionCases = [
  ["src/components/AttachmentAudit.css","src/components/AttachmentAudit.jsx:63",[["div","attachment-audit-overlay"],["section","attachment-audit"],["div","attachment-audit-scroll"],["div","attachment-audit-items"],["article",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/AttachmentAudit.css","src/components/AttachmentAudit.jsx:73",[["div","attachment-audit-overlay"],["section","attachment-audit"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/SearchReturnBar.css","src/components/CollectionReadingBar.jsx:55",[["section","search-return-bar collection-reading-bar"],["div",""],["span",""]],{"font-size":"12px"},false],
  ["src/components/SearchReturnBar.css","src/components/SearchReturnBar.jsx:10",[["section","search-return-bar"],["div",""],["span",""]],{"font-size":"12px"},false],
  ["src/components/CollectionStudy.css","src/components/CollectionStudyPanel.jsx:91",[["details","collection-study-panel"],["div","collection-study-list"],["article",""],["span",""]],{"color":"var(--ink-muted)","font-size":"12px"},false],
  ["src/styles/redesign.css","src/components/DailyNotesPanel.jsx:101",[["section","daily-notes-panel"],["div","daily-workspace-body"],["section","calendar-card"],["div","daily-section-heading"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"11px","line-height":"1.5"},false],
  ["src/styles/redesign.css","src/components/DailyNotesPanel.jsx:127",[["section","daily-notes-panel"],["div","daily-workspace-body"],["section","daily-recent-card"],["div","daily-notes-list-header"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"11px","line-height":"1.5"},false],
  ["src/components/DuplicateNotes.css","src/components/DuplicateNotes.jsx:90",[["div","duplicate-notes-overlay"],["section","duplicate-notes"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/Editor/nodes/BlockNodes.css","src/components/Editor/nodes/AttachmentNode.jsx:401",[["div","attachment-preview-overlay"],["section","attachment-preview-dialog"],["header","attachment-preview-header"],["div",""],["span",""]],{"color":"var(--muted, #6b7280)","font-size":"9px"},false],
  ["src/components/Editor/Editor.css","src/components/Editor/plugins/EditorViewSettingsPlugin.jsx:278",[["div","editor-view-settings-host"],["section","editor-view-settings"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/Editor/Editor.css","src/components/Editor/plugins/MarkdownSourcePlugin.jsx:120",[["div","markdown-source-overlay"],["section","markdown-source-panel"],["header","markdown-source-header"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/Editor/Editor.css","src/components/Editor/plugins/ResourceManagerPlugin.jsx:168",[["div","editor-resource-manager"],["section","editor-resource-panel"],["header","editor-resource-header"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:172",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card efficiency"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:204",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card best-time"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:235",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card duration-compare"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:256",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card trend"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:304",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card chapter-efficiency"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:329",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card review"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/FocusSessionAnalyticsPanel.css","src/components/FocusSessionAnalyticsPanel.jsx:370",[["section","focus-session-analytics-panel"],["div","focus-session-analytics-grid"],["article","focus-analysis-card review"],["div","focus-session-review-list"],["div",""],["div","focus-session-review-editor"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/FolderWorkspace.css","src/components/FolderWorkspace.jsx:146",[["div","folder-workspace-overlay"],["section","folder-workspace"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:166",[["section","library-reference-health"],["div","library-reference-health-head"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"9px","line-height":"1.55"},false],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:182",[["section","library-reference-health"],["div","library-reference-health-intro"],["span",""]],{"color":"var(--ink-muted)","font-size":"9px","line-height":"1.55"},false],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:217",[["section","library-reference-health"],["div","library-reference-health-toolbar"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"9px","line-height":"1.55"},false],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:239",[["section","library-reference-health"],["div","library-reference-repair-preview"],["div","library-reference-repair-header"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"9px","line-height":"1.55"},false],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:345",[["section","library-reference-health"],["div","library-reference-manual-note"],["span",""]],{"color":"var(--ink-muted)","font-size":"9px","line-height":"1.55"},false],
  ["src/components/LibraryReferenceHealthPanel.css","src/components/LibraryReferenceHealthPanel.jsx:274",[["section","library-reference-health"],["div","library-reference-repair-preview"],["div","library-reference-repair-files"],["article","library-reference-file-card repairable"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/LibraryStatistics.css","src/components/LibraryStatistics.jsx:60",[["div","library-statistics-overlay"],["section","library-statistics"],["div","library-statistics-scroll"],["div","statistics-notes"],["article",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/LibraryStatistics.css","src/components/LibraryStatistics.jsx:68",[["div","library-statistics-overlay"],["section","library-statistics"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/LocalActions.css","src/components/LocalActions.jsx:77",[["div","local-actions-overlay"],["section","local-actions"],["footer",""],["span",""]],{"font-size":"12px","line-height":"1.5","color":"var(--ink-soft)"},false],
  ["src/components/LocalActions.css","src/components/LocalActions.jsx:77",[["div","local-actions-overlay"],["section","local-actions"],["footer",""],["span",""]],{"font-size":"11px"},false],
  ["src/components/NoteComparison.css","src/components/NoteComparison.jsx:126",[["div","note-comparison-overlay"],["section","note-comparison"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/ProjectAnalyticsPanel.css","src/components/ProjectAnalyticsPanel.jsx:101",[["section","project-analytics-panel"],["div","project-analytics-head"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/ProjectEntityIntelligencePanel.css","src/components/ProjectEntityIntelligencePanel.jsx:208",[["section","project-entity-intelligence"],["div","project-entity-intelligence-grid"],["article","project-entity-alias-editor"],["div","project-entity-alias-summary"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"6px"},false],
  ["src/components/ProjectEntityIntelligencePanel.css","src/components/ProjectEntityIntelligencePanel.jsx:210",[["section","project-entity-intelligence"],["div","project-entity-intelligence-grid"],["article","project-entity-alias-editor"],["div","project-entity-alias-summary"],["div",""],["small",""]],{"color":"var(--ink-muted)","font-size":"6px"},false],
  ["src/components/ProjectInsightsPanel.css","src/components/ProjectInsightsPanel.jsx:168",[["section","project-insights-panel"],["div","project-insights-head"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/ProjectInsightsPanel.css","src/components/ProjectInsightsPanel.jsx:341",[["section","project-insights-panel"],["article","project-insight-report"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectPlanningPanel.css","src/components/ProjectPlanningPanel.jsx:134",[["section","project-planning-panel"],["div","project-planning-head"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/ProjectRelationGraphPanel.css","src/components/ProjectRelationGraphPanel.jsx:623",[["section","project-relation-panel"],["div","project-relation-workspace"],["aside","project-relation-detail"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"6px"},false],
  ["src/components/ProjectRelationGraphPanel.css","src/components/ProjectRelationGraphPanel.jsx:625",[["section","project-relation-panel"],["div","project-relation-workspace"],["aside","project-relation-detail"],["header",""],["div",""],["small",""]],{"color":"var(--ink-muted)","font-size":"6px"},false],
  ["src/components/ProjectRelationGraphPanel.css","src/components/ProjectRelationGraphPanel.jsx:778",[["section","project-relation-panel"],["div","project-relation-workspace"],["aside","project-relation-detail"],["div","project-relation-evolution-list"],["div","orphan"],["button","ant-btn app-ui-button"],["span",""]],{"color":"var(--clay)","font-size":"6px","font-weight":"680"},false],
  ["src/components/ProjectSprintPanel.css","src/components/ProjectSprintPanel.jsx:208",[["section","project-sprint-panel"],["div","project-sprint-grid"],["article","project-sprint-card calendar-card"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectSprintPanel.css","src/components/ProjectSprintPanel.jsx:290",[["section","project-sprint-panel"],["div","project-sprint-grid"],["article","project-sprint-card today-card"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectSprintPanel.css","src/components/ProjectSprintPanel.jsx:373",[["section","project-sprint-panel"],["div","project-sprint-grid"],["article","project-sprint-card sprint-card"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectSprintPanel.css","src/components/ProjectSprintPanel.jsx:475",[["section","project-sprint-panel"],["div","project-sprint-grid"],["article","project-sprint-card review-card"],["header",""],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectSprintPanel.css","src/components/ProjectSprintPanel.jsx:488",[["section","project-sprint-panel"],["div","project-sprint-grid"],["article","project-sprint-card review-card"],["div","project-review-actions"],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectStructurePanel.css","src/components/ProjectStructurePanel.jsx:324",[["section","project-structure-panel"],["header","project-structure-head"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px","line-height":"1.45"},false],
  ["src/components/ProjectTodayCenter.css","src/components/ProjectTodayCenter.jsx:78",[["section","project-today-center"],["div","project-today-center-head"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/ProjectTodayCenter.css","src/components/ProjectTodayCenter.jsx:152",[["section","project-today-center"],["div","project-today-center-grid"],["article","project-today-card tasks"],["div","project-today-task-list"],["div","project-today-empty project-today-empty-action"],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectTodayCenter.css","src/components/ProjectTodayCenter.jsx:199",[["section","project-today-center"],["div","project-today-center-grid"],["article","project-today-card summary"],["div","project-today-review-state"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"7px"},false],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:1550",[["div","project-workspace-panel"],["div","project-workspace-empty"],["span",""]],{"font-size":"10px","line-height":"1.6"},false],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:1605",[["div","project-workspace-panel"],["header","project-workspace-toolbar"],["div","project-workspace-toolbar-actions"],["div","project-actions-menu-wrap"],["button","ant-btn app-ui-button btn small project-actions-trigger"],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},true],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2315",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["section","project-volume-manager"],["div","project-volume-manager-head"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2532",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["div","project-workspace-board"],["section","project-volume-column"],["header","project-volume-header"],["div","project-volume-copy"],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/components/ProjectWorkspacePanel.css","src/components/ProjectWorkspacePanel.jsx:2789",[["div","project-workspace-panel"],["div","project-workspace-view-content view-"],["div","project-board-filter-empty"],["span",""]],{"font-size":"9px"},false],
  ["src/components/ReferenceRefactorDialog.css","src/components/ReferenceRefactorDialog.jsx:140",[["div","modal-overlay consumer-modal-overlay"],["section","modal consumer-modal reference-refactor-dialog"],["div","reference-refactor-source-list"],["article","reference-refactor-source"],["header",""],["span",""]],{"color":"var(--ink-muted)","font-size":"8px"},false],
  ["src/styles/redesign.css","src/components/SettingsPanel.jsx:197",[["div","settings-panel"],["div","settings-content consumer-settings-content"],["section","settings-card consumer-settings-section"],["div","settings-row"],["div",""],["span",""]],{"color":"var(--ink-muted)","font-size":"9px"},false],
  ["src/styles/redesign.css","src/components/SyncCenterPanel.jsx:366",[["section","settings-card consumer-settings-section sync-center-card"],["div","settings-row"],["div",""],["span","sync-device-id"]],{"color":"var(--ink-muted)","font-size":"9px"},false],
  ["src/styles/redesign.css","src/components/SettingsPanel.jsx:197",[["div","settings-panel"],["div","settings-content consumer-settings-content"],["section","settings-card consumer-settings-section"],["div","settings-row"],["div",""],["span",""]],{"font-size":"11px"},false],
  ["src/styles/redesign.css","src/components/SyncCenterPanel.jsx:366",[["section","settings-card consumer-settings-section sync-center-card"],["div","settings-row"],["div",""],["span","sync-device-id"]],{"font-size":"11px"},false],
  ["src/styles/redesign.css","src/components/SettingsPanel.jsx:320",[["div","settings-panel"],["div","settings-content consumer-settings-content"],["section","settings-card consumer-settings-section"],["div","settings-advanced-panel"],["div","settings-advanced-header"],["div",""],["span",""]],{"font-size":"10px","color":"var(--ink-muted)"},false],
  ["src/components/SyncCenterPanel.css","src/components/SyncCenterPanel.jsx:358",[["section","settings-card consumer-settings-section sync-center-card"],["div","sync-provider-grid"],["div","sync-provider-card  active"],["div","sync-auto-controls"],["div",""],["span",""]],{"font-size":"11px","line-height":"1.5","color":"var(--ink-soft)"},false],
  ["src/components/SyncCenterPanel.css","src/components/SyncCenterPanel.jsx:370",[["section","settings-card consumer-settings-section sync-center-card"],["div","sync-rebind-notice"],["div",""],["span",""]],{"font-size":"11px","line-height":"1.55","color":"var(--ink-soft)"},false],
  ["src/components/SyncCenterPanel.css","src/components/SyncConflictReview.jsx:93",[["article","sync-conflict-item sync-conflict-review-item"],["div",""],["span",""]],{"color":"var(--ink-soft)","font-size":"12px"},false],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFilePagination.jsx:35",[["div","sync-history-file-pages"],["span",""]],{"font-size":"12px","line-height":"1.8"},false],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFilePagination.jsx:45",[["div","sync-history-file-pages"],["div","sync-history-file-page-jump"],["label",""],["span",""]],{"font-size":"12px","line-height":"1.8"},false],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFilePagination.jsx:47",[["div","sync-history-file-pages"],["div","sync-history-file-page-jump"],["span",""]],{"font-size":"12px","line-height":"1.8"},false],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFileViewer.jsx:147",[["details","sync-history-file"],["div","sync-history-file-body"],["section",""],["fieldset","sync-history-file-search"],["div","sync-history-file-object-filter"],["span",""]],{"font-size":"12px","line-height":"1.8","color":"var(--ink)"},false],
  ["src/components/SyncHistoryFileViewer.css","src/components/SyncHistoryFileViewer.jsx:154",[["details","sync-history-file"],["div","sync-history-file-body"],["section",""],["fieldset","sync-history-file-search"],["div","sync-history-file-record-filter"],["span",""]],{"font-size":"12px","line-height":"1.8","color":"var(--ink)"},false],
  ["src/components/SyncPlanPanel.css","src/components/SyncPlanPanel.jsx:22",[["section","sync-plan-view"],["div","sync-plan-view-heading"],["div",""],["span",""]],{"color":"var(--ink-muted, var(--muted))","font-size":"12px","line-height":"1.65"},false],
  ["src/components/SyncPlanPanel.css","src/components/SyncPlanPanel.jsx:32",[["section","sync-plan-view"],["small",""]],{"color":"var(--ink-muted, var(--muted))","font-size":"12px","line-height":"1.65"},false],
  ["src/components/SyncPlanPanel.css","src/components/SyncPlanPanel.jsx:49",[["section","sync-plan-view"],["ul","sync-plan-items"],["li",""],["div",""],["small",""]],{"color":"var(--ink-muted, var(--muted))","font-size":"12px","line-height":"1.65"},false],
  ["src/components/TagWorkspace.css","src/components/TagWorkspace.jsx:169",[["div","tag-workspace-overlay"],["section","tag-workspace"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/TaskCenter.css","src/components/TaskCenter.jsx:79",[["div","task-center-overlay"],["section","task-center"],["div","task-center-scroll"],["div","task-center-items"],["article",""],["div",""],["span","task-center-state"]],{"color":"var(--ink-soft)"},false],
  ["src/components/TaskCenter.css","src/components/TaskCenter.jsx:88",[["div","task-center-overlay"],["section","task-center"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
  ["src/components/TrashRecovery.css","src/components/TrashRecovery.jsx:125",[["div","trash-recovery-overlay"],["section","trash-recovery"],["footer",""],["span",""]],{"color":"var(--ink-soft)"},false],
]
const textProperties = new Set(['color', 'font-size', 'font-weight', 'line-height', 'text-align'])
const styles = new Map()
function rules(file) {
  if (!styles.has(file)) {
    const parsed = []
    postcss.parse(readFileSync(path.resolve(file), 'utf8')).walkRules(rule => {
      const declarations = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
      if (Object.keys(declarations).some(property => textProperties.has(property))) parsed.push({ selector: rule.selector, declarations })
    })
    styles.set(file, parsed)
  }
  return styles.get(file)
}
const matched = (file, element) => rules(file).filter(rule => element.matches(rule.selector))
function wrap(chain, child) {
  return [...chain].reverse().reduce((inside, [tag, className]) => {
    if (tag === 'button') {
      const classes = className.split(/\s+/).filter(name => !['ant-btn', 'app-ui-button'].includes(name)).join(' ')
      // Keep the production sibling children. Ant Design intentionally wraps a
      // Fragment in another span, so introducing one would change this DOM.
      return classes.includes('project-actions-trigger') ?
        <UiButton type="button" className={classes}>项目操作{inside}</UiButton> :
        <UiButton type="button" className={classes}>{inside}<strong>章节标题</strong><small>关系说明</small></UiButton>
    }
    return React.createElement(tag, { className: className || undefined }, inside)
  }, child)
}
let host, root, oldTheme, oldStyle
const render = children => act(async () => root.render(<UiThemeProvider>{children}</UiThemeProvider>))
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  oldTheme = document.documentElement.getAttribute('data-theme')
  oldStyle = document.documentElement.getAttribute('style')
  document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('style')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  for (const [name, value] of [['data-theme', oldTheme], ['style', oldStyle]]) {
    if (value === null) document.documentElement.removeAttribute(name)
    else document.documentElement.setAttribute(name, value)
  }
  vi.useRealTimers(); vi.unstubAllGlobals()
})

it('keeps production caption rules off the actual generated text spans of action buttons', async () => {
  const pressed = vi.fn()
  await render(actionCases.map(([file, source, chain, className], index) =>
    <div key={index} data-action-case={index}>{wrap(chain,
      <UiButton type="button" className={className} variant="primary" onClick={pressed}>操作按钮文字</UiButton>)}</div>))
  const leaks = []
  actionCases.forEach(([file, source], index) => {
    const button = host.querySelector(`[data-action-case="${index}"] [data-ui-control="button"]`)
    expect(button.tagName).toBe('BUTTON'); expect(button.classList.contains('ant-btn')).toBe(true)
    const text = [...button.querySelectorAll('span')].filter(node => node.textContent === '操作按钮文字')
    expect(text.length, source + ' must exercise real generated text spans').toBeGreaterThan(0)
    for (const node of text) for (const rule of matched(file, node)) leaks.push({ source, file, selector: rule.selector, declarations: rule.declarations })
  })
  expect(leaks, 'Caption typography belongs to authored text containers, not generated Ant Design action labels').toEqual([])
  await act(async () => host.querySelector('[data-ui-control="button"]').click())
  expect(pressed).toHaveBeenCalledOnce()
})

it('retains every existing authored caption declaration in the production DOM paths', async () => {
  await render(captionCases.map(([file, source, chain, declarations, hidden], index) => {
    const [tag, className] = chain.at(-1)
    const caption = React.createElement(tag, { className: className || undefined, 'data-authored-caption': index, 'aria-hidden': hidden ? 'true' : undefined }, '说明文字')
    return <div key={index}>{wrap(chain.slice(0, -1), caption)}</div>
  }))
  const lost = []
  captionCases.forEach(([file, source, chain, declarations], index) => {
    const caption = host.querySelector(`[data-authored-caption="${index}"]`), retained = matched(file, caption)
    for (const [property, value] of Object.entries(declarations)) {
      if (!retained.some(rule => rule.declarations[property] === value)) lost.push({ source, file, property, value })
    }
  })
  expect(lost, 'Narrowing caption ownership must preserve descriptions, counts, explicit arrows and relation labels').toEqual([])
})

it('preserves deliberately authored calendar, sidebar and research-card text inside real buttons', async () => {
  await render(<>
    <UiButton type="button" className="project-calendar-day"><span data-kept="day">9</span><small>+120</small></UiButton>
    <UiButton type="button" className="workspace-sidebar-search"><svg aria-hidden="true"/><span data-kept="sidebar">搜索笔记</span><kbd>Ctrl K</kbd></UiButton>
    <div className="research-task-list"><UiButton type="button"><strong>研究任务</strong><span data-kept="research">已保存 · 2 条批注</span><small data-kept="time">本机时间</small></UiButton></div>
  </>)
  const expected = [
    ['day', 'src/components/ProjectSprintPanel.css', 'font-size', '7px'],
    ['sidebar', 'src/styles/redesign.css', 'text-align', 'left'],
    ['research', 'src/components/StudyCompilationPanel.css', 'color', 'var(--ink-muted)'],
    ['time', 'src/components/StudyCompilationPanel.css', 'font-size', '12px'],
  ]
  for (const [name, file, property, value] of expected) {
    const element = host.querySelector(`[data-kept="${name}"]`)
    expect(element.closest('button').classList.contains('ant-btn')).toBe(true)
    expect(matched(file, element).some(rule => rule.declarations[property] === value)).toBe(true)
  }
})

function componentVariables(button) {
  const scope = [...button.classList].find(name => name.startsWith('css-var-'))
  expect(scope).toBeTruthy()
  const result = {}
  for (const style of document.querySelectorAll('style[data-token-hash]')) {
    if (style.getAttribute('data-token-hash') !== scope) continue
    postcss.parse(style.textContent).walkRules(rule => {
      if (!rule.selector.includes('.ant-btn') || !button.matches(rule.selector)) return
      rule.walkDecls(declaration => { result[declaration.prop] = declaration.value })
    })
  }
  return result
}
function luminance(hex) {
  const normalized = hex.length === 4 ? '#' + [...hex.slice(1)].map(value => value + value).join('') : hex
  expect(normalized).toMatch(/^#[a-f\d]{6}$/i)
  const values = [1, 3, 5].map(offset => parseInt(normalized.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
function GlobalTokens() {
  const { token } = theme.useToken()
  return <output data-global-tokens={JSON.stringify({ normal: token.colorPrimary, hover: token.colorPrimaryHover, active: token.colorPrimaryActive, text: token.colorTextLightSolid })}/>
}
function palette(dark) {
  const file = dark ? 'src/styles/dark-theme.css' : 'src/styles/redesign.css'
  const result = {}
  postcss.parse(readFileSync(path.resolve(file), 'utf8')).walkRules(rule => {
    if (rule.selector !== (dark ? 'html[data-theme="dark"]' : ':root')) return
    rule.walkDecls(declaration => { result[declaration.prop] = declaration.value })
  })
  return { primary: result['--clay'], hover: result['--clay-hover'] }
}
it.each([
  ['light', true], ['dark', true], ['light', false], ['dark', false],
])('uses readable Button-only primary text and semantic hover in %s (CSS present: %s)', async (mode, supplied) => {
  const dark = mode === 'dark', semantics = palette(dark), pressed = vi.fn()
  if (dark) document.documentElement.dataset.theme = 'dark'
  if (supplied) {
    expect(semantics.primary).toMatch(/^#/); expect(semantics.hover).toMatch(/^#/)
    document.documentElement.style.setProperty('--clay', semantics.primary)
    document.documentElement.style.setProperty('--clay-hover', semantics.hover)
  }
  await render(<><GlobalTokens/><UiButton type="button" variant="primary" onClick={pressed}>确认操作</UiButton></>)
  const button = host.querySelector('button'), variables = componentVariables(button)
  const global = JSON.parse(host.querySelector('output').getAttribute('data-global-tokens'))
  const primary = supplied ? semantics.primary : dark ? '#75baff' : '#6e59d9'
  const expected = theme.getDesignToken({ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: primary } })
  expect(global).toEqual({ normal: expected.colorPrimary, hover: expected.colorPrimaryHover, active: expected.colorPrimaryActive, text: expected.colorTextLightSolid })
  const foreground = variables['--ant-button-primary-color'], hover = variables['--ant-color-primary-hover']
  expect(foreground).toBe(dark ? '#000' : '#fff')
  expect(hover).toBe(supplied ? semantics.hover : dark ? '#9dceff' : '#624ac8')
  for (const background of [global.normal, hover, global.active]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  // Inspect the library's actual emitted rule: primary solid uses this one
  // foreground for normal, hover and active instead of a descendant reset.
  const emitted = [...document.querySelectorAll('style[data-css-hash]')].map(style => style.textContent).join('\n')
  const solid = []
  postcss.parse(emitted).walkRules(rule => {
    if (rule.selector.includes('.ant-btn-color-primary.ant-btn-variant-solid')) solid.push(Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])))
  })
  expect(solid.some(rule => rule['--ant-btn-text-color'] === 'var(--ant-button-primary-color)' &&
    rule['--ant-btn-text-color-hover'] === 'var(--ant-btn-text-color)' && rule['--ant-btn-text-color-active'] === 'var(--ant-btn-text-color)')).toBe(true)
  await act(async () => button.click()); expect(pressed).toHaveBeenCalledOnce()
})


// A valid custom scheme is installed through the production appearance runtime,
// so both semantic variables and the provider see the same accepted colors.
import { beginAppearancePreview, contrastRatio, installAppearanceRuntime, validateScheme } from '../../services/localAppearance'
it.each([
  ['#a0a0a0', true], ['#949494', true], ['#00ad90', true], ['#80d6ad', false],
])('keeps an approved custom dark accent %s readable without changing its global palette', async (darkAccent, needsFallback) => {
  const scheme = validateScheme({ id: 'custom-contrast-' + darkAccent.slice(1), name: 'Contrast ' + darkAccent,
    lightAccent: '#176b4a', darkAccent })
  document.documentElement.dataset.theme = 'dark'
  const disposeAppearance = installAppearanceRuntime({ storage: { getItem: () => null } })
  try {
    beginAppearancePreview().show({ version: 1, activeId: scheme.id, schemes: [scheme] })
    expect(getComputedStyle(document.documentElement).getPropertyValue('--clay').trim()).toBe(darkAccent)
    expect(getComputedStyle(document.documentElement).getPropertyValue('--clay-hover').trim()).toBe(darkAccent)
    await render(<><GlobalTokens/><UiButton type="button" variant="primary">确认操作</UiButton></>)
    const variables = componentVariables(host.querySelector('button'))
    const global = JSON.parse(host.querySelector('output').getAttribute('data-global-tokens'))
    const derived = theme.getDesignToken({ algorithm: theme.darkAlgorithm, token: { colorPrimary: darkAccent } })
    expect(global).toEqual({ normal: derived.colorPrimary, hover: derived.colorPrimaryHover,
      active: derived.colorPrimaryActive, text: derived.colorTextLightSolid })
    expect(contrastRatio('#000000', derived.colorPrimaryActive) < 4.5).toBe(needsFallback)
    const active = variables['--ant-color-primary-active'] || global.active
    expect(contrastRatio('#000000', active)).toBeGreaterThanOrEqual(4.5)
    expect(variables['--ant-color-primary-active']).toBe(needsFallback ? darkAccent : undefined)
    expect(variables['--ant-color-primary']).toBeUndefined()
    expect(variables['--ant-color-primary-hover']).toBe(darkAccent)
    expect(variables['--ant-button-primary-color']).toBe('#000')
    expect(variables['--ant-button-danger-color']).toBe('#fff')
    expect(contrastRatio('#000000', global.normal)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#000000', variables['--ant-color-primary-hover'])).toBeGreaterThanOrEqual(4.5)
    if (darkAccent === '#949494') expect(() => validateScheme({ ...scheme, darkAccent: '#939393' })).toThrow('4.5:1')
  } finally {
    await act(async () => disposeAppearance())
  }
})

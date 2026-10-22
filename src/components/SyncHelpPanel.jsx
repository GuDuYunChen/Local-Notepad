import React from 'react'
import { SYNC_HELP_TOPICS } from '~/services/syncHelp.mjs'
import './SyncHelpPanel.css'

// Native disclosures retain their own open state across parent snapshot updates.
// No props, effects, credentials, status model or operation callbacks belong here.
export default function SyncHelpPanel() {
  return <details className="sync-help" data-sync-help>
    <summary>操作帮助<span className="sync-help-caption">首次设置、冲突与恢复</span></summary>
    <div className="sync-help-body">
      <p className="sync-help-intro">这里只解释操作，不检测当前连接，也不会执行同步。实际状态以上方读取依据和“状态与恢复”区域为准。</p>
      {SYNC_HELP_TOPICS.map(topic => <details key={topic.key} className="sync-help-topic" data-sync-help-topic={topic.key}>
        <summary>{topic.title}</summary>
        <ol>{topic.steps.map(step => <li key={step.title}><strong>{step.title}</strong><span>{step.detail}</span></li>)}</ol>
      </details>)}
    </div>
  </details>
}

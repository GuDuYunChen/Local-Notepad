// A closed, local-only registry. No URLs, scripts, note bodies or file paths.
const entries = [
  ['notes', '返回笔记', '写作', '回到当前笔记，保留原编辑状态', 'notes editor writing', 'workspace', 'notes'],
  ['quickSwitch', '快速切换笔记', '查找', '按标题查找，沿原保存保护打开笔记', 'quick switch title', 'overlay', 'quickSwitch'],
  ['globalSearch', '全局检索', '查找', '检索已保存内容和上下文', 'search find 搜索 查找', 'overlay', 'globalSearch'],
  ['daily', '每日笔记', '写作', '打开每日笔记工作区，不自动创建笔记', 'daily calendar 日历', 'workspace', 'daily'],
  ['projects', '项目工作区', '写作', '打开本地项目与写作工作区', 'project writing', 'workspace', 'projects'],
  ['recent', '最近访问', '查找', '回访近期打开的笔记', 'recent history 最近', 'workspace', 'recent'],
  ['pinned', '置顶笔记', '整理', '整理和回访置顶笔记', 'pinned favorite 收藏', 'workspace', 'pinned'],
  ['graph', '知识图谱', '查找', '查看笔记之间的本地引用关系', 'graph links 关系', 'workspace', 'graph'],
  ['tasks', '待办任务中心', '整理', '汇总已保存待办，在原编辑器完成任务', 'task todo checklist 任务', 'settings', 'tasks'],
  ['tags', '标签工作台', '整理', '查看关联笔记，管理标签与分类', 'tag category 分类', 'settings', 'tags'],
  ['statistics', '笔记库统计', '整理', '只读查看数量、字符和日期分布', 'statistics stats count 字数', 'settings', 'statistics'],
  ['attachments', '附件检查中心', '数据', '只读检查文件与候选引用，不自动删除', 'attachment audit 图片 文件', 'settings', 'attachments'],
  ['backup', '备份与恢复', '数据', '打开备份中心，后续修改仍需原界面确认', 'backup restore 备份 恢复', 'overlay', 'backup'],
  ['trash', '回收站', '数据', '查看回收站，不自动恢复或永久删除', 'trash recycle 删除', 'workspace', 'trash'],
  ['appearance', '主题方案中心', '设置', '预览或编辑本机外观方案', 'theme appearance 颜色 皮肤', 'settings', 'appearance'],
  ['shortcuts', '快捷键管理', '设置', '查找和配置既有快捷键，不抢占自定义组合键', 'shortcut keyboard help 帮助', 'overlay', 'shortcuts'],
  ['settings', '设置与诊断', '设置', '查看本机设置和诊断信息', 'settings diagnostics 偏好', 'workspace', 'settings'],
]
export const LOCAL_ACTIONS = Object.freeze(entries.map(([id, label, category, description, keywords, kind, target]) => Object.freeze({ id, label, category, description, keywords, kind, target })))
export const LOCAL_ACTION_CATEGORIES = Object.freeze(['全部', '写作', '查找', '整理', '数据', '设置'])
export const LOCAL_ACTION_QUERY_LIMIT = 100
export function findLocalAction(id) { return LOCAL_ACTIONS.find(action => action.id === id) || null }
export function filterLocalActions(query = '', category = '全部') {
  if (typeof query !== 'string' || query.length > LOCAL_ACTION_QUERY_LIMIT || !LOCAL_ACTION_CATEGORIES.includes(category)) return []
  const tokens = query.normalize('NFKC').trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return LOCAL_ACTIONS.filter(a => (category === '全部' || a.category === category) && tokens.every(t => `${a.label} ${a.description} ${a.keywords}`.normalize('NFKC').toLowerCase().includes(t)))
}

// Wait for the original owner to accept/cancel. An abort invalidates all late
// callbacks; never replay an action or clear a note draft from this module.
export function executeLocalAction(id, { signal, isCurrent = () => true, navigate, openOverlay, openSettingsTool, onAccepted } = {}) {
  const action = findLocalAction(id)
  if (!action) return Promise.reject(new Error('该操作不在本地功能列表中。'))
  return new Promise((resolve, reject) => {
    let finished = false
    const owns = () => !finished && !signal?.aborted && isCurrent()
    const finish = (result, error) => {
      if (finished) return
      finished = true; signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else {
        // Original-owner acceptance is synchronous with its navigation commit.
        // Notify the palette before React can treat that owned commit as stale.
        // A pending/cancelled/failed invocation never produces this receipt.
        try { if (result?.accepted === true) onAccepted?.(result); resolve(result) }
        catch (notificationError) { reject(notificationError) }
      }
    }
    const abort = () => finish({ accepted: false, reason: 'cancelled' })
    signal?.addEventListener('abort', abort, { once: true })
    if (!owns()) { abort(); return }
    const cancelled = reason => finish({ accepted: false, reason: reason === 'focus-session' ? reason : 'cancelled' })
    const accepted = () => {
      if (!owns()) { abort(); return }
      try {
        if (action.kind === 'settings') {
          if (typeof openSettingsTool !== 'function') throw new Error('本地设置入口暂不可用。')
          openSettingsTool(action.target)
        }
        finish({ accepted: true, id: action.id })
      } catch (error) { finish(null, error) }
    }
    try {
      if (action.kind === 'overlay') {
        if (typeof openOverlay !== 'function') throw new Error('本地功能入口暂不可用。')
        openOverlay(action.target); accepted()
      } else {
        if (typeof navigate !== 'function' || (action.kind === 'settings' && typeof openSettingsTool !== 'function')) throw new Error('本地导航入口暂不可用。')
        navigate(action.kind === 'settings' ? 'settings' : action.target, { shouldChange: owns, afterChange: accepted, onCancel: cancelled })
      }
    } catch (error) { finish(null, error) }
  })
}

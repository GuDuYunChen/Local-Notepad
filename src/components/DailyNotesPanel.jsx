import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '~/services/api'
import './DailyNotesPanel.css'

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export default function DailyNotesPanel({ onSelectFile, onClose }) {
  const [selectedDate, setSelectedDate] = useState(() => localDateKey())
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [openingDate, setOpeningDate] = useState(null)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api('/api/files')
      const dailyNotes = (Array.isArray(list) ? list : [])
        .filter(f => !f.is_folder && /^\d{4}-\d{2}-\d{2}$/.test(f.title))
        .sort((a, b) => b.title.localeCompare(a.title))
      setNotes(dailyNotes)
    } catch (e) {
      console.error('加载每日笔记失败', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  const openDailyNote = useCallback(async (date) => {
    setOpeningDate(date)
    try {
      const res = await api(`/api/files/daily/${date}`)
      if (res?.file) onSelectFile?.(res.file)
    } catch (e) {
      console.error('打开每日笔记失败', e)
    } finally {
      setOpeningDate(null)
    }
  }, [onSelectFile])

  const selected = useMemo(() => parseDateKey(selectedDate), [selectedDate])
  const todayKey = localDateKey()

  const calendarDays = useMemo(() => {
    const year = selected.getFullYear()
    const month = selected.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const days = []

    for (let i = 0; i < firstDay.getDay(); i++) days.push(null)

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d)
      const dateStr = localDateKey(date)
      days.push({
        date: d,
        dateStr,
        hasNote: notes.some(n => n.title === dateStr),
        isToday: dateStr === todayKey,
      })
    }

    return days
  }, [selected, notes, todayKey])

  const monthLabel = useMemo(() => (
    selected.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  ), [selected])

  const moveMonth = (delta) => {
    const d = new Date(selected.getFullYear(), selected.getMonth() + delta, 1)
    setSelectedDate(localDateKey(d))
  }

  const goToday = () => {
    const key = localDateKey()
    setSelectedDate(key)
  }

  const recentNotes = notes.slice(0, 14)
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="daily-notes-panel">
      <div className="daily-notes-header daily-workspace-toolbar">
        <div>
          <div className="daily-workspace-eyebrow">Calendar</div>
          <strong>{monthLabel}</strong>
        </div>
        <div className="daily-notes-header-actions">
          <button className="btn small" onClick={() => moveMonth(-1)} aria-label="上个月">‹</button>
          <button className="btn small daily-today-btn" onClick={goToday}>今天</button>
          <button className="btn small" onClick={() => moveMonth(1)} aria-label="下个月">›</button>
          <button className="btn small close-panel-btn" onClick={onClose} title="返回笔记" aria-label="返回笔记">×</button>
        </div>
      </div>

      <div className="daily-workspace-body">
        <section className="calendar-card">
          <div className="calendar-grid">
            {weekDays.map(d => (
              <div key={d} className="calendar-weekday">{d}</div>
            ))}

            {calendarDays.map((day, i) => (
              day === null ? (
                <div key={`empty-${i}`} className="calendar-day empty" />
              ) : (
                <button
                  key={day.dateStr}
                  className={`calendar-day${day.dateStr === selectedDate ? ' selected' : ''}${day.isToday ? ' today' : ''}${day.hasNote ? ' has-note' : ''}`}
                  onClick={() => {
                    setSelectedDate(day.dateStr)
                    void openDailyNote(day.dateStr)
                  }}
                  disabled={openingDate === day.dateStr}
                  aria-label={`${day.dateStr}${day.hasNote ? ' 已有笔记' : ' 创建每日笔记'}`}
                >
                  <span>{day.date}</span>
                  {day.hasNote && <span className="calendar-note-dot" aria-hidden="true" />}
                </button>
              )
            ))}
          </div>

          <div className="calendar-hint">
            点击日期即可打开每日笔记；没有笔记的日期会自动创建。
          </div>
        </section>

        <section className="daily-recent-card">
          <div className="daily-notes-list-header">
            <div>
              <div className="daily-workspace-eyebrow">Recent</div>
              <strong>最近的每日笔记</strong>
            </div>
            <button className="icon-btn" onClick={loadNotes} title="刷新" aria-label="刷新">↻</button>
          </div>

          {loading ? (
            <div className="placeholder">加载中…</div>
          ) : recentNotes.length === 0 ? (
            <div className="empty-state daily-empty-state">
              <div className="empty-title">还没有每日笔记</div>
              <div className="empty-desc">从上面的日历选择一个日期开始记录。</div>
            </div>
          ) : (
            <ul className="daily-recent-list">
              {recentNotes.map(n => (
                <li key={n.id}>
                  <button className="daily-note-item" onClick={() => onSelectFile?.(n)}>
                    <span className="daily-note-date">
                      <strong>{formatDay(n.title)}</strong>
                      <small>{formatWeekday(n.title)}</small>
                    </span>
                    <span className="daily-note-title">{n.title}</span>
                    <span className="daily-note-time">{formatTime(n.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function formatDay(key) {
  const d = parseDateKey(key)
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function formatWeekday(key) {
  return parseDateKey(key).toLocaleDateString('zh-CN', { weekday: 'short' })
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

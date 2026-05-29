import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '~/services/api'
import './DailyNotesPanel.css'

export default function DailyNotesPanel({ onSelectFile, onClose }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date()
    return now.toISOString().slice(0, 10)
  })
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api('/api/files?q=20')
      const dailyNotes = list
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
    loadNotes()
  }, [loadNotes])

  const openDailyNote = useCallback(async (date) => {
    try {
      const res = await api(`/api/files/daily/${date}`)
      if (res.file) {
        onSelectFile?.(res.file)
      }
    } catch (e) {
      console.error('打开每日笔记失败', e)
    }
  }, [onSelectFile])

  const calendarDays = useMemo(() => {
    const now = new Date(selectedDate + 'T00:00:00')
    const year = now.getFullYear()
    const month = now.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startOffset = firstDay.getDay()
    const days = []

    for (let i = 0; i < startOffset; i++) {
      days.push(null)
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const hasNote = notes.some(n => n.title === dateStr)
      days.push({ date: d, dateStr, hasNote, isToday: dateStr === new Date().toISOString().slice(0, 10) })
    }
    return days
  }, [selectedDate, notes])

  const monthLabel = useMemo(() => {
    const d = new Date(selectedDate + 'T00:00:00')
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  }, [selectedDate])

  const prevMonth = () => {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setMonth(d.getMonth() - 1)
    setSelectedDate(d.toISOString().slice(0, 10))
  }

  const nextMonth = () => {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setMonth(d.getMonth() + 1)
    setSelectedDate(d.toISOString().slice(0, 10))
  }

  const weekDays = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="daily-notes-panel">
      <div className="daily-notes-header">
        <span>每日笔记</span>
        <div className="daily-notes-header-actions">
          <button className="btn small" onClick={prevMonth} aria-label="上个月">◀</button>
          <button className="btn small" onClick={nextMonth} aria-label="下个月">▶</button>
          <button className="btn small close-panel-btn" onClick={onClose} title="关闭">×</button>
        </div>
      </div>
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
                openDailyNote(day.dateStr)
              }}
              aria-label={`${day.dateStr}${day.hasNote ? ' 已有笔记' : ''}`}
            >
              {day.date}
            </button>
          )
        ))}
      </div>
      <div className="daily-notes-list">
        <div className="daily-notes-list-header">
          <span>历史笔记</span>
          <button className="btn small" onClick={loadNotes} title="刷新">↻</button>
        </div>
        {loading ? (
          <div className="placeholder">加载中…</div>
        ) : notes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-desc">点击日历创建每日笔记</div>
          </div>
        ) : (
          <ul>
            {notes.map(n => (
              <li key={n.id} className="daily-note-item" onClick={() => onSelectFile?.(n)}>
                <span className="daily-note-title">{n.title}</span>
                <span className="daily-note-time">{formatTime(n.updated_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

import { useState, useRef, useEffect } from 'react'
import {
  useDailySettings,
  useDefaultSetting,
  useSetDailyHours,
  useClearDailyHours,
} from '@/hooks/useDailySettings'
import { Button } from '@/components/ui/Button'

interface DailyHoursEditorProps {
  date: string
}

export function DailyHoursEditor({ date }: DailyHoursEditorProps) {
  const { data: settings = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const setHours = useSetDailyHours()
  const clearHours = useClearDailyHours()

  const exact = settings.find((s) => s.date === date)
  const def = defaultSetting?.available_hours ?? 6
  const current = exact?.available_hours ?? def

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(current))
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开编辑时聚焦
  useEffect(() => {
    if (editing) {
      setDraft(String(current))
      // 等下一帧 focus，避免和 autoFocus 冲突
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  function commit() {
    const v = parseFloat(draft)
    if (Number.isNaN(v) || v < 0 || v > 24) {
      setEditing(false)
      return
    }
    setSaving(true)
    // 始终写入"今日专属"覆盖，而不是改默认值
    // 这样可以只影响当天，不会改变其他天
    setHours
      .mutateAsync({ date, hours: v })
      .catch(() => {})
      .finally(() => {
        setSaving(false)
        setEditing(false)
      })
  }

  function cancel() {
    setEditing(false)
    setDraft(String(current))
  }

  if (!editing) {
    const isOverride = exact !== undefined
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`inline-flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-gray-100 ${
          isOverride ? 'text-orange-700' : 'text-gray-600 hover:text-gray-900'
        }`}
        title={isOverride ? `已临时调整（默认 ${def}h）` : `使用默认 ${def}h`}
      >
        <span>⏰</span>
        <span>
          今日可用 <b className="tabular-nums">{current}h</b>
        </span>
        {isOverride && (
          <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">
            临时 (默认 {def}h)
          </span>
        )}
        {!isOverride && <span className="text-xs text-gray-400">点击修改</span>}
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-2 bg-white border border-gray-300 rounded-md px-2 py-1">
      <span className="text-sm text-gray-600">今日可用</span>
      <input
        ref={inputRef}
        type="number"
        step="0.5"
        min="0"
        max="24"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        className="w-24 px-2 py-1 text-sm border border-gray-300 rounded tabular-nums"
        disabled={saving}
      />
      <span className="text-sm text-gray-600">小时</span>
      <Button size="sm" onClick={commit} disabled={saving}>
        {saving ? '保存中…' : '确定'}
      </Button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        className="text-xs text-gray-500 hover:text-gray-700 px-1"
      >
        取消
      </button>
      {exact && (
        <button
          type="button"
          onClick={async () => {
            await clearHours.mutateAsync(date)
            setEditing(false)
          }}
          disabled={saving}
          className="text-xs text-gray-400 hover:text-red-500 px-1"
        >
          清除
        </button>
      )}
    </div>
  )
}

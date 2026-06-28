import { useState, useEffect } from 'react'
import { useUpdateSubTask } from '@/hooks/useSubTasks'
import type { SubTask, Category } from '@/lib/types'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface ProgressUpdaterProps {
  subTask: SubTask
  category: Category | undefined
  compact?: boolean
}

/**
 * 进度更新器：步进按钮 + 直接输入
 * 仅用于 finite 任务（recurring 没有"完成量"概念）
 */
export function ProgressUpdater({ subTask, category, compact }: ProgressUpdaterProps) {
  const [draft, setDraft] = useState(String(subTask.completed_amount))
  const [savedHint, setSavedHint] = useState(false)
  const updateMut = useUpdateSubTask()

  useEffect(() => {
    setDraft(String(subTask.completed_amount))
  }, [subTask.completed_amount])

  // recurring 任务不应该用这个组件
  if (subTask.kind === 'recurring') {
    return (
      <span className="text-xs text-gray-500 italic">
        每天 {subTask.daily_hours}h，无需追踪
      </span>
    )
  }

  const total = subTask.total_amount ?? 0
  const stepSize = 1 // 整数步长，去掉小数
  const unit = category?.unit_label ?? ''

  async function commit(value: number) {
    const clamped = Math.max(0, Math.min(total, value))
    if (clamped === subTask.completed_amount) return
    const status = clamped >= total ? 'completed' : 'active'
    await updateMut.mutateAsync({
      id: subTask.id,
      patch: { completed_amount: clamped, status },
    })
    setSavedHint(true)
    setTimeout(() => setSavedHint(false), 1200)
  }

  function step(delta: number) {
    const next = parseFloat(draft || '0') + delta
    setDraft(String(Math.max(0, Math.min(total, next))))
  }

  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'w-full'}`}>
      <div className="flex items-center border border-gray-300 rounded-md overflow-hidden">
        <button
          type="button"
          onClick={() => step(-stepSize)}
          className="px-2 py-1 text-gray-600 hover:bg-gray-100"
          aria-label="减少"
        >
          −
        </button>
        <Input
          name="progress"
          type="number"
          step="1"
          min="0"
          max={total}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(parseInt(draft || '0', 10))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(parseInt(draft || '0', 10))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="!py-1 !px-2 !w-20 !border-0 !rounded-none text-center"
        />
        <button
          type="button"
          onClick={() => step(stepSize)}
          className="px-2 py-1 text-gray-600 hover:bg-gray-100"
          aria-label="增加"
        >
          +
        </button>
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap">
        / {total} {unit}
      </span>
      {!compact && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => commit(parseInt(draft || '0', 10))}
          disabled={updateMut.isPending}
        >
          {updateMut.isPending ? '保存…' : '保存'}
        </Button>
      )}
      {savedHint && <span className="text-xs text-green-600">已保存</span>}
    </div>
  )
}

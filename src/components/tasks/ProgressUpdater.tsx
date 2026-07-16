import type { SubTask, Category } from '@/lib/types'

interface ProgressUpdaterProps {
  subTask: SubTask
  category: Category | undefined
  compact?: boolean
}

/**
 * 进度显示（只读）
 * 完成量现在通过 daily_plan_entries.actual_amount 追踪，DB trigger 自动聚合到 sub_tasks.completed_amount
 * 之前用户可以在这里手动修改总量，现在统一在日历视图（DayDetailDrawer）按天记录实际完成
 */
export function ProgressUpdater({ subTask, compact, category: _category }: ProgressUpdaterProps) {
  if (subTask.kind === 'recurring') {
    return (
      <span className="text-xs text-gray-500 italic">
        每天 {subTask.daily_hours}h，无需追踪
      </span>
    )
  }

  const total = subTask.total_amount ?? 0
  const done = subTask.completed_amount ?? 0

  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'w-full'}`}>
      <div className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700 bg-gray-50 rounded-md">
        <span className="font-medium">{done.toFixed(0)}</span>
        <span className="text-gray-400">/</span>
        <span className="text-gray-600">{total.toFixed(0)}</span>
      </div>
      {!compact && (
        <span className="text-xs text-gray-500">在日历视图按天记录实际完成</span>
      )}
    </div>
  )
}
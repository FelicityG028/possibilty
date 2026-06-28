import { useState, useMemo, useRef, useEffect } from 'react'
import { useDailyPlanEntries } from '@/hooks/useDailyPlan'
import { useSubTasks, useUpdateSubTask } from '@/hooks/useSubTasks'
import { useCategories } from '@/hooks/useCategories'
import { useSetDailyActual } from '@/hooks/useDailyActual'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/Button'
import { OverflowDialog } from './OverflowDialog'
import { format } from 'date-fns'
import {
  getAvailableHoursForDate,
  useDailySettings,
  useDefaultSetting,
} from '@/hooks/useDailySettings'
import { getTodayProgress } from '@/lib/dailyProgress'

interface DayDetailDrawerProps {
  date: string
  onClose: () => void
}

export function DayDetailDrawer({ date, onClose }: DayDetailDrawerProps) {
  const { data: entries = [] } = useDailyPlanEntries()
  const { data: tasks = [] } = useSubTasks()
  const { data: categories = [] } = useCategories()
  const { data: settings = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const updateMut = useUpdateSubTask()
  const setActual = useSetDailyActual()
  const [showOverflow, setShowOverflow] = useState(false)

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const dayEntries = entries.filter((e) => e.plan_date === date)
  const available = getAvailableHoursForDate(settings, defaultSetting?.available_hours, date)
  const totalPlanned = dayEntries.reduce((s, e) => s + e.planned_hours, 0)
  const overflow = totalPlanned - available

  async function setActualAmount(taskId: string, amount: number) {
    const task = taskMap.get(taskId)
    if (!task) return
    const entry = dayEntries.find((e) => e.sub_task_id === taskId)
    if (!entry) return

    if (task.kind === 'recurring') {
      const clamped = Math.max(0, Math.min(24, amount))
      await setActual.mutateAsync({
        date,
        subTaskId: taskId,
        actualHours: clamped,
      })
    } else {
      const sumBefore = entries
        .filter((e) => e.sub_task_id === taskId && e.plan_date < date)
        .reduce((s, e) => s + e.planned_amount, 0)
      const newCompleted = sumBefore + amount
      const clamped = Math.max(0, Math.min(task.total_amount ?? Infinity, newCompleted))
      const status = clamped >= (task.total_amount ?? Infinity) ? 'completed' : 'active'
      await updateMut.mutateAsync({
        id: taskId,
        patch: { completed_amount: clamped, status },
      })
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-white shadow-xl z-50 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {format(new Date(date), 'yyyy年M月d日')}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              计划 {totalPlanned.toFixed(1)}h / 可用 {available}h
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {overflow > 0 && (
          <div className="mx-5 mt-3 p-3 bg-orange-50 border border-orange-200 rounded-md flex items-start gap-2">
            <span className="text-orange-500">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-orange-900">
                当天任务超出 {overflow.toFixed(1)}h
              </p>
              <p className="text-xs text-orange-700 mt-0.5">建议调整计划或提高学习时长</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setShowOverflow(true)}>
              处理
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {dayEntries.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <p>今天没有计划任务 🎉</p>
              <p className="text-xs mt-1">休息或自由复习吧</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dayEntries.map((e) => {
                const task = taskMap.get(e.sub_task_id)
                if (!task) return null
                const cat = catMap.get(task.category_id)
                const isRecurring = task.kind === 'recurring'
                const todayProgress = getTodayProgress(task, date, entries)
                return (
                  <div
                    key={e.id}
                    className="border border-gray-200 rounded-lg p-3 hover:shadow-sm"
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <span
                        className="w-1 self-stretch rounded-full"
                        style={{ backgroundColor: cat?.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <span>{cat?.icon}</span>
                          <span>{cat?.name}</span>
                          {isRecurring && (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 text-[10px]">
                              每日
                            </span>
                          )}
                        </div>
                        <h4 className="font-medium text-gray-900 text-sm truncate">
                          {task.name}
                        </h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {isRecurring ? (
                            <>⏰ 每天 {e.planned_hours.toFixed(1)}h</>
                          ) : (
                            <>今日计划：{e.planned_amount.toFixed(1)}
                              {cat?.unit_label} · {e.planned_hours.toFixed(1)}h</>
                          )}
                        </p>
                      </div>
                    </div>

                    {isRecurring ? (
                      <ActualStepper
                        value={todayProgress?.actualHours ?? 0}
                        max={24}
                        unit="小时"
                        step={1}
                        onChange={(v) => setActualAmount(task.id, v)}
                        onClear={() => setActualAmount(task.id, 0)}
                        plannedLabel={`${e.planned_hours.toFixed(1)}h`}
                        plannedDesc="每天"
                      />
                    ) : todayProgress ? (
                      <>
                        <ProgressBar
                          value={todayProgress.ratio}
                          color={cat?.color}
                          height={6}
                        />
                        <div className="mt-2 text-sm font-medium text-gray-900 tabular-nums">
                          今日 {todayProgress.completed.toFixed(1)} / {todayProgress.planned.toFixed(1)}
                          {cat?.unit_label}
                        </div>
                        <div className="mt-2">
                          <ActualStepper
                            value={todayProgress.completed}
                            max={todayProgress.planned}
                            unit={cat?.unit_label ?? ''}
                            step={1}
                            onChange={(v) => setActualAmount(task.id, v)}
                            onClear={() => setActualAmount(task.id, 0)}
                            plannedLabel={`${todayProgress.planned.toFixed(1)}${cat?.unit_label ?? ''}`}
                            plannedDesc="今日计划"
                          />
                        </div>
                        <div className="mt-2 text-[10px] text-gray-400">
                          累计 {task.completed_amount.toFixed(1)} / {task.total_amount!.toFixed(1)}{cat?.unit_label}
                        </div>
                      </>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {showOverflow && (
        <OverflowDialog
          date={date}
          onClose={() => setShowOverflow(false)}
        />
      )}
    </>
  )
}

/**
 * 实际完成数输入器：数字 input + +/− 按钮
 * - 用户可点击 +/− 按钮（步长 = step）
 * - 用户也可直接在 input 里输入数字，回车或失焦时提交
 * - 显示保留 1 位小数
 */
interface ActualStepperProps {
  value: number
  max: number
  unit: string
  step: number
  onChange: (v: number) => void | Promise<void>
  onClear: () => void | Promise<void>
  plannedLabel: string
  plannedDesc: string
}

function ActualStepper({
  value,
  max,
  step,
  onChange,
  onClear,
  plannedLabel,
  plannedDesc,
}: ActualStepperProps) {
  const [draft, setDraft] = useState(value.toFixed(1))
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value.toFixed(1))
  }, [value])

  async function commit() {
    const v = parseFloat(draft)
    if (Number.isNaN(v) || v < 0) {
      setDraft(value.toFixed(1))
      return
    }
    const clamped = Math.min(max, v)
    if (Math.abs(clamped - value) < 0.05) return
    setSaving(true)
    try {
      await onChange(clamped)
    } finally {
      setSaving(false)
    }
  }

  function adjust(delta: number) {
    const next = Math.max(0, Math.min(max, value + delta))
    setDraft(next.toFixed(1))
    void onChange(next)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500">实际：</span>
      <div className="flex items-center border border-gray-300 rounded overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
        <button
          type="button"
          onClick={() => adjust(-step)}
          className="px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-100"
          disabled={saving}
        >
          −
        </button>
        <input
          ref={inputRef}
          type="number"
          step="1"
          min="0"
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
              inputRef.current?.blur()
            }
            if (e.key === 'Escape') {
              setDraft(value.toFixed(1))
              inputRef.current?.blur()
            }
          }}
          className="px-2 py-0.5 text-sm tabular-nums w-16 text-center border-x border-gray-300 focus:outline-none"
          disabled={saving}
        />
        <button
          type="button"
          onClick={() => adjust(step)}
          className="px-2 py-0.5 text-sm text-gray-600 hover:bg-gray-100"
          disabled={saving}
        >
          +
        </button>
      </div>
      <span className="text-xs text-gray-500">
        / {plannedLabel} <span className="text-gray-400">({plannedDesc})</span>
      </span>
      <button
        type="button"
        onClick={() => void onClear()}
        className="text-xs text-gray-500 hover:text-gray-700"
        disabled={saving}
      >
        清除
      </button>
    </div>
  )
}

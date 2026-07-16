import { useState, useMemo, useRef, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useDailyPlanEntries } from '@/hooks/useDailyPlan'
import { useSubTasks } from '@/hooks/useSubTasks'
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
import { getTodayProgress, getDayCompletion } from '@/lib/dailyProgress'
import { DailyHoursEditor } from './DailyHoursEditor'

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
  const setActual = useSetDailyActual()
  const qc = useQueryClient()
  const [showOverflow, setShowOverflow] = useState(false)

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const dayEntries = entries.filter((e) => e.plan_date === date)
  const available = getAvailableHoursForDate(settings, defaultSetting?.available_hours, date)
  const totalPlanned = dayEntries.reduce((s, e) => s + e.planned_hours, 0)
  const overflow = totalPlanned - available

  // 当天已完成小时（从 plan 中各任务的 actual 累加）
  const dayComp = getDayCompletion(date, tasks, entries)
  const dayActual = dayComp.actual_hours

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
      // 写入 entry.actual_amount（实际完成量），DB trigger 会自动聚合到 sub_tasks.completed_amount
      // 不再基于 planned_amount 累加（避免计划变化影响已完成量）
      const clamped = Math.max(0, Math.min(task.total_amount ?? Infinity, amount))
      await supabase
        .from('daily_plan_entries')
        .update({ actual_amount: clamped })
        .eq('plan_date', date)
        .eq('sub_task_id', taskId)
      // 刷新 task query（让进度条更新）
      qc.invalidateQueries({ queryKey: ['sub_tasks'] })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    }
  }

  const isRestDay = available === 0

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-white shadow-xl z-50 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {format(new Date(date), 'yyyy年M月d日')}
              {isRestDay && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: '#EDBCDC', color: '#111111' }}
                >
                  休息日
                </span>
              )}
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

        {/* 设定今日学习时间（0 = 休息日） */}
        <div
          className="px-5 py-2 flex items-center justify-between"
          style={{ borderBottom: '1.5px dashed #111111' }}
        >
          <span className="text-xs" style={{ color: '#111111' }}>
            设定学习时间（0 = 休息日）
          </span>
          <DailyHoursEditor date={date} />
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

        {/* 底部完成进度条（fixed 底部） */}
        <div
          className="px-5 py-3 border-t flex items-center gap-3"
          style={{ borderColor: 'rgba(0,0,0,0.1)' }}
        >
          <span className="text-xs font-medium" style={{ color: '#111111' }}>
            今日完成
          </span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#EEE8DC' }}>
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.min(100, totalPlanned > 0 ? (dayActual / totalPlanned) * 100 : 0)}%`,
                backgroundColor: dayActual > totalPlanned ? '#10b981' : '#BBCAE7',
              }}
            />
          </div>
          <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: '#111111' }}>
            <b>{dayActual.toFixed(1)}</b> / {totalPlanned.toFixed(1)}h
          </span>
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
    // 不再截断到 max，允许超额完成（如 15/10 表达今日超常发挥）
    if (Math.abs(v - value) < 0.05) return
    setSaving(true)
    try {
      await onChange(v)
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
      <div className="flex items-center border border-gray-300 rounded overflow-hidden focus-within:ring-2 focus-within:ring-rose-500">
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

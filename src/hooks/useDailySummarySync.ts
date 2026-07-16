/**
 * 把每天的预期/实际学习时长写入 daily_summary
 *
 * 触发条件：plan / settings / 进度变化时
 *
 * 逻辑：
 *  - expected_hours: 来自 daily_settings 覆盖 或 default_settings
 *  - actual_hours:   所有任务当天的 actual 之和
 *    - recurring 任务：直接读 daily_plan_entries.actual_hours
 *    - finite 任务：基于 cumulative 推导当天完成了多少
 *  - task_count:    当天有计划的任务数
 *  - is_overflow:   plan 总时长 > expected
 */
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSubTasks } from './useSubTasks'
import {
  useDailySettings,
  useDefaultSetting,
  getAvailableHoursForDate,
} from './useDailySettings'
import { useDailyPlanEntries } from './useDailyPlan'
import { generatePlan, todayIso } from '@/lib/planner'
import type { SubTask, DailySetting, DailyPlanEntry } from '@/lib/types'

export function useDailySummarySync() {
  const { data: tasks = [] } = useSubTasks()
  const { data: daily = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const { data: entries = [] } = useDailyPlanEntries()
  const qc = useQueryClient()
  const ready = useRef(false)

  useEffect(() => {
    if (!ready.current) {
      const t = setTimeout(() => {
        ready.current = true
        void syncSummary(
          tasks,
          daily,
          defaultSetting?.available_hours ?? 6,
          entries,
          qc
        )
      }, 500)
      return () => clearTimeout(t)
    }
    void syncSummary(
      tasks,
      daily,
      defaultSetting?.available_hours ?? 6,
      entries,
      qc
    )
  }, [tasks, daily, defaultSetting, entries, qc])
}

async function syncSummary(
  tasks: SubTask[],
  daily: DailySetting[],
  defaultHours: number,
  entries: DailyPlanEntry[],
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  const plan = generatePlan(tasks, daily, defaultHours, { startDate: todayIso() })
  if (plan.dates.length === 0) return

  const rows = plan.dates.map((date) => {
    const expected = getAvailableHoursForDate(daily, defaultHours, date)
    const dayEntries = entries.filter((e) => e.plan_date === date)
    const plannedHours = dayEntries.reduce((s, e) => s + e.planned_hours, 0)

    let actualHours = 0
    for (const e of dayEntries) {
      const task = tasks.find((t) => t.id === e.sub_task_id)
      if (!task) continue
      if (task.kind === 'recurring') {
        actualHours += e.actual_hours ?? 0
      } else {
        // finite 任务：今天完成 = entry.actual_amount（独立于计划）
        const todayActual = e.actual_amount ?? 0
        const fraction = e.planned_amount > 0 ? Math.min(1, todayActual / e.planned_amount) : 0
        actualHours += e.planned_hours * fraction
      }
    }

    return {
      date,
      expected_hours: expected,
      actual_hours: actualHours,
      task_count: dayEntries.length,
      is_overflow: plannedHours > expected,
      updated_at: new Date().toISOString(),
    }
  })

  if (rows.length > 0) {
    const { error } = await supabase
      .from('daily_summary')
      .upsert(rows, { onConflict: 'date' })
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[syncSummary] upsert failed:', error)
    }
  }

  qc.invalidateQueries({ queryKey: ['daily_summary'] })
}

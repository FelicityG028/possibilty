/**
 * 把规划引擎的输出同步到 daily_plan_entries 表。
 *
 * 简化设计：任何 sync（基线 / daily_hours 变化 / AI 调整）都直接覆盖 DB。
 * 数据库只管记录"每天每个任务的安排"，不区分是谁写入的。
 * - actual_hours 保留旧的（不覆盖用户实际学习小时）
 * - 单例锁：防止并发 sync
 */
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSubTasks } from './useSubTasks'
import { useDailySettings, useDefaultSetting } from './useDailySettings'
import { generatePlan, todayIso } from '@/lib/planner'
import type { SubTask, DailySetting, DailyPlanEntry } from '@/lib/types'

// 模块级锁：防止并发 sync
let syncing = false

/**
 * 监听任务/设置变化，把 plan 写回 daily_plan_entries。
 * 任何变化（task / daily_hours / default_hours）都触发全量重算 + 覆盖。
 */
export function useDailyPlanSync() {
  const { data: tasks = [] } = useSubTasks()
  const { data: daily = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const qc = useQueryClient()
  const ready = useRef(false)

  useEffect(() => {
    if (!ready.current) {
      const t = setTimeout(() => {
        ready.current = true
        void syncPlan(tasks, daily, defaultSetting?.available_hours ?? 6, qc)
      }, 500)
      return () => clearTimeout(t)
    }
    void syncPlan(tasks, daily, defaultSetting?.available_hours ?? 6, qc)
  }, [tasks, daily, defaultSetting, qc])
}

async function syncPlan(
  tasks: SubTask[],
  daily: DailySetting[],
  defaultHours: number,
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await doSync(tasks, daily, defaultHours, qc)
  } finally {
    syncing = false
  }
}

async function doSync(
  tasks: SubTask[],
  daily: DailySetting[],
  defaultHours: number,
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  const today = todayIso()

  // 抓取所有 today+ entries（用于保留 actual_hours）
  const { data: allExisting } = await supabase
    .from('daily_plan_entries')
    .select('id, plan_date, sub_task_id, actual_hours')
    .gte('plan_date', today)

  const existingByKey = new Map<string, DailyPlanEntry>()
  for (const e of (allExisting ?? []) as DailyPlanEntry[]) {
    existingByKey.set(`${e.plan_date}|${e.sub_task_id}`, e)
  }

  // 写死算法生成 plan
  const plan = generatePlan(tasks, daily, defaultHours, { startDate: today })
  if (plan.dates.length === 0) return

  const newRows: Array<{
    plan_date: string
    sub_task_id: string
    planned_amount: number
    planned_hours: number
    actual_hours: number | null
  }> = []

  for (const d of plan.dates) {
    for (const e of plan.byDate[d].entries) {
      const old = existingByKey.get(`${d}|${e.sub_task_id}`)
      newRows.push({
        plan_date: d,
        sub_task_id: e.sub_task_id,
        planned_amount: e.planned_amount,
        planned_hours: e.planned_hours,
        // 保留 actual_hours（用户实际学习小时）
        actual_hours: old?.actual_hours ?? null,
      })
    }
  }

  if (newRows.length === 0) return

  const { error: rpcErr } = await supabase.rpc('sync_daily_plan', {
    p_entries: newRows,
    p_delete_from: today,
  })
  if (rpcErr) {
    // eslint-disable-next-line no-console
    console.error('[syncPlan] RPC failed:', rpcErr)
    return
  }

  qc.invalidateQueries({ queryKey: ['daily_plan'] })
}
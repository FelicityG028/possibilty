/**
 * 把规划引擎的输出同步到 daily_plan_entries 表。
 *
 * 关键设计：
 * 1. 只同步今天及未来日期（过去日期冻结）
 * 2. 用 Supabase RPC（事务性 delete + upsert），避免 409/500
 * 3. 单例锁：防止并发 sync
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
 * 关键：过去日期冻结，今天和未来日期重算。
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
  const plan = generatePlan(tasks, daily, defaultHours, { startDate: today })
  if (plan.dates.length === 0) return

  // ★ 关键：只同步今天及未来日期，过去日期不动
  const futureDates = plan.dates.filter((d) => d >= today)
  if (futureDates.length === 0) return

  // 1. 抓取已有 entries（用于保留 actual_hours）
  const { data: existing, error: existingErr } = await supabase
    .from('daily_plan_entries')
    .select('*')
    .in('plan_date', futureDates)
  if (existingErr) {
    // eslint-disable-next-line no-console
    console.error('[syncPlan] fetch existing failed:', existingErr)
    return
  }

  // 2. 构建新行（保留旧 actual_hours）
  const existingByKey = new Map<string, DailyPlanEntry>()
  for (const e of existing ?? []) {
    existingByKey.set(`${e.plan_date}|${e.sub_task_id}`, e as DailyPlanEntry)
  }

  const newRows: Array<{
    plan_date: string
    sub_task_id: string
    planned_amount: number
    planned_hours: number
    actual_hours: number | null
  }> = []
  for (const d of futureDates) {
    for (const e of plan.byDate[d].entries) {
      const key = `${d}|${e.sub_task_id}`
      const old = existingByKey.get(key)
      newRows.push({
        plan_date: d,
        sub_task_id: e.sub_task_id,
        planned_amount: e.planned_amount,
        planned_hours: e.planned_hours,
        actual_hours: old?.actual_hours ?? null,
      })
    }
  }

  // 3. 用 RPC 一次性完成：删除过期 + upsert 新数据（事务内）
  const { data: rpcResult, error: rpcErr } = await supabase.rpc('sync_daily_plan', {
    p_entries: newRows,
    p_delete_from: today,
  })
  if (rpcErr) {
    // eslint-disable-next-line no-console
    console.error('[syncPlan] RPC failed:', rpcErr)
    return
  }
  // eslint-disable-next-line no-console
  console.log('[syncPlan] OK', rpcResult)

  qc.invalidateQueries({ queryKey: ['daily_plan'] })
}

/**
 * 把规划引擎的输出同步到 daily_plan_entries 表。
 *
 * 关键设计：
 * 1. 过去日期冻结（不动）
 * 2. ★ 今天锁定：今天的 plan 不被 user 进度影响
 * 3. 明天+动态：根据 user 当前进度调整
 * 4. 用 Supabase RPC（事务性 delete + upsert）
 * 5. 单例锁：防止并发 sync
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
 * 关键：今天锁定，明天+重算。
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

  // 抓取所有 today+future entries
  const { data: existing, error: existingErr } = await supabase
    .from('daily_plan_entries')
    .select('*')
    .in('plan_date', plan.dates)
  if (existingErr) {
    // eslint-disable-next-line no-console
    console.error('[syncPlan] fetch existing failed:', existingErr)
    return
  }

  const existingByKey = new Map<string, DailyPlanEntry>()
  for (const e of existing ?? []) {
    existingByKey.set(`${e.plan_date}|${e.sub_task_id}`, e as DailyPlanEntry)
  }

  // ★ 关键拆分：今天的 plan 保留（不动），明天+的 plan 重算
  const newRows: Array<{
    plan_date: string
    sub_task_id: string
    planned_amount: number
    planned_hours: number
    actual_hours: number | null
  }> = []
  const keysToDelete: string[] = []

  for (const d of plan.dates) {
    if (d === today) {
      // 今天的 plan 完全保留（包括 planned_amount、actual_hours）
      // 不动！
      continue
    }
    // 明天+：用新算的 plan 覆盖
    const entriesForDate = plan.byDate[d].entries
    const newKeysForDate = new Set<string>()

    for (const e of entriesForDate) {
      const key = `${d}|${e.sub_task_id}`
      newKeysForDate.add(key)
      const old = existingByKey.get(key)
      newRows.push({
        plan_date: d,
        sub_task_id: e.sub_task_id,
        planned_amount: e.planned_amount,
        planned_hours: e.planned_hours,
        actual_hours: old?.actual_hours ?? null,
      })
    }

    // 找出明天+的"过期" entries（新 plan 没有但 DB 有）→ 删
    for (const e of existing ?? []) {
      if (e.plan_date !== d) continue
      const key = `${d}|${e.sub_task_id}`
      if (!newKeysForDate.has(key) && e.id) {
        keysToDelete.push(e.id)
      }
    }
  }

  // 删除明天+的过期 entries
  if (keysToDelete.length > 0) {
    const { error: delErr } = await supabase
      .from('daily_plan_entries')
      .delete()
      .in('id', keysToDelete)
    if (delErr) {
      // eslint-disable-next-line no-console
      console.error('[syncPlan] delete failed:', delErr)
    }
  }

  // Upsert 明天+的新 plan
  if (newRows.length > 0) {
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
  }

  qc.invalidateQueries({ queryKey: ['daily_plan'] })
}

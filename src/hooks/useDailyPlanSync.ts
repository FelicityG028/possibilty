/**
 * 把规划引擎的输出同步到 daily_plan_entries 表。
 *
 * 关键设计：
 * 1. 过去日期冻结（不动）
 * 2. ★ 触发源区分：
 *    - task 进度变化 → 锁定 today（user 今天的 plan 不变）
 *    - daily_settings 变化 → 解锁 today（让 today 的 plan 跟着新可用时间调整）
 * 3. 明天+根据 user 进度动态算
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
 * 关键：
 *   - daily/defaultSetting 变化 → 完整 sync（覆盖 today + future）
 *   - 只 tasks 变化 → 锁定 today（保留 user 已看到的今天的 plan）
 */
export function useDailyPlanSync() {
  const { data: tasks = [] } = useSubTasks()
  const { data: daily = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const qc = useQueryClient()
  const ready = useRef(false)

  // 跟踪前一次的值，判断这次变化来自哪里
  const prevTasks = useRef(tasks)
  const prevDaily = useRef(daily)
  const prevDefault = useRef(defaultSetting)

  useEffect(() => {
    if (!ready.current) {
      const t = setTimeout(() => {
        ready.current = true
        prevTasks.current = tasks
        prevDaily.current = daily
        prevDefault.current = defaultSetting
        void syncPlan(tasks, daily, defaultSetting?.available_hours ?? 6, qc, false)
      }, 500)
      return () => clearTimeout(t)
    }

    // 判断变化来源
    const tasksChanged = prevTasks.current !== tasks
    const dailyChanged =
      prevDaily.current !== daily || prevDefault.current !== defaultSetting

    prevTasks.current = tasks
    prevDaily.current = daily
    prevDefault.current = defaultSetting

    // 规则：
    //   - daily 变化 → 解锁 today（让今天的 plan 跟着新 available 调整）
    //   - 只 task 变化 → 锁定 today
    const lockToday = tasksChanged && !dailyChanged
    void syncPlan(tasks, daily, defaultSetting?.available_hours ?? 6, qc, lockToday)
  }, [tasks, daily, defaultSetting, qc])
}

async function syncPlan(
  tasks: SubTask[],
  daily: DailySetting[],
  defaultHours: number,
  qc: ReturnType<typeof useQueryClient>,
  lockToday: boolean
): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await doSync(tasks, daily, defaultHours, qc, lockToday)
  } finally {
    syncing = false
  }
}

async function doSync(
  tasks: SubTask[],
  daily: DailySetting[],
  defaultHours: number,
  qc: ReturnType<typeof useQueryClient>,
  lockToday: boolean
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

  const newRows: Array<{
    plan_date: string
    sub_task_id: string
    planned_amount: number
    planned_hours: number
    actual_hours: number | null
  }> = []
  const keysToDelete: string[] = []

  for (const d of plan.dates) {
    // ★ 锁定 today 时跳过（保留 user 已看到的今天的 plan）
    if (d === today && lockToday) {
      continue
    }

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

    // 删除 DB 中有但新 plan 没有的 entries
    for (const e of existing ?? []) {
      if (e.plan_date !== d) continue
      const key = `${d}|${e.sub_task_id}`
      if (!newKeysForDate.has(key) && e.id) {
        keysToDelete.push(e.id)
      }
    }
  }

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
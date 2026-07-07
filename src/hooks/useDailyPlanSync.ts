/**
 * 把规划引擎的输出同步到 daily_plan_entries 表。
 *
 * v3: 纯写死算法
 *   - sync 只用 generatePlan（planner.ts）
 *   - AI 调整是独立功能（AIAdjustBox），不影响基线 sync
 *   - 失败回退：写死算法失败 → 静默忽略
 *   - 单例锁：防止并发 sync
 *
 * v2 历史：曾尝试 AI agent 生成 plan，但不稳定（输出格式错）。
 *     AI 已改为"调整 plan"模式（AIAdjustBox），sync 保持纯写死。
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSubTasks } from './useSubTasks'
import { useDailySettings, useDefaultSetting } from './useDailySettings'
import { useCategories } from './useCategories'
import { generatePlan, todayIso } from '@/lib/planner'
import type { SubTask, DailySetting, DailyPlanEntry, Category } from '@/lib/types'

// 模块级锁：防止并发 sync
let syncing = false

// 模块级订阅：UI 监听 sync 状态
const syncListeners = new Set<() => void>()
let syncState: {
  isRunning: boolean
  lastError: string | null
} = {
  isRunning: false,
  lastError: null,
}

function setSyncState(patch: Partial<typeof syncState>) {
  syncState = { ...syncState, ...patch }
  syncListeners.forEach((l) => l())
}

function subscribeSync(listener: () => void) {
  syncListeners.add(listener)
  return () => {
    syncListeners.delete(listener)
  }
}

/**
 * 组件可以订阅 sync 状态
 */
export function useSyncStatus() {
  return useSyncExternalStore(
    subscribeSync,
    () => syncState,
    () => syncState
  )
}

/**
 * 监听任务/设置变化，把 plan 写回 daily_plan_entries。
 * 关键：
 *   - daily/defaultSetting 变化 → 解锁 today
 *   - 只 tasks 变化 → 锁定 today
 *   - 完全用写死算法（generatePlan），无 AI 介入
 */
export function useDailyPlanSync() {
  const { data: tasks = [] } = useSubTasks()
  const { data: daily = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const { data: categories = [] } = useCategories()
  const qc = useQueryClient()
  const ready = useRef(false)

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
        void syncPlan(tasks, daily, categories, defaultSetting?.available_hours ?? 6, qc, false)
      }, 500)
      return () => clearTimeout(t)
    }

    const tasksChanged = prevTasks.current !== tasks
    const dailyChanged =
      prevDaily.current !== daily || prevDefault.current !== defaultSetting

    prevTasks.current = tasks
    prevDaily.current = daily
    prevDefault.current = defaultSetting

    const lockToday = tasksChanged && !dailyChanged
    void syncPlan(tasks, daily, categories, defaultSetting?.available_hours ?? 6, qc, lockToday)
  }, [tasks, daily, defaultSetting, categories, qc])
}

interface NewRow {
  plan_date: string
  sub_task_id: string
  planned_amount: number
  planned_hours: number
  actual_hours: number | null
}

async function syncPlan(
  tasks: SubTask[],
  daily: DailySetting[],
  _categories: Category[],
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
  setSyncState({ isRunning: true, lastError: null })

  // 抓取所有 today+future entries
  const { data: allExisting } = await supabase
    .from('daily_plan_entries')
    .select('*')
    .gte('plan_date', today)
    .order('plan_date', { ascending: true })

  const existingByKey = new Map<string, DailyPlanEntry>()
  for (const e of (allExisting ?? []) as DailyPlanEntry[]) {
    existingByKey.set(`${e.plan_date}|${e.sub_task_id}`, e)
  }

  // 写死算法生成 plan
  const plan = generatePlan(tasks, daily, defaultHours, { startDate: today })
  console.log('[sync] DEBUG:', {
    today,
    taskCount: tasks.length,
    planDateCount: plan.dates.length,
    entryCount: Object.values(plan.byDate).reduce((s, d) => s + d.entries.length, 0),
    existingCount: (allExisting ?? []).length,
    existingAdjustedCount: (allExisting ?? []).filter((e) => e.is_user_adjusted).length,
  })
  if (plan.dates.length === 0) {
    setSyncState({ isRunning: false })
    return
  }

  const newRows: NewRow[] = []
  for (const d of plan.dates) {
    if (d === today && lockToday) continue
    for (const e of plan.byDate[d].entries) {
      const old = existingByKey.get(`${d}|${e.sub_task_id}`)
      newRows.push({
        plan_date: d,
        sub_task_id: e.sub_task_id,
        planned_amount: e.planned_amount,
        planned_hours: e.planned_hours,
        actual_hours: old?.actual_hours ?? null,
      })
    }
  }

  // ★ 关键：跳过用户调整过的 entries（不被新 plan 覆盖）
  // 把"老的调整 entry"重新加进 newRows（保留旧值，不被 generatePlan 覆盖）
  const adjustedEntries = new Set<string>()
  for (const e of (allExisting ?? []) as DailyPlanEntry[]) {
    if (e.is_user_adjusted && e.id) {
      const key = `${e.plan_date}|${e.sub_task_id}`
      if (!newRows.some((r) => `${r.plan_date}|${r.sub_task_id}` === key)) {
        // generatePlan 没产出这个 entry（被新算法改了），保留旧的
        newRows.push({
          plan_date: e.plan_date,
          sub_task_id: e.sub_task_id,
          planned_amount: e.planned_amount,
          planned_hours: e.planned_hours,
          actual_hours: e.actual_hours ?? null,
        })
        adjustedEntries.add(key)
      }
    }
  }

  // 删除"过期" entries（DB 有但新 plan 没有，且不是调整过的）
  const newKeys = new Set(newRows.map((r) => `${r.plan_date}|${r.sub_task_id}`))
  const keysToDelete: string[] = []
  for (const e of (allExisting ?? []) as DailyPlanEntry[]) {
    if (e.plan_date === today && lockToday) continue
    if (e.is_user_adjusted) {
      // 调整过的永不删（保留 AI 调整的结果）
      continue
    }
    if (!newKeys.has(`${e.plan_date}|${e.sub_task_id}`) && e.id) {
      keysToDelete.push(e.id)
    }
  }
  console.log('[sync] deletion plan:', {
    keysToDeleteCount: keysToDelete.length,
    is_adjusted_total: (allExisting ?? []).filter((e) => e.is_user_adjusted).length,
  })

  if (keysToDelete.length > 0) {
    await supabase.from('daily_plan_entries').delete().in('id', keysToDelete)
  }

  console.log('[sync] deleting/inserting:', {
    keysToDeleteCount: keysToDelete.length,
    newRowsCount: newRows.length,
  })

  if (newRows.length > 0) {
    const { error: rpcErr } = await supabase.rpc('sync_daily_plan', {
      p_entries: newRows,
      p_delete_from: today,
    })
    console.log('[sync] RPC result:', rpcErr ? `FAILED: ${rpcErr.message}` : 'success')
    if (rpcErr) {
      console.error('[syncPlan] RPC failed:', rpcErr)
    }
  }

  qc.invalidateQueries({ queryKey: ['daily_plan'] })
  setSyncState({ isRunning: false })
}

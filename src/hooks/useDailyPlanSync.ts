/**
 * 把规划引擎的输出同步到 daily_plan_entries 表。
 *
 * 关键设计：
 *   - 加 actual_amount → 只更新完成量，不重算 plan（避免循环）
 *   - 修改任务/默认学习时间 → mount 时跑一次
 *   - 重新排布 → 手动调用 syncPlanNow() 或定时 12 点自动重排
 *
 * 数据库只管记录"每天每个任务的安排"，不区分是谁写入的。
 * - actual_hours / actual_amount 保留旧的（不覆盖用户实际学习）
 * - 单例锁：防止并发 sync
 */
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSubTasks } from './useSubTasks'
import { useDailySettings, useDefaultSetting } from './useDailySettings'
import { generatePlan, todayIso, toIso, addDays, parseIso } from '../lib/planner'
import type { SubTask, DailySetting, DailyPlanEntry } from '../lib/types'

// 模块级锁：防止并发 sync
let syncing = false

// 模块级状态：记录上次自动重排日期（避免一天多次重排）
let lastAutoRegenDate: string | null = null
// 自动重排触发时间（24h 制小时，默认 12 点）
const AUTO_REGEN_HOUR = 12

/**
 * 检查当前时间是否需要自动重排：
 *   - 当前小时 >= AUTO_REGEN_HOUR
 *   - 今天还没重排过（lastAutoRegenDate !== today）
 */
function shouldAutoRegenerate(): boolean {
  const now = new Date()
  if (now.getHours() < AUTO_REGEN_HOUR) return false
  const today = now.toISOString().slice(0, 10)
  return lastAutoRegenDate !== today
}

function markAutoRegenerated() {
  lastAutoRegenDate = new Date().toISOString().slice(0, 10)
}

/**
 * 监听 mount 时的 tasks / daily 变化，只在 mount 跑一次
 *   日常操作（actual_amount）不会触发重算
 *   用户可手动调 syncPlanNow() 触发重算（"重新排布"按钮）
 *
 * 同时启动定时检查：每天 12 点（用户访问时）自动重排
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
  }, [tasks, daily, defaultSetting, qc])

  // 每天 12 点自动重排：每 5 分钟检查一次时间
  useEffect(() => {
    const checkAndRun = () => {
      if (shouldAutoRegenerate()) {
        markAutoRegenerated()
        void syncPlan(tasks, daily, defaultSetting?.available_hours ?? 6, qc)
      }
    }
    // 立即检查一次（如果今天还没重排过且已经过了 12 点）
    checkAndRun()
    const interval = setInterval(checkAndRun, 5 * 60 * 1000) // 5 分钟
    return () => clearInterval(interval)
  }, [tasks, daily, defaultSetting, qc])
}

/**
 * 手动触发重新排布（用户点"重新排布"按钮）
 */
export async function syncPlanNow(
  tasks: SubTask[],
  daily: DailySetting[],
  defaultHours: number,
  qc: ReturnType<typeof useQueryClient>
): Promise<void> {
  await syncPlan(tasks, daily, defaultHours, qc)
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
  // ★ 关键：今天和过去的 plan 冻结（保留用户已完成的任务分配）
  //   只有未来日期重排
  const tomorrow = toIso(addDays(parseIso(today), 1))

  // 抓取所有 today+ entries（用于保留 actual_hours 和 actual_amount）
  const { data: allExisting } = await supabase
    .from('daily_plan_entries')
    .select('id, plan_date, sub_task_id, actual_hours, actual_amount')
    .gte('plan_date', today)

  const existingByKey = new Map<string, DailyPlanEntry>()
  for (const e of (allExisting ?? []) as DailyPlanEntry[]) {
    existingByKey.set(`${e.plan_date}|${e.sub_task_id}`, e)
  }

  // 写死算法生成 plan（从明天开始，今天和过去的 plan 冻结）
  const plan = generatePlan(tasks, daily, defaultHours, { startDate: tomorrow })
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
        // 保留 actual_hours（用户实际学习小时），RPC 不覆盖
        actual_hours: old?.actual_hours ?? null,
      })
    }
  }

  if (newRows.length === 0) return

  const { error: rpcErr } = await supabase.rpc('sync_daily_plan', {
    p_entries: newRows,
    p_delete_from: tomorrow, // 只删/改明天+，今天的 plan 冻结
  })
  if (rpcErr) {
    // eslint-disable-next-line no-console
    console.error('[syncPlan] RPC failed:', rpcErr)
    return
  }

  qc.invalidateQueries({ queryKey: ['daily_plan'] })
}
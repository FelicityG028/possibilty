/**
 * 把规划引擎的输出同步到 daily_plan_entries 表。
 *
 * v2: AI Agent 集成
 *   - 优先调后端 /api/agent 端点（Vite proxy 或 Cloudflare Pages Function）
 *   - 后端构造 prompt + 调 OpenAI，避免 API key 暴露到前端
 *   - 失败时 fallback 到写死算法（generatePlan）
 *   - 单例锁：防止并发 sync
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSubTasks } from './useSubTasks'
import { useDailySettings, useDefaultSetting } from './useDailySettings'
import { useCategories } from './useCategories'
import { generatePlan, todayIso } from '@/lib/planner'
import {
  toAgentTasks,
  toDailyHoursMap,
  collectTodayEntries,
  type AgentOutput,
} from '@/lib/plannerAgent'
import type { SubTask, DailySetting, DailyPlanEntry, Category } from '@/lib/types'

// 模块级锁：防止并发 sync
let syncing = false

// 模块级订阅：UI 监听 sync 状态
const syncListeners = new Set<() => void>()
let syncState: {
  isRunning: boolean
  mode: 'idle' | 'agent' | 'fallback'
  lastError: string | null
  lastReasoning: string | null
} = {
  isRunning: false,
  mode: 'idle',
  lastError: null,
  lastReasoning: null,
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

const FORWARD_DAYS = 90 // Agent 只规划未来 90 天

/**
 * 监听任务/设置变化，把 plan 写回 daily_plan_entries。
 * 关键：
 *   - daily/defaultSetting 变化 → 解锁 today
 *   - 只 tasks 变化 → 锁定 today
 *   - 默认尝试 AI agent，失败 fallback 到写死算法
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
  categories: Category[],
  defaultHours: number,
  qc: ReturnType<typeof useQueryClient>,
  lockToday: boolean
): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await doSync(tasks, daily, categories, defaultHours, qc, lockToday)
  } finally {
    syncing = false
  }
}

async function doSync(
  tasks: SubTask[],
  daily: DailySetting[],
  categories: Category[],
  defaultHours: number,
  qc: ReturnType<typeof useQueryClient>,
  lockToday: boolean
): Promise<void> {
  const today = todayIso()
  setSyncState({ isRunning: true, mode: 'agent', lastError: null })

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
  const todayEntries = collectTodayEntries(
    (allExisting ?? []) as DailyPlanEntry[],
    today
  )

  // 尝试 AI agent
  let newRows: NewRow[] = []
  let lastReasoning: string | null = null

  try {
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]))
    const agentTasks = toAgentTasks(tasks, categoryMap)
    if (agentTasks.length > 0) {
      const dailyHours = toDailyHoursMap(daily, defaultHours, today, FORWARD_DAYS)
      const output = await callAgent({
        today,
        dailyHours,
        defaultHours,
        tasks: agentTasks,
        existingToday: todayEntries,
      })
      newRows = output.entries.map((e) => ({
        plan_date: e.plan_date,
        sub_task_id: e.sub_task_id,
        planned_amount: e.planned_amount,
        planned_hours: e.planned_hours,
        actual_hours:
          existingByKey.get(`${e.plan_date}|${e.sub_task_id}`)
            ?.actual_hours ?? null,
      }))
      lastReasoning = output.reasoning
      setSyncState({ mode: 'agent', lastReasoning })
    } else {
      setSyncState({ mode: 'agent', lastReasoning: '无 active 任务' })
    }
  } catch (err) {
    console.warn('[syncPlan] Agent failed, falling back:', err)
    setSyncState({
      mode: 'fallback',
      lastError: err instanceof Error ? err.message : String(err),
    })
    newRows = buildFromHardcoded(
      tasks,
      daily,
      defaultHours,
      today,
      existingByKey,
      lockToday
    )
  }

  // 删除"过期" entries（DB 有但新 plan 没有）
  const newKeys = new Set(newRows.map((r) => `${r.plan_date}|${r.sub_task_id}`))
  const keysToDelete: string[] = []
  for (const e of (allExisting ?? []) as DailyPlanEntry[]) {
    if (e.plan_date === today && lockToday) continue
    if (!newKeys.has(`${e.plan_date}|${e.sub_task_id}`) && e.id) {
      keysToDelete.push(e.id)
    }
  }

  if (keysToDelete.length > 0) {
    await supabase.from('daily_plan_entries').delete().in('id', keysToDelete)
  }

  if (newRows.length > 0) {
    const { error: rpcErr } = await supabase.rpc('sync_daily_plan', {
      p_entries: newRows,
      p_delete_from: today,
    })
    if (rpcErr) {
      console.error('[syncPlan] RPC failed:', rpcErr)
    }
  }

  qc.invalidateQueries({ queryKey: ['daily_plan'] })
  setSyncState({ isRunning: false })
}

/**
 * 调后端 /api/agent 端点
 * 后端构造 prompt + 调 OpenAI
 */
async function callAgent(
  input: Parameters<typeof toAgentTasks>[1] extends never
    ? any
    : any
): Promise<AgentOutput> {
  const resp = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Agent API ${resp.status}: ${errText.slice(0, 200)}`)
  }

  const raw = await resp.json()
  // 直接 validate
  if (!raw || typeof raw !== 'object') throw new Error('Bad response shape')
  if (!Array.isArray(raw.entries)) throw new Error('Missing entries')
  return raw as AgentOutput
}

/**
 * Fallback: 用写死算法
 */
function buildFromHardcoded(
  tasks: SubTask[],
  daily: DailySetting[],
  defaultHours: number,
  today: string,
  existingByKey: Map<string, DailyPlanEntry>,
  lockToday: boolean
): NewRow[] {
  const plan = generatePlan(tasks, daily, defaultHours, { startDate: today })
  if (plan.dates.length === 0) return []

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
  return newRows
}

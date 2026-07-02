/**
 * 任务排程 AI Agent - 调整模式
 * ============================================================================
 * AI 不生成完整 plan（写死算法做这个），而是"调整"已生成的基线 plan。
 *
 * 输入：当前 plan + 任务列表 + 每天学习时间 + 用户的特殊需求
 * 输出：actions 数组（swap / add / remove / set_daily_hours）
 *
 * 失败时回退到基线 plan（由 planner.ts 写死算法生成）
 * ============================================================================
 */

import type { SubTask, DailySetting, DailyPlanEntry } from './types'

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface AdjustmentInput {
  /** 当前日期 YYYY-MM-DD */
  today: string
  /** 当前 plan（基线算法生成的） */
  currentPlan: AdjustmentPlanEntry[]
  /** 任务列表 */
  tasks: AdjustmentTask[]
  /** 每天可用时间 map */
  dailyHours: Record<string, number>
  /** 默认每天学习时间 */
  defaultHours: number
  /** 用户的特殊需求 */
  userRequest: string
}

export interface AdjustmentPlanEntry {
  date: string
  sub_task_id: string
  task_name: string
  planned_amount: number
  planned_hours: number
}

export interface AdjustmentTask {
  id: string
  name: string
  total: number
  completed: number
  deadline: string
  rate: string
}

export type AdjustmentAction =
  /** 两天的某个 task 量互换 */
  | {
      type: 'swap'
      from_date: string
      from_task: string
      to_date: string
      to_task: string
    }
  /** 在某天加 task 量 */
  | {
      type: 'add'
      date: string
      sub_task_id: string
      planned_amount_delta: number
      planned_hours_delta: number
    }
  /** 在某天减 task 量 */
  | {
      type: 'remove'
      date: string
      sub_task_id: string
      planned_amount_delta: number
      planned_hours_delta: number
    }
  /** 改某天可用时间 */
  | { type: 'set_daily_hours'; date: string; hours: number }

export interface AdjustmentOutput {
  actions: AdjustmentAction[]
  reasoning: string
}

// --------------------------------------------------------------------------
// 从 DB 数据构造 AdjustmentInput
// --------------------------------------------------------------------------

/**
 * 把 daily_plan_entries 转成 AdjustmentPlanEntry
 */
export function toAdjustmentPlan(
  entries: DailyPlanEntry[],
  taskMap: Map<string, string>
): AdjustmentPlanEntry[] {
  return entries.map((e) => ({
    date: e.plan_date,
    sub_task_id: e.sub_task_id,
    task_name: taskMap.get(e.sub_task_id) ?? '?',
    planned_amount: e.planned_amount,
    planned_hours: e.planned_hours,
  }))
}

/**
 * 把 sub_tasks 转成 AdjustmentTask
 */
export function toAdjustmentTasks(tasks: SubTask[]): AdjustmentTask[] {
  return toAgentTasks(tasks, new Map())
}

/**
 * 把 sub_tasks 转成 AgentTask（旧版，保留导出兼容）
 */
export function toAgentTasks(
  tasks: SubTask[],
  _categoryMap: Map<number, string>
): AdjustmentTask[] {
  return tasks
    .filter(
      (t) =>
        t.status === 'active' &&
        t.kind === 'finite' &&
        t.total_amount != null &&
        t.completed_amount < t.total_amount
    )
    .map((t) => ({
      id: t.id,
      name: t.name,
      total: t.total_amount!,
      completed: t.completed_amount,
      deadline: t.deadline ?? '',
      rate: `${t.units_per_period}/${t.period_hours}h`,
    }))
}

/**
 * 把 daily_settings 转成 date→hours map
 */
export function toDailyHoursMapForAdj(
  daily: DailySetting[],
  defaultHours: number,
  startDate: string,
  days: number
): Record<string, number> {
  return toDailyHoursMap(daily, defaultHours, startDate, days)
}

/**
 * 旧版：保持导出兼容
 */
export function toDailyHoursMap(
  daily: DailySetting[],
  defaultHours: number,
  startDate: string,
  days: number
): Record<string, number> {
  const map: Record<string, number> = {}
  const start = new Date(startDate)
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const exact = daily.find((s) => s.date === iso)
    map[iso] = exact?.available_hours ?? defaultHours
  }
  return map
}

/**
 * 收集今天的已有 plan entries
 */
export function collectTodayEntries(
  entries: DailyPlanEntry[],
  today: string
): Record<string, DailyPlanEntry> {
  const map: Record<string, DailyPlanEntry> = {}
  for (const e of entries) {
    if (e.plan_date === today) {
      map[e.sub_task_id] = e
    }
  }
  return map
}

// --------------------------------------------------------------------------
// 应用 actions 到 daily_plan_entries
// --------------------------------------------------------------------------

/**
 * 把 actions 应用到现有 plan entries 上
 * 返回新的 entries（不修改原数组）
 */
export function applyActions(
  baseEntries: DailyPlanEntry[],
  actions: AdjustmentAction[]
): DailyPlanEntry[] {
  // 用 key (date|sub_task_id) 索引现有 entries
  const map = new Map<string, DailyPlanEntry>()
  for (const e of baseEntries) {
    map.set(`${e.plan_date}|${e.sub_task_id}`, { ...e })
  }

  for (const action of actions) {
    if (action.type === 'swap') {
      // 两天的 task 量互换
      const aKey = `${action.from_date}|${action.from_task}`
      const bKey = `${action.to_date}|${action.to_task}`
      const a = map.get(aKey)
      const b = map.get(bKey)

      if (a && b) {
        // 互换 amount/hours
        const newA = { ...a, planned_amount: b.planned_amount, planned_hours: b.planned_hours }
        const newB = { ...b, planned_amount: a.planned_amount, planned_hours: a.planned_hours }
        map.set(aKey, newA)
        map.set(bKey, newB)
      } else if (a && !b) {
        // B 那天没有这个 task，移到 B
        const moved = { ...a, plan_date: action.to_date }
        map.delete(aKey)
        map.set(bKey, moved)
      } else if (!a && b) {
        // A 那天没有，移到 A
        const moved = { ...b, plan_date: action.from_date }
        map.delete(bKey)
        map.set(aKey, moved)
      }
    } else if (action.type === 'add' || action.type === 'remove') {
      const key = `${action.date}|${action.sub_task_id}`
      const sign = action.type === 'add' ? 1 : -1
      const existing = map.get(key)
      const currentAmount = existing?.planned_amount ?? 0
      const currentHours = existing?.planned_hours ?? 0
      const newAmount = Math.max(
        0,
        currentAmount + sign * action.planned_amount_delta
      )
      const newHours = Math.max(
        0,
        currentHours + sign * action.planned_hours_delta
      )
      if (newAmount === 0 && newHours === 0) {
        map.delete(key)
      } else {
        map.set(key, {
          ...(existing ?? {
            id: '',
            sub_task_id: action.sub_task_id,
            actual_hours: null,
            is_completed: false,
            notes: null,
            actual_amount: null,
            created_at: new Date().toISOString(),
          }),
          plan_date: action.date,
          sub_task_id: action.sub_task_id,
          planned_amount: newAmount,
          planned_hours: newHours,
        })
      }
    } else if (action.type === 'set_daily_hours') {
      // 不修改 daily_plan_entries（这是 daily_settings 的事）
      // 这个 action 在前端需要单独处理：调用 useSetDailyHours
      // 这里只跳过
    }
  }

  return Array.from(map.values())
}

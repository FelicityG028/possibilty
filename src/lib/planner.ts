/**
 * 任务规划引擎 v2 - 优先级调度
 * ============================================================================
 * 核心算法：按截止日期排序，紧急任务先占用"靠前"的日期；
 * 每个任务在窗口内"靠后"安排（start as late as possible）。
 *
 * 示例：
 *   - 10 天窗口
 *   - 任务 A：7 天工作量，截止 10 天后
 *   - 任务 B：3 天工作量，截止 3 天后（紧急）
 *   排程：B 在 day 1-3，A 在 day 4-10（不重叠）
 *
 * 边界 case：
 * 1. 任务已完成 → 跳过
 * 2. 任务已暂停 → 跳过
 * 3. 截止日期已过 → 仍然处理
 * 4. 容量不足（每天总时长 > 可用时间）→ 标记 overflow
 * 5. 没有任何任务 → 返回空 plan
 * 6. 任务没有截止日期 → 用 maxDays
 *
 * 持久化：调用方负责把 plan 写回 DB。注意：**只同步今天及未来的日期**，
 * 过去日期的 planned_amount 必须冻结不变。
 * ============================================================================
 */

import type { SubTask, DailySetting } from './types'

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface PlannedEntry {
  sub_task_id: string
  planned_amount: number
  planned_hours: number
}

export interface DayPlan {
  date: string
  entries: PlannedEntry[]
  total_hours: number
  total_amount: number
  available_hours: number
  overflow: number
  task_count: number
}

export interface PlanResult {
  byDate: Record<string, DayPlan>
  dates: string[]
  overflowDates: string[]
  stats: {
    activeTasks: number
    totalRemainingHours: number
    totalDays: number
  }
}

// --------------------------------------------------------------------------
// 工具
// --------------------------------------------------------------------------

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function todayIso(): string {
  return toIso(new Date())
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.round(ms / 86400000) + 1
}

export function dateRange(start: Date, days: number): string[] {
  const result: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    result.push(toIso(d))
  }
  return result
}

function getAvailableHours(
  settings: DailySetting[],
  defaultHours: number,
  dateIso: string
): number {
  const exact = settings.find((s) => s.date === dateIso)
  return exact?.available_hours ?? defaultHours
}

// --------------------------------------------------------------------------
// 核心：优先级调度
// --------------------------------------------------------------------------

export interface GeneratePlanOptions {
  startDate?: string
  maxDays?: number
}

/**
 * 生成完整规划（基于优先级）
 */
export function generatePlan(
  tasks: SubTask[],
  settings: DailySetting[],
  defaultHours: number,
  opts: GeneratePlanOptions = {}
): PlanResult {
  const startIso = opts.startDate ?? todayIso()
  const startDate = parseIso(startIso)
  const maxDays = opts.maxDays ?? 180

  // 1. 过滤 active 任务
  const active = tasks.filter((t) => {
    if (t.status !== 'active') return false
    if (t.kind === 'finite') {
      if (t.total_amount == null) return false
      return t.completed_amount < t.total_amount
    }
    return t.daily_hours != null && t.daily_hours > 0
  })

  // 2. 按截止日期排序（早的在前，无截止日期排最后）
  const sorted = [...active].sort((a, b) => {
    const da = a.deadline ?? '9999-12-31'
    const db = b.deadline ?? '9999-12-31'
    return da.localeCompare(db)
  })

  // 3. 规划窗口：从今天到所有任务最远的截止日期
  let endDate = startDate
  for (const t of sorted) {
    if (t.deadline) {
      const d = parseIso(t.deadline)
      if (d > endDate) endDate = d
    }
  }
  // 没截止日期的 recurring 任务：用 maxDays 天
  const hasUnbounded = sorted.some((t) => !t.deadline)
  if (hasUnbounded) {
    const unboundedEnd = new Date(startDate)
    unboundedEnd.setDate(unboundedEnd.getDate() + maxDays - 1)
    if (unboundedEnd > endDate) endDate = unboundedEnd
  }
  const totalDays = daysBetween(startDate, endDate)
  const dates = dateRange(startDate, totalDays)

  // 4. 初始化容量（每天剩余可用时间）
  const capacity = new Map<string, number>()
  for (const d of dates) {
    capacity.set(d, getAvailableHours(settings, defaultHours, d))
  }

  // 5. 初始化 entries
  const entriesByDate: Record<string, PlannedEntry[]> = {}
  for (const d of dates) entriesByDate[d] = []

  let totalRemainingHours = 0

  // 6. ★ 比例均分算法：所有任务一起算，按 dailyShare 比例分配
  //   - 紧急任务（deadline 早）的 dailyShare 自然更高
  //   - 同等紧急程度时（deadline 相同），按 dailyShare 比例同时完成
  //   - 容量不够时按比例缩放
  //   - 例：A 30h + B 20h + DDL 都 10 天 + 6h/day
  //     dailyShare A=3, B=2, total=5 ≤ 6 → 每天都各填 3 和 2 → 10 天同时完成
  //   - 例：A 6h + DDL 20 + B 18h + DDL 3
  //     day 1-3: A dailyShare=0.3, B dailyShare=6, total=6.3 > 6, scale=0.95
  //       A alloc 0.29, B alloc 5.71 → B 占满，B 不够的部分溢出
  //     day 4+: A dailyShare 重新算 = 5.71/17 ≈ 0.34. A 占 day 4-20，每天 0.34h
  //   - ★ 关键：B 紧急任务先分配（高 dailyShare），剩余给 A（低 dailyShare）

  // 6a. 收集所有 active finite task 的 daily demand
  const activeTasks: Array<{
    task: SubTask
    rate: number
    remaining: number
    hoursRemaining: number
    deadlineDate: Date
    windowDays: number
    dailyShare: number // 每天需要的小时数
  }> = []

  for (const t of sorted) {
    if (t.kind !== 'finite') continue
    if (!t.units_per_period || !t.period_hours || !t.total_amount) continue
    if (!t.deadline) continue
    const remaining = t.total_amount - t.completed_amount
    if (remaining <= 0) continue

    const rate = t.units_per_period / t.period_hours
    const hoursRemaining = remaining / rate
    const deadlineDate = parseIso(t.deadline)
    const windowDays = daysBetween(startDate, deadlineDate)
    if (windowDays <= 0) continue

    totalRemainingHours += hoursRemaining
    activeTasks.push({
      task: t,
      rate,
      remaining,
      hoursRemaining,
      deadlineDate,
      windowDays,
      dailyShare: hoursRemaining / windowDays,
    })
  }

  // 6b. ★ "紧急任务优先 + 不挤占"算法
//   - 任务按 deadline ASC 排序
//   - urgent 任务 (dailyShare > 1) 先装在自己窗口
//   - 收集 urgent 任务装过的 days = "urgent days"
//   - non-urgent 任务 (dailyShare ≤ 1) 跳过 urgent days，装在剩余 free days
//   - 能完成所有任务 → 装得下就装完
//   - 装不下 → overflow（在 UI 上显示差额）
//   - 例：文学史 5.32/day 装 7-01 to 7-14，cap 接近 0
//     政治 0.67/day 跳过 7-01 to 7-14，装 7-15+
//     测试 0.5/day 跳过 7-01 to 7-14（虽然小，但需要"自己的空间"）
//     但如果测试也按不 urgent 跳过，它永远没地方装 → 装不满
//   - 折中: 不 urgent 任务也装，但跳过 "被 urgent 占满的 days" (cap < 它的 dailyShare * 0.5)

const URGENT_THRESHOLD = 1 // dailyShare > 1 视为紧急任务

// 第一步: 紧急任务按 dailyShare 装
const urgentTasks = activeTasks.filter((td) => td.dailyShare > URGENT_THRESHOLD)
const nonUrgentTasks = activeTasks.filter((td) => td.dailyShare <= URGENT_THRESHOLD)

// 先装 urgent 任务
for (const td of urgentTasks) {
  let remaining = td.hoursRemaining
  const inWindow = dates.filter((d) => parseIso(d) <= td.deadlineDate)
  for (const d of inWindow) {
    if (remaining <= 0.001) break
    const free = capacity.get(d) ?? 0
    if (free <= 0) continue
    const alloc = Math.min(free, td.dailyShare, remaining)
    if (alloc > 0.001) {
      entriesByDate[d].push({
        sub_task_id: td.task.id,
        planned_hours: alloc,
        planned_amount: alloc * td.rate,
      })
      capacity.set(d, free - alloc)
      remaining -= alloc
    }
  }
}

// 收集 urgent 任务装过的 days
const urgentDays = new Set<string>()
for (const d of dates) {
  if (entriesByDate[d].length > 0) {
    // 检查这个 day 的 entry 是否来自 urgent 任务
    const hasUrgent = entriesByDate[d].some((e) => {
      const t = activeTasks.find((td) => td.task.id === e.sub_task_id)
      return t ? t.dailyShare > URGENT_THRESHOLD : false
    })
    if (hasUrgent) urgentDays.add(d)
  }
}

// 第二步: non-urgent 任务跳过 urgent days
// 但如果 non-urgent 任务的窗口小，urgent days 少，可能装得下
for (const td of nonUrgentTasks) {
  let remaining = td.hoursRemaining
  const inWindow = dates.filter((d) => parseIso(d) <= td.deadlineDate)
  for (const d of inWindow) {
    if (remaining <= 0.001) break
    // 跳过被 urgent 占用的 days
    if (urgentDays.has(d)) continue
    const free = capacity.get(d) ?? 0
    if (free <= 0) continue
    const alloc = Math.min(free, td.dailyShare, remaining)
    if (alloc > 0.001) {
      entriesByDate[d].push({
        sub_task_id: td.task.id,
        planned_hours: alloc,
        planned_amount: alloc * td.rate,
      })
      capacity.set(d, free - alloc)
      remaining -= alloc
    }
  }
}

  // 7. 每日任务（recurring）：每天固定时长
  for (const t of sorted) {
    if (t.kind !== 'recurring') continue
    if (!t.daily_hours) continue
    totalRemainingHours += t.daily_hours * dates.length
    const endDateForRecurring = t.deadline ? parseIso(t.deadline) : endDate
    for (const d of dates) {
      const day = parseIso(d)
      if (day < startDate) continue
      if (day > endDateForRecurring) break
      const free = capacity.get(d) ?? 0
      if (free <= 0) continue
      const alloc = Math.min(free, t.daily_hours)
      if (alloc > 0.001) {
        entriesByDate[d].push({
          sub_task_id: t.id,
          planned_hours: alloc,
          planned_amount: 0,
        })
        capacity.set(d, free - alloc)
      }
    }
  }

  // 7. 组装 DayPlan
  const byDate: Record<string, DayPlan> = {}
  for (const d of dates) {
    const entries = entriesByDate[d]
    const totalHours = entries.reduce((s, e) => s + e.planned_hours, 0)
    const available = getAvailableHours(settings, defaultHours, d)
    byDate[d] = {
      date: d,
      entries,
      total_hours: totalHours,
      total_amount: entries.reduce((s, e) => s + e.planned_amount, 0),
      available_hours: available,
      overflow: totalHours > available ? totalHours - available : 0,
      task_count: entries.length,
    }
  }

  const overflowDates = Object.values(byDate)
    .filter((d) => d.overflow > 0)
    .map((d) => d.date)

  return {
    byDate,
    dates,
    overflowDates,
    stats: {
      activeTasks: active.length,
      totalRemainingHours,
      totalDays: dates.length,
    },
  }
}

// --------------------------------------------------------------------------
// 超额处理策略（保持原样）
// --------------------------------------------------------------------------

export type OverflowStrategy =
  | { type: 'compress' }
  | { type: 'extend'; days: number }
  | { type: 'increase_hours'; hours: number }
  | { type: 'pause_task'; sub_task_id: string }

export function suggestExtendDeadline(
  _task: SubTask,
  fromDate: string,
  extraDays: number
): string {
  const d = parseIso(fromDate)
  d.setDate(d.getDate() + extraDays)
  return toIso(d)
}

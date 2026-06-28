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

  // 6. 调度每个任务
  for (const t of sorted) {
    if (t.kind === 'finite') {
      if (!t.units_per_period || !t.period_hours || !t.total_amount) continue
      const rate = t.units_per_period / t.period_hours
      const remaining = t.total_amount - t.completed_amount
      if (remaining <= 0) continue
      const hoursRemaining = remaining / rate
      totalRemainingHours += hoursRemaining
      if (!t.deadline) continue

      const deadlineDate = parseIso(t.deadline)
      const windowDays = daysBetween(startDate, deadlineDate)
      if (windowDays <= 0) continue
      const dailyShare = hoursRemaining / windowDays

      // ★ 修复：跟踪本任务已分配的日期，避免 fallback 重复 push
      const usedDates = new Set<string>()

      // 策略：先从截止日期倒着排（start as late as possible）
      let remainingHours = hoursRemaining
      const descDates = dates
        .filter((d) => parseIso(d) <= deadlineDate)
        .reverse()
      for (const d of descDates) {
        if (remainingHours <= 0) break
        const free = capacity.get(d) ?? 0
        if (free <= 0) continue
        const alloc = Math.min(free, dailyShare, remainingHours)
        if (alloc > 0.001) {
          entriesByDate[d].push({
            sub_task_id: t.id,
            planned_hours: alloc,
            planned_amount: alloc * rate,
          })
          capacity.set(d, free - alloc)
          usedDates.add(d)
          remainingHours -= alloc
        }
      }

      // 如果还有剩余（早期日期被占满），向前找
      // ★ 关键：跳过 usedDates，避免重复
      if (remainingHours > 0.01) {
        for (const d of dates) {
          if (remainingHours <= 0) break
          if (parseIso(d) > deadlineDate) break
          if (usedDates.has(d)) continue
          const free = capacity.get(d) ?? 0
          if (free <= 0) continue
          const alloc = Math.min(free, remainingHours)
          if (alloc > 0.001) {
            entriesByDate[d].push({
              sub_task_id: t.id,
              planned_hours: alloc,
              planned_amount: alloc * rate,
            })
            capacity.set(d, free - alloc)
            usedDates.add(d)
            remainingHours -= alloc
          }
        }
      }
    } else if (t.kind === 'recurring') {
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

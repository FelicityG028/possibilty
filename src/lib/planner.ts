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

/**
 * 把日期字符串转成当天 23:59:59 本地时间
 * 避免 daysBetween / dateRange 因为 0:00 边界进位到下一天
 */
function parseIsoEndOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59)
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

/** 给 Date 加 N 天，返回新 Date */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** ISO 字符串转 Date */
export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
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
  // endDate 用当天 23:59:59（避免 0:00 边界进位到下一天）
  let endDate = startDate
  for (const t of sorted) {
    if (t.deadline) {
      const d = parseIsoEndOfDay(t.deadline)
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

  // 6b. ★ "按天动态比例填充"算法
  //   - 任务按 deadline ASC 排序（sorted 已排序）
  //   - 从截止日期往今天方向逐天处理，保持 "as late as possible"
  //   - 每天收集窗口内仍有剩余工作量的任务
  //   - 按 dailyShare 比例分配当天容量：
  //     - 总需求 > 容量：按比例压缩
  //     - 总需求 ≤ 容量：按比例放大（填满容量，任务提前完成）
  //   - 每次分配后动态重新计算比例，确保公平且当天容量充分利用
  //   - daily_hours 增加时，任务会获得更高分配并提前完成

  // 跟踪每个任务的剩余小时数
  const remainingHours = new Map<string, number>()
  for (const td of activeTasks) {
    remainingHours.set(td.task.id, td.hoursRemaining)
  }

  // 6b.1 ★ 每日任务（recurring）最高优先级：先于 finite 任务分配
  //   - 当天 available_hours=0（用户主动设为休息日）：跳过
  //   - 其他天：每天都排 daily_hours，先占走容量，finite 任务只能用剩余容量
  //   - ★ start_date 控制从哪天开始排（用户没填则从今天起）
  for (const t of sorted) {
    if (t.kind !== 'recurring') continue
    if (!t.daily_hours) continue
    totalRemainingHours += t.daily_hours * dates.length
    const endDateForRecurring = t.deadline ? parseIso(t.deadline) : endDate
    const startDateForRecurring = t.start_date ? parseIso(t.start_date) : startDate
    for (const d of dates) {
      const day = parseIso(d)
      if (day < startDateForRecurring) continue
      if (day > endDateForRecurring) break
      const free = capacity.get(d) ?? 0
      if (free <= 0) continue
      // 容量紧张时至少排 0.01h（保证每天都显示该任务）
      const alloc = Math.max(0.01, Math.min(free, t.daily_hours))
      if (alloc > 0.001) {
        entriesByDate[d].push({
          sub_task_id: t.id,
          planned_hours: alloc,
          planned_amount: 0,
        })
        capacity.set(d, (capacity.get(d) ?? 0) - alloc)
      }
    }
  }

  // 从前往后处理每一天：紧急任务（deadline 早）优先
  //   - 每天按 deadline ASC 排序的 eligible tasks 分配 capacity
  //   - 每个 task 装到 dailyShare 上限（不放大，避免抢非紧急任务空间）
  //   - 装满 dailyShare 的任务不再占用当天 capacity
  //   - 富余 capacity 分给"已装满 dailyShare 的任务"作 bonus（让紧急任务多装）
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i]
    const dayDate = parseIso(d)
    let free = capacity.get(d) ?? 0
    if (free <= 0.001) continue

    // 按 deadline ASC 排序（最紧急的先填）
    const eligible = activeTasks
      .filter((td) => {
        if (dayDate > td.deadlineDate) return false
        return (remainingHours.get(td.task.id) ?? 0) > 0.001
      })
      .sort((a, b) => {
        if (a.deadlineDate.getTime() !== b.deadlineDate.getTime()) {
          return a.deadlineDate.getTime() - b.deadlineDate.getTime()
        }
        return (remainingHours.get(b.task.id) ?? 0) - (remainingHours.get(a.task.id) ?? 0)
      })

    // 第一轮：每个 task 装 dailyShare（不放大）
    const dayEntries = entriesByDate[d]
    for (const td of eligible) {
      if (free <= 0.001) break
      const rem = remainingHours.get(td.task.id) ?? 0
      if (rem <= 0.001) continue
      const want = Math.min(td.dailyShare, rem, free)
      if (want <= 0.001) continue
      dayEntries.push({
        sub_task_id: td.task.id,
        planned_hours: want,
        planned_amount: want * td.rate,
      })
      remainingHours.set(td.task.id, rem - want)
      capacity.set(d, free - want)
      free -= want
    }

    // 第二轮：富余 capacity 给"还没填满"的紧急任务加 bonus
    // （合并到已有 entry，不新增重复 entry）
    if (free > 0.001) {
      const fillableTasks = eligible.filter((td) => {
        const rem = remainingHours.get(td.task.id) ?? 0
        return rem > 0.001
      })
      if (fillableTasks.length > 0) {
        const totalRem = fillableTasks.reduce((s, td) => s + (remainingHours.get(td.task.id) ?? 0), 0)
        for (const td of fillableTasks) {
          if (free <= 0.001) break
          const rem = remainingHours.get(td.task.id) ?? 0
          if (rem <= 0.001) continue
          const bonus = (rem / totalRem) * free
          if (bonus <= 0.001) continue
          // 查找是否已有该 task 的 entry
          const existing = dayEntries.find((e) => e.sub_task_id === td.task.id)
          if (existing) {
            existing.planned_hours += bonus
            existing.planned_amount = existing.planned_hours * td.rate
          } else {
            dayEntries.push({
              sub_task_id: td.task.id,
              planned_hours: bonus,
              planned_amount: bonus * td.rate,
            })
          }
          remainingHours.set(td.task.id, rem - bonus)
          const cap = capacity.get(d) ?? 0
          capacity.set(d, cap - bonus)
          free -= bonus
        }
      }
    }
  }

  // （recurring 任务在 6b.1 已经先于 finite 分配过，这里不再重复）

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

  const overflowDates = new Set<string>()
  for (const d of dates) {
    if (byDate[d].overflow > 0.001) overflowDates.add(d)
  }
  // 窗口结束时仍无法完成的任务，其截止日期也应标记为 overflow
  for (const td of activeTasks) {
    const rem = remainingHours.get(td.task.id) ?? 0
    if (rem > 0.001 && td.task.deadline) overflowDates.add(td.task.deadline)
  }

  return {
    byDate,
    dates,
    overflowDates: Array.from(overflowDates),
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

/**
 * 今日/每日进度计算工具
 *
 * 给定子任务和它今天之前的 plan entries，返回"今天完成了多少"
 *
 * 算法：
 *   - 累计到昨天的计划量 = sum(planned_amount where plan_date < today)
 *   - 今天完成的 = clamp(completed_amount - 累计, 0, 今日计划量)
 *   - 提前完成的话（已完成 > 累计 + 今日计划），截断到今日计划
 *   - 落后的话（已完成 < 累计），截断到 0
 *
 * recurring 任务：使用 daily_plan_entries.actual_hours 字段（每日独立，不汇总）
 */
import type { SubTask, DailyPlanEntry } from './types'

export interface TodayProgress {
  /** 今天实际完成量（derived） */
  completed: number
  /** 今天计划量（来自 plan entry） */
  planned: number
  /** 完成率 0-1 */
  ratio: number
  /** 实际花了多少小时（recurring 直接来自 actual_hours） */
  actualHours?: number
}

export function getTodayProgress(
  task: SubTask,
  today: string,
  allEntries: DailyPlanEntry[]
): TodayProgress | null {
  const todayEntry = allEntries.find((e) => e.plan_date === today && e.sub_task_id === task.id)
  if (!todayEntry) return null

  if (task.kind === 'recurring') {
    // 每日任务：直接读 actual_hours
    const actualHours = todayEntry.actual_hours ?? 0
    const plannedHours = todayEntry.planned_hours
    const ratio = plannedHours > 0 ? Math.min(1, actualHours / plannedHours) : 0
    return {
      completed: actualHours,
      planned: plannedHours,
      ratio,
      actualHours,
    }
  }

// finite 任务：今天完成量 = entry.actual_amount（用户当天记录）
  const planned = todayEntry.planned_amount
  const actual = todayEntry.actual_amount ?? 0
  if (planned <= 0) {
    return { completed: actual, planned: 0, ratio: 1 }
  }

  return {
    completed: actual,
    planned,
    ratio: Math.min(1, actual / planned),
  }
}

/**
 * 计算某一天的"完成度"（百分比 0-1），用于日历格子下的进度条
 *
 * 完成度 = 已学时间 / 规划时间
 *   - finite 任务：基于 cumulative completed_amount 推导
 *   - recurring 任务：直接使用 actual_hours（每日独立，不汇总）
 */
export function getDayCompletion(
  date: string,
  tasks: SubTask[],
  entries: DailyPlanEntry[]
): { actual_hours: number; planned_hours: number; ratio: number } {
  const dayEntries = entries.filter((e) => e.plan_date === date)
  if (dayEntries.length === 0) {
    return { actual_hours: 0, planned_hours: 0, ratio: 0 }
  }

  let actualHours = 0
  let plannedHours = 0
  for (const e of dayEntries) {
    plannedHours += e.planned_hours
    const task = tasks.find((t) => t.id === e.sub_task_id)
    if (!task) continue

    if (task.kind === 'recurring') {
      // 每日任务：actual_hours 来自 daily_plan_entries.actual_hours
      const ah = e.actual_hours ?? 0
      actualHours += ah
    } else {
      // finite 任务：今天完成 = entry.actual_amount（独立于计划）
      // 实际学习时长 = actual_amount / rate（超额完成也算实际时长）
      const todayActual = e.actual_amount ?? 0
      const rate = (task.units_per_period ?? 1) / (task.period_hours ?? 1)
      actualHours += todayActual / rate
    }
  }

  const ratio = plannedHours > 0 ? Math.min(1, actualHours / plannedHours) : 0
  return { actual_hours: actualHours, planned_hours: plannedHours, ratio }
}

// --------------------------------------------------------------------------
// 任务预测：按当前计划到截止日会差多少？
// --------------------------------------------------------------------------

export interface TaskProjection {
  /** 按计划到截止日总共能完成多少（含已完成的） */
  projected: number
  /** 距离 100% 还差多少（gap = total - projected，如果 projected 已超 total 则为 0） */
  delta: number
  /** 总进度 0-1 */
  ratio: number
  /** 按计划能不能按时完成 */
  willFinish: boolean
  /** 为按时完成，每天需要多少小时（仅 willFinish=false 时有意义） */
  requiredDailyHours: number | null
  /** 截止日还剩多少天（工作日） */
  daysRemaining: number
}

/**
 * 计算某个 finite 任务按当前计划的"预测"
 *
 * 算法：
 *   - 累计已完成 = task.completed_amount
 *   - 今天+未来计划的 planned_hours 之和 = remaining_planned_hours
 *   - 预测完成量 = completed + remaining_planned * rate
 *   - 如果预测 < total，则有 delta
 *   - 为按时完成：需要每天 (delta / rate) / days_remaining 小时
 */
export function getProjectedCompletion(
  task: SubTask,
  allEntries: DailyPlanEntry[],
  today: string
): TaskProjection | null {
  if (task.kind !== 'finite') return null
  if (!task.total_amount || !task.units_per_period || !task.period_hours) return null
  if (!task.deadline) return null

  const total = task.total_amount
  const completed = task.completed_amount
  const rate = task.units_per_period / task.period_hours // 单位/小时

  // 今天及未来的 planned_hours 之和
  const futurePlannedHours = allEntries
    .filter((e) => e.sub_task_id === task.id && e.plan_date >= today)
    .reduce((s, e) => s + e.planned_hours, 0)

  const projectedFromPlan = futurePlannedHours * rate
  const rawProjected = Math.min(total, completed + projectedFromPlan)
  // ★ 修复：用 0.5 单位精度判断，避免 9.99/10 误报
  const projected = rawProjected
  const delta = total - rawProjected
  // delta < 0.5 视为完成
  const roundedDelta = delta < 0.5 ? 0 : Math.round(delta * 10) / 10
  const ratio = Math.min(1, rawProjected / total)
  const willFinish = roundedDelta === 0

  // 截止日还剩多少天（含今天和截止日）
  const todayDate = parseIsoDate(today)
  const deadlineDate = parseIsoDate(task.deadline)
  const daysRemaining = Math.max(1, diffDays(todayDate, deadlineDate) + 1)

  // 为按时完成：每天需要多少小时
  let requiredDailyHours: number | null = null
  if (!willFinish && delta > 0 && rate > 0) {
    requiredDailyHours = delta / rate / daysRemaining
  }

  return {
    projected,
    delta: roundedDelta,
    ratio,
    willFinish,
    requiredDailyHours,
    daysRemaining,
  }
}

// 内部工具
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/**
 * 汇总所有 finite 任务的预测
 */
export function getAggregateProjection(
  tasks: SubTask[],
  allEntries: DailyPlanEntry[],
  today: string
): {
  totalDelta: number
  totalProjected: number
  totalAmount: number
  willFinishCount: number
  wontFinishCount: number
  requiredExtraDailyHours: number
} {
  let totalDelta = 0
  let totalProjected = 0
  let totalAmount = 0
  let willFinishCount = 0
  let wontFinishCount = 0
  let maxExtraHours = 0

  for (const t of tasks) {
    if (t.kind !== 'finite' || t.status === 'completed' || t.status === 'paused') continue
    const proj = getProjectedCompletion(t, allEntries, today)
    if (!proj) continue
    totalDelta += proj.delta
    totalProjected += proj.projected
    totalAmount += t.total_amount ?? 0
    if (proj.willFinish) willFinishCount++
    else wontFinishCount++
    if (proj.requiredDailyHours != null && proj.requiredDailyHours > maxExtraHours) {
      maxExtraHours = proj.requiredDailyHours
    }
  }

  return {
    totalDelta,
    totalProjected,
    totalAmount,
    willFinishCount,
    wontFinishCount,
    requiredExtraDailyHours: maxExtraHours,
  }
}

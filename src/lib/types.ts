// ============================================================================
// Type definitions mirroring Supabase tables
// ============================================================================

/** 8 大类 */
export interface Category {
  id: number
  name: string
  unit_label: string
  color: string
  icon: string | null
  sort_order: number
  created_at: string
}

/** 子任务 */
export interface SubTask {
  id: string
  category_id: number
  name: string
  /** finite 任务：总量；recurring 任务：null */
  total_amount: number | null
  units_per_period: number | null
  period_hours: number | null
  /** finite 任务：截止日期；recurring 任务：null */
  deadline: string | null
  /** recurring 任务：从这天起每天排；null = 从今天起。finite 任务忽略 */
  start_date: string | null
  completed_amount: number
  /** finite = 有总量和截止日期；recurring = 每天固定时长（如背单词 30min/天） */
  kind: 'finite' | 'recurring'
  /** recurring 任务：每天分配的小时数；finite 任务：null */
  daily_hours: number | null
  status: 'active' | 'paused' | 'completed'
  notes: string | null
  created_at: string
  updated_at: string
}

/** 用于创建子任务（id 和时间戳由 DB 生成） */
export type SubTaskInsert = Omit<SubTask, 'id' | 'created_at' | 'updated_at' | 'status' | 'completed_amount'> & {
  status?: SubTask['status']
  completed_amount?: number
}

/** 用于更新子任务 */
export type SubTaskUpdate = Partial<Omit<SubTask, 'id' | 'created_at' | 'updated_at'>>

/** 每日可用时间（按日期覆盖） */
export interface DailySetting {
  date: string
  available_hours: number
}

/** 全局默认每日学习时间（单行表） */
export interface DefaultSetting {
  id: 1
  available_hours: number
}

/** 每日计划条目 */
export interface DailyPlanEntry {
  id: string
  plan_date: string
  sub_task_id: string
  planned_amount: number
  planned_hours: number
  is_completed: boolean
  actual_amount: number | null
  /** recurring 任务的当日实际学习小时数（每日独立） */
  actual_hours: number | null
  notes: string | null
  created_at: string
  /** 标记为 true 表示这是用户/AI 调整的，sync 不覆盖 */
  is_user_adjusted: boolean
  /** 关联到 adjustment_logs 的 id，方便清除 */
  adjustment_id: string | null
}

/** AI/用户调整日志 */
export interface AdjustmentLog {
  id: string
  user_request: string
  reasoning: string | null
  /** 存储 actions JSON（JSONB）*/
  actions: unknown
  affected_dates: string[]
  created_at: string
}

/** 进度日志 */
export interface ProgressLog {
  id: string
  sub_task_id: string
  amount_delta: number
  log_date: string
  created_at: string
}

/** 每日学习汇总（预期 / 实际） */
export interface DailySummary {
  date: string
  expected_hours: number
  actual_hours: number
  task_count: number
  is_overflow: boolean
  updated_at: string
}

// ============================================================================
// 视图模式 / UI store
// ============================================================================

export type ViewMode = 'calendar' | 'gantt'
export type Theme = 'light' | 'dark'

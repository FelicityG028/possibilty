/**
 * 任务排程 AI Agent
 * ============================================================================
 * 用 LLM 替代写死的 planner.ts 算法。
 *
 * 关键设计：
 * 1. 接收：当前任务列表 + 每天可用时间 + 历史 plan
 * 2. 输出：未来日期的 plan entries（JSON 数组）
 * 3. 严格 JSON 输出（用 response_format 约束）
 * 4. 失败时回退到写死算法
 *
 * 不存任何状态：每次 sync 都重新读 DB → 调 LLM → 写回 DB
 * ============================================================================
 */

import type { SubTask, DailySetting, DailyPlanEntry } from './types'

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface AgentInput {
  /** 当前日期 YYYY-MM-DD */
  today: string
  /** 每天可用时间 map */
  dailyHours: Record<string, number>
  /** 默认可用时间（fallback） */
  defaultHours: number
  /** 任务列表（只传 active 且未完成的 finite 任务） */
  tasks: AgentTask[]
  /** 今天已存在的 plan（保留 actual_hours） */
  existingToday: Record<string, DailyPlanEntry>
}

export interface AgentTask {
  id: string
  name: string
  category: string
  total: number
  rate: string // "1 h/单位"
  rate_units_per_period: number
  rate_period_hours: number
  completed: number
  deadline: string
}

export interface AgentOutput {
  entries: Array<{
    plan_date: string // YYYY-MM-DD
    sub_task_id: string
    planned_amount: number
    planned_hours: number
  }>
  reasoning: string // 排程说明（给用户看的）
  overflow_notes: Array<{
    sub_task_id: string
    sub_task_name: string
    shortfall: number // 还差多少单位
  }>
}

// --------------------------------------------------------------------------
// API 调用
// --------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是"学习排程助手"。基于用户任务列表、每天可用时间、已完成进度，生成未来几天的 plan。

# 排程规则（按优先级）
1. **紧急任务优先**：截止日（deadline）越早越优先处理
2. **不挤占**：紧急任务装满前期 days 后，不紧急任务（deadline 晚的）才能用这些 days
3. **每天总量不能超过 daily_hours[date]**：超出时此 task 的 planned_hours 应被截断
4. **装得下就装完**：窗口内总容量 ≥ task needs，就按 dailyShare 均分装完
5. **装不下要明确标 overflow**：在 overflow_notes 里写明哪些 task 差多少
6. **今天的 plan 保持稳定**：今天的 entry 按现有数据保留，**不要**重排今天
7. **不紧急任务跳过被紧急任务占满的 days**：只有装得下才装

# 输入 JSON 格式
{
  "today": "YYYY-MM-DD",
  "daily_hours": { "YYYY-MM-DD": hours },  // 未来每天的可用小时
  "default_hours": number,                  // 缺省值
  "tasks": [
    {
      "id": "uuid",
      "name": "string",
      "category": "string",  // 看书/看网课/刷题/背单词/梳理教材/整理论文/背诵知识点/整理框架
      "total": number,        // 总量，如 300
      "rate": "X h/单位",     // 速度
      "rate_units_per_period": number,
      "rate_period_hours": number,
      "completed": number,    // 已完成
      "deadline": "YYYY-MM-DD"
    }
  ]
}

# 输出 JSON 格式（**严格**）
{
  "entries": [
    {
      "plan_date": "YYYY-MM-DD",
      "sub_task_id": "uuid",
      "planned_amount": number,  // 单位数（如 1.5 节）
      "planned_hours": number    // 小时数（如 1.5h）
    }
  ],
  "reasoning": "string（为什么这样排，用户可见，1-2 句话）",
  "overflow_notes": [
    { "sub_task_id": "uuid", "sub_task_name": "string", "shortfall": number }
  ]
}

# 计算 hint
- rate_units_per_period / rate_period_hours = 单位/小时（如 1/2 = 0.5 页/h）
- 剩余 = total - completed
- 剩余 hours = 剩余 / 速率
- 窗口 = deadline - today + 1 天
- dailyShare（小时/天）= 剩余 hours / 窗口
- 但要根据每天 daily_hours 上限截断
`

/**
 * 调用 LLM 生成 plan
 */
export async function callPlannerAgent(
  input: AgentInput,
  apiKey: string
): Promise<AgentOutput> {
  if (!apiKey) {
    throw new Error('VITE_OPENAI_API_KEY not configured')
  }

  // 构造 user prompt（JSON 输入）
  const userPrompt = JSON.stringify(
    {
      today: input.today,
      daily_hours: input.dailyHours,
      default_hours: input.defaultHours,
      tasks: input.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        total: t.total,
        rate: t.rate,
        rate_units_per_period: t.rate_units_per_period,
        rate_period_hours: t.rate_period_hours,
        completed: t.completed,
        deadline: t.deadline,
        remaining: t.total - t.completed,
        rate_units_per_hour: t.rate_units_per_period / t.rate_period_hours,
        window_days:
          Math.max(
            1,
            Math.round(
              (new Date(t.deadline).getTime() - new Date(input.today).getTime()) /
                86400000
            ) + 1
          ),
      })),
    },
    null,
    2
  )

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // 便宜快速
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenAI API ${response.status}: ${err}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty OpenAI response')

  const parsed = JSON.parse(content) as AgentOutput
  return validateOutput(parsed)
}

/**
 * 校验输出格式
 */
function validateOutput(raw: any): AgentOutput {
  if (!raw || typeof raw !== 'object') throw new Error('Output is not an object')
  if (!Array.isArray(raw.entries)) throw new Error('Output.entries is not array')
  if (typeof raw.reasoning !== 'string') raw.reasoning = ''
  if (!Array.isArray(raw.overflow_notes)) raw.overflow_notes = []

  // 校验每个 entry
  const validEntries = raw.entries.filter(
    (e: any) =>
      typeof e?.plan_date === 'string' &&
      typeof e?.sub_task_id === 'string' &&
      typeof e?.planned_amount === 'number' &&
      typeof e?.planned_hours === 'number' &&
      e.planned_amount > 0 &&
      e.planned_hours > 0
  )

  return {
    entries: validEntries,
    reasoning: raw.reasoning,
    overflow_notes: raw.overflow_notes.filter(
      (n: any) =>
        typeof n?.sub_task_id === 'string' && typeof n?.shortfall === 'number'
    ),
  }
}

// --------------------------------------------------------------------------
// 从 DB 数据构造 AgentInput
// --------------------------------------------------------------------------

/**
 * 把 sub_tasks 转成 AgentTask（只传 finite 且 active 且未完成的）
 */
export function toAgentTasks(tasks: SubTask[], categoryMap: Map<number, string>): AgentTask[] {
  return tasks
    .filter(
      (t) =>
        t.status === 'active' &&
        t.kind === 'finite' &&
        t.total_amount != null &&
        t.units_per_period != null &&
        t.period_hours != null &&
        t.deadline != null &&
        t.completed_amount < t.total_amount
    )
    .map((t) => {
      const cat = categoryMap.get(t.category_id) ?? '其他'
      return {
        id: t.id,
        name: t.name,
        category: cat,
        total: t.total_amount!,
        rate: `${t.units_per_period} / ${t.period_hours}h`,
        rate_units_per_period: t.units_per_period!,
        rate_period_hours: t.period_hours!,
        completed: t.completed_amount,
        deadline: t.deadline!,
      }
    })
}

/**
 * 把 daily_settings 转换成 date→hours map（从 today 开始往后 60 天）
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
 * 收集今天的已有 plan entries（按 sub_task_id 索引）
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

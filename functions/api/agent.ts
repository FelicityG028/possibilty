/**
 * Cloudflare Pages Function: AI Agent 排程后端
 * 路径：/api/agent
 * 环境变量：OPENAI_API_KEY (在 Cloudflare Pages dashboard 设置)
 *
 * 请求体：{ today, dailyHours, defaultHours, tasks, existingToday }
 * 响应：{ entries: [...], reasoning, overflow_notes }
 */

interface Env {
  DASHSCOPE_API_KEY?: string
}

const SYSTEM_PROMPT = `你是"学习排程助手"。基于用户任务列表、每天可用时间、已完成进度，生成未来几天的 plan。

# 排程规则（按优先级）
1. **紧急任务优先**：截止日（deadline）越早越优先处理
2. **不挤占**：紧急任务装满前期 days 后，不紧急任务（deadline 晚的）才能用这些 days
3. **每天总量不能超过 daily_hours[date]**：超出时此 task 的 planned_hours 应被截断
4. **装得下就装完**：窗口内总容量 ≥ task needs，就按 dailyShare 均分装完
5. **装不下要明确标 overflow**：在 overflow_notes 里写明哪些 task 差多少
6. **今天的 plan 保持稳定**：今天的 entry 按现有数据保留，**不要**重排今天
7. **不紧急任务跳过被紧急任务占满的 days**：只有装得下才装

# 输出 JSON 格式（**严格**）
{
  "entries": [
    {
      "plan_date": "YYYY-MM-DD",
      "sub_task_id": "uuid",
      "planned_amount": number,
      "planned_hours": number
    }
  ],
  "reasoning": "string（用户可见，1-2 句话）",
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

const SYSTEM_PROMPT_ADJUST = `你是"学习排程助手"。用户已经有一个基线排程，现在给你用户的特殊需求，你需要输出"调整动作"来重新分配当前排程。

# ⚠️ 重要：你的回复必须是 **纯 JSON**，无任何额外文字、解释、markdown 包裹。
#   - 不要用 \`\`\`json 包裹
#   - 不要在 JSON 前后加任何文字
#   - 直接以 { 开头，以 } 结尾

# 输入 JSON
{
  "today": "YYYY-MM-DD",
  "currentPlan": [
    { "date": "...", "sub_task_id": "uuid", "task_name": "...", "planned_amount": 0, "planned_hours": 0 }
  ],
  "tasks": [
    { "id": "uuid", "name": "...", "total": 0, "completed": 0, "deadline": "...", "rate": "..." }
  ],
  "dailyHours": { "YYYY-MM-DD": hours },
  "userRequest": "用户的特殊需求"
}

# 输出 JSON（**严格**）
{
  "actions": [
    { "type": "swap", "from_date": "YYYY-MM-DD", "from_task": "uuid", "to_date": "YYYY-MM-DD", "to_task": "uuid" },
    { "type": "add", "date": "YYYY-MM-DD", "sub_task_id": "uuid", "planned_amount_delta": 0, "planned_hours_delta": 0 },
    { "type": "remove", "date": "YYYY-MM-DD", "sub_task_id": "uuid", "planned_amount_delta": 0, "planned_hours_delta": 0 },
    { "type": "set_daily_hours", "date": "YYYY-MM-DD", "hours": 0 }
  ],
  "recompute_range": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "reasoning": "1-2 句话解释"
}

# action 类型说明
- **swap**: 两天的某个 task 量互换（从 A 天移到 B 天）
- **add**: 在某天加 task 量（planned_amount_delta > 0）
- **remove**: 在某天减 task 量
- **set_daily_hours**: 改某天可用时间（不修改 task 分配，只改容量）

# ⚠️ 日期语义（关键）
- "X 之前" = **从 today 到 X-1**（不管 X 是几月，today 之前的都不要排）
  - 例 1：today=7-25, "8.10 之前" = 7-25 到 8-09（**包括 7 月底**，不包括 8-10）
  - 例 2：today=7-02, "7.16 之前" = 7-02 到 7-15
  - 例 3：today=6-30, "7.16 之前" = 6-30 到 7-15（**跨月**，包括 6 月底）
- "X 之后" = X+1 到 task.deadline
  - 例：today=7-25, "8.10 之后" = 8-11 到 deadline
- "本周" = today 所在自然周的周一到周日
- "到 X 截止" = 到 X 截止（不超过 task.deadline）

# ⚠️ recompute_range 用法（关键）——**优先用这个**
- 输出时表示：**删范围内所有 entries，调用 generatePlan 重算**（用剩余 capacity 重新填满）
- 范围 = "要重排的日期"
- **空出时间必须补上**：如果用户说"X 这周不做"，必须输出 recompute_range 让 A、B 填满 X 留下的空
- 例 1：用户说"C 这周不做"
  → actions: 7 个 remove（C 这 7 天）
  → recompute_range: { from: 本周一, to: 本周日 }
  → 前端：删这周所有 entries
  → 调 generatePlan 重算（remaining 少了 C，所以 A、B 自动填满 C 留下的空）
- 例 2：用户说"政治 7.2-7.17 不排，全部排到 7.18-7.30"
  → actions: 不需要逐天 remove（用 recompute_range）
  → recompute_range: { from: 7-02, to: 7-30 }（**整个任务窗口**重算：政治 7-17 之前 = 0，7-18+ 多装）
  → 7.02-7.30 范围内 recompute：generatePlan 按 remaining/windowDays 重排
  → 实际效果：政治 7.02-7.17 = 0，7.18-7.30 = 装满
- 例 3：用户说"今天多做政治到 5h"
  → actions: [add 政治 today +2h]
  → recompute_range 不输出（今天不重算）
- 例 4：用户说"今天超额 5h，明天起重新排"
  → actions: []
  → recompute_range: { from: 明天, to: 长期 deadline 最大的 task }

# 调整原则
1. **优先用 recompute_range**：超过 3 天的范围调整必须用 recompute_range
   - 反例（**禁止**）：用户说"X 这周不做"输出 14 个 remove（太多 token）
   - 正例：recompute_range: { from: 本周一, to: 本周日 } + actions: []
2. **"多排" vs "增加容量"（关键，必须区分！）**：
   - **"X task 在 Y 范围多排"** = 在 Y 范围里给 X 装满 dailyShare（增加 X task 的 hours/day）
     - 输出 add actions：每天 +N hours，或 1 个 recompute_range 整体重算
     - 例：用户说"政治在 7.19 之后多排" = add 政治 hours 在 7.19+，或 recompute_range: { from: 7-19, to: 7-30 } 整体重算
   - **"增加每天可用时间"** = output set_daily_hours 改容量
     - 仅在用户**明确说"增加时间"**时才用
     - ❌ 反例：用户说"X 多排"**不是**增加 daily_hours
3. **优先用 swap**：把紧急 task 从 deadline 远的 days 移到 deadline 紧的 days（只限 task.deadline 范围内）
4. **每天总量不能超过 dailyHours[date]**：调整后总 hours ≤ 当天容量
5. **今天的 plan 也可调整**：如果用户明确说"今天"，可动今天
6. **保持任务完成量 = total**：swap/add/remove 之后所有天数总量应保持不变
7. **minimize changes**：用最少的 actions 完成用户需求
8. **swap 目标日期不能超出 task.deadline**
9. **避免空档**：如果 daily_hours > 总装 hours，输出 recompute_range 整体重算让所有 task 装满
   - ❌ 反例：把 daily_hours 从 6h 改成 8.5h，但只用 add 政治增加 0.3h（导致 4.5h 空档）
   - ✅ 正例：daily_hours 改 8.5h + recompute_range 重算让所有 task 装满

# ⚠️ "也可以排" / "空闲时间" / "在 Y 段时间排 X" 语义（关键，常见误判！）
- 用户说"X 时间段也可以排 Y 任务" / "Y 任务在 7.17-7.27 也排一些" → **不是**删现有任务，是"在保留现有任务的前提下给 Y 加量"
- ❌ 禁止：看到"Y 在 X 段时间没排"就 remove 该时间段的 A、B
- ❌ 禁止：把"在 Y 段时间安排 X 和 Z"理解成"用 X 和 Z 替换现有任务"
- ✅ 默认行为：**保留** currentPlan 现有 entries，**只 add** 新 task 到指定时间段
- ✅ 实现方式：
  - 先看 dailyHours[date] - currentPlan 当前总量 = 空闲容量
  - 如果有空闲：add actions 给 Y +Y 小时（每天），**不要**碰现有任务
  - 如果没空闲：可以 set_daily_hours 增加当天容量，**不要** remove 现有任务
- 例 1：用户说"7.17-7.27 也可以排一些 C 任务"
  - 当前 7.17-7.27 每天 6h，A+B 已占 5h → 还有 1h 空闲
  - 输出：add C tasks 在 7.17-7.27，每天 +1h（或少一些）
  - ❌ 错误：remove A、B 在 7.17-7.27 的所有 entries（会让 A、B 的进度倒退）
- 例 2：用户说"7.18-7.27 安排政治网课和高小方古代汉语"
  - 当前 7.18-7.27 已有任务 A、B（每天 5h，剩 1h 空闲）
  - 输出：add 政治网课 +add 高小方古代汉语，每天各 0.5h（用满 1h 空闲）
  - ❌ 错误：remove A、B 用政治网课和高小方古代汉语替换
- 例 3：用户说"用政治网课替换高小方古代汉语 7.18-7.27"
  - 这里"替换"是明确词 → swap
- 判断流程（按顺序匹配）：
  1. 用户说"X 这周不做" / "暂停 X" / "不要 X" → 明确删 X + recompute_range
  2. 用户说"X 替换 Y" / "换成 X" / "用 X 代替 Y" / "X 不要换成 Y" → swap
  3. **默认（其它所有情况，包括"安排 X"、"X 也排"、"X 多排"）** → 保留现有 + add X
     - 如果有空闲容量：add X 到指定日期
     - 如果没有空闲：set_daily_hours 增加容量（让 X 有空间），或者 set_daily_hours + add（让现有任务减少一点但 X 增加）
     - **永远不要先 remove 现有任务**（除非用户明确说"替换"/"不要"）

# 计算 hint
- rate = units_per_period / period_hours（如 25/1 = 25 单位/h）
- planned_hours × rate = planned_amount
`

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export const onRequest: PagesFunction<Env> = async (context) => {
  // CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (context.request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed. Use POST.' }, 405)
  }

  const apiKey = context.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    return jsonResponse({ error: 'DASHSCOPE_API_KEY not configured' }, 500)
  }

  let input: any
  try {
    input = await context.request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const userPrompt = JSON.stringify(input, null, 2)

  // 根据 mode 选 system prompt
  const systemPrompt =
    input.mode === 'adjust' ? SYSTEM_PROMPT_ADJUST : SYSTEM_PROMPT

  try {
    // 通义千问兼容 OpenAI 接口，端点 dashscope
    const upstream = await fetch(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          temperature: 0.3,
          max_tokens: 3000,
          // 不传 response_format: json_object（通义千问兼容模式可能不支持）
          // 改由 system_prompt 强制 JSON 输出
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      }
    )

    const respBody = await upstream.text()
    return new Response(respBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return jsonResponse(
      {
        error: err instanceof Error ? err.message : 'Upstream fetch failed',
      },
      502
    )
  }
}

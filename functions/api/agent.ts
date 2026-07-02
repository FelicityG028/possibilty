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
  "reasoning": "1-2 句话解释"
}

# action 类型说明
- **swap**: 两天的某个 task 量互换（从 A 天移到 B 天）
- **add**: 在某天加 task 量（planned_amount_delta > 0）
- **remove**: 在某天减 task 量
- **set_daily_hours**: 改某天可用时间（不修改 task 分配，只改容量）

# 调整原则
1. **优先用 swap**：把紧急 task 从 deadline 远的 days 移到 deadline 紧的 days
2. **每天总量不能超过 dailyHours[date]**：调整后总 hours ≤ 当天容量
3. **今天的 plan 也可调整**：如果用户明确说"今天"，可动今天
4. **保持任务完成量 = total**：swap/add/remove 之后所有天数总量应保持不变
5. **minimize changes**：用最少的 actions 完成用户需求

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

/**
 * Vercel API Route: AI Agent 排程后端
 * 路径：/api/agent
 *
 * 环境变量：在 Vercel Project Settings → Environment Variables 添加 DASHSCOPE_API_KEY
 *
 * 请求体：
 *   - 生成模式：{ today, dailyHours, defaultHours, tasks, existingToday }
 *   - 调整模式：{ mode: 'adjust', today, currentPlan, tasks, dailyHours, defaultHours, userRequest }
 * 响应：原样返回 dashscope response（含 choices[0].message.content）
 */

// Vercel 自动提供 VercelRequest/VercelResponse 类型（运行时也内置）
// 这里用 any 避免本地编译时缺 @vercel/node 包
type VercelRequest = any
type VercelResponse = any

export const config = {
  runtime: 'nodejs',
}

const SYSTEM_PROMPT_GENERATE = `你是"学习排程助手"。基于用户任务列表、每天可用时间、已完成进度，生成未来几天的 plan。

# ⚠️ 重要：你的回复必须是 **纯 JSON**，无任何额外文字、解释、markdown 包裹。
#   - 不要用 \`\`\`json 包裹
#   - 不要在 JSON 前后加任何文字
#   - 直接以 { 开头，以 } 结尾

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
    { "type": "remove", "date": "YYYY-MM-DD", "sub_task_id": "uuid", "planned_amount_delta": 0, "planned_amount_delta": 0 },
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
- "X 之后" = X+1 到 task.deadline
- "本周" = today 所在自然周的周一到周日
- "到 X 截止" = 到 X 截止（不超过 task.deadline）

# ⚠️ recompute_range 用法（关键）——**优先用这个**
- 输出时表示：**删范围内所有 entries，调用 generatePlan 重算**（用剩余 capacity 重新填满）
- 范围 = "要重排的日期"
- **空出时间必须补上**：如果用户说"X 这周不做"，必须输出 recompute_range 让 A、B 填满 X 留下的空
- ★ **用 recompute_range 时绝对不要输出范围内的 remove actions**！
  - ❌ 错误：recompute_range: {7-21~7-30} + 10 个 7-21~7-30 的 remove（浪费 token + 容易超 max_tokens 截断）
  - ✅ 正确：recompute_range: {7-21~7-30}，范围内的内容让前端用 generatePlan 重新算
  - 范围内已有 remove 是 prompt 旧版本要求的，**新版本已废弃**，不要再输出

# ⚠️ 输出 token 限制（重要）
- max_tokens=6000，但 actions 数组太长可能截断
- **严格遵守**：能 1 个 recompute_range 解决的就不要 30 个 remove
- 典型输出大小：recompute 范围调整 = ~200 字符；add/remove 几个 = ~500 字符
- **不要重复 remove 同一 task 的相邻日期**（用 recompute_range 一行解决）

# ⚠️ "也可以排" / "空闲时间" / "在 Y 段时间排 X" 语义（关键，常见误判！）
- 用户说"X 时间段也可以排 Y 任务" / "Y 任务在 7.17-7.27 也排一些" → **不是**删现有任务，是"在保留现有任务的前提下给 Y 加量"
- ❌ 禁止：看到"Y 在 X 段时间没排"就 remove 该时间段的 A、B
- ❌ 禁止：把"在 Y 段时间安排 X 和 Z"理解成"用 X 和 Z 替换现有任务"
- ✅ 默认行为：**保留** currentPlan 现有 entries，**只 add** 新 task 到指定时间段
- 判断流程（按顺序匹配）：
  1. 用户说"X 这周不做" / "暂停 X" / "不要 X" → 明确删 X + recompute_range
  2. 用户说"X 替换 Y" / "换成 X" / "用 X 代替 Y" → swap
  3. **默认（其它所有情况，包括"安排 X"、"X 也排"、"X 多排"）** → 保留现有 + add X

# 调整原则
1. **优先用 recompute_range**：超过 3 天的范围调整必须用 recompute_range
2. **"多排" vs "增加容量"**：
   - "X task 在 Y 范围多排" = add X 在 Y 范围 + hours
   - "增加每天可用时间" = set_daily_hours（仅当用户明确说"增加时间"时）
3. **优先用 swap**：把紧急 task 从 deadline 远的 days 移到 deadline 紧的 days
4. **每天总量不能超过 dailyHours[date]**
5. **今天的 plan 也可调整**：如果用户明确说"今天"
6. **保持任务完成量 = total**：swap/add/remove 之后所有天数总量应保持不变
7. **minimize changes**：用最少的 actions 完成用户需求
8. **swap 目标日期不能超出 task.deadline**
9. **避免空档**：daily_hours > 总装 hours 时输出 recompute_range

# 计算 hint
- rate = units_per_period / period_hours（如 25/1 = 25 单位/h）
- planned_hours × rate = planned_amount
`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.status(204).end()
    return
  }

  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'POST') {
    res.status(405).end('Method Not Allowed')
    return
  }

  const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) {
    res.status(500).json({
      error: 'DASHSCOPE_API_KEY not set',
      diagnosis: {
        envVarName: 'DASHSCOPE_API_KEY',
        hint: '在 Vercel Project Settings → Environment Variables 添加 DASHSCOPE_API_KEY，然后重新部署',
      },
    })
    return
  }

  if (!apiKey.startsWith('sk-')) {
    res.status(500).json({
      error: 'DASHSCOPE_API_KEY format invalid',
      diagnosis: { startsWith: apiKey.slice(0, 4), expected: 'sk-' },
    })
    return
  }

  const input = req.body

  const mode = input?.mode === 'adjust' ? 'adjust' : 'generate'
  const systemPrompt = mode === 'adjust' ? SYSTEM_PROMPT_ADJUST : SYSTEM_PROMPT_GENERATE
  const userPrompt = JSON.stringify(input, null, 2)

  // 用 AbortController 给 dashscope 25s 上限（避免 Vercel 60s 函数超时触发 504）
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)

  try {
    const upstream = await fetch(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen-turbo',
          temperature: 0.3,
          max_tokens: 6000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timeout)
    const respBody = await upstream.text()
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(respBody)
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === 'AbortError') {
      res.status(504).json({
        error: 'dashscope 请求超时（25s）',
        hint: '可能是 prompt 太长或模型响应慢。试试简化请求，或联系管理员。',
      })
      return
    }
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Upstream fetch failed',
    })
  }
}
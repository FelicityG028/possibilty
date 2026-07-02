import { defineConfig, type Plugin, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync, readFileSync } from 'fs'

/**
 * 关键修复：Vite 默认只注入 VITE_ 前缀的变量。
 * 我们的 DASHSCOPE_API_KEY 没有 VITE_ 前缀（为了不暴露到前端 bundle），
 * 所以 Vite 不会自动注入到 process.env。
 *
 * 用 loadEnv 显式加载所有变量（包括无前缀的），
 * 然后手动设置到 process.env，这样后端代码能读到。
 */
const extraEnv = loadEnv(
  process.env.NODE_ENV ?? 'development',
  process.cwd(),
  '' // 空 prefix 表示加载所有变量
)
for (const [key, value] of Object.entries(extraEnv)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}

/**
 * AI Agent 后端：两种模式
 * 1. **生成模式**（默认）：基于任务列表 + 每天学习时间，生成完整 plan
 * 2. **调整模式**（mode='adjust'）：基于当前 plan + 用户需求，输出调整 actions
 *
 * 避免 OpenAI/Qwen key 暴露到前端 bundle。
 *
 * 仅 dev server 生效。生产环境用 Cloudflare Pages Function (functions/api/agent.ts)。
 *
 * 路径：POST /api/agent
 * 请求体：
 *   - 生成模式：{ today, dailyHours, defaultHours, tasks, existingToday }
 *   - 调整模式：{ mode: 'adjust', today, currentPlan, tasks, dailyHours, defaultHours, userRequest }
 * 响应：原样返回 dashscope response（含 choices[0].message.content）
 */

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
- **空出时间必须补上**：如果用户说"X 这周不做"，必须输出 recompute_range 让 A、B 填满 C 留下的空
- 例 1：用户说"C 这周不做"
  → actions: 7 个 remove（C 这 7 天）
  → recompute_range: { from: 本周一, to: 本周日 }
  → 前端：删这周所有 entries
  → 调 generatePlan 重算（remaining 少了 C，所以 A、B 自动填满 C 留下的空）
- 例 2：用户说"政治 7.16 之前不排，全部排到 7.17-7.30"
  → actions: 不需要逐天 remove（用 recompute_range）
  → recompute_range: { from: 7-01, to: 7-16 }（范围内会重新排：政治从 7-01 到 7-16 减少到 0，7-17 后多装）
  → 7.17-7.30 范围内 recompute：政治在 7.17-7.30 装满
  → 实际效果：政治 7.01-7.16 的 entries 被 replace，7.17-7.30 多装
- 例 3：用户说"今天超额 5h，明天起重新排"
  → actions: []
  → recompute_range: { from: 明天, to: 长期 deadline 最大的 task }
  → actions: [add 政治 today +2h]
  → recompute_range 不输出（今天不重算）
- 例 3：用户说"今天超额 5h，明天起重新排"
  → actions: []
  → recompute_range: { from: 明天, to: 长期 deadline 最大的 task }

# 调整原则
1. **优先用 swap**：把紧急 task 从 deadline 远的 days 移到 deadline 紧的 days
2. **每天总量不能超过 dailyHours[date]**：调整后总 hours ≤ 当天容量
3. **今天的 plan 也可调整**：如果用户明确说"今天"，可动今天
4. **保持任务完成量 = total**：swap/add/remove 之后所有天数总量应保持不变
5. **minimize changes**：用最少的 actions 完成用户需求
6. **如果调整让某范围"空出时间"**：输出 recompute_range 让算法自动重排填满

# 计算 hint
- rate = units_per_period / period_hours（如 25/1 = 25 单位/h）
- planned_hours × rate = planned_amount
`

function agentProxy(): Plugin {
  return {
    name: 'agent-proxy',
    configureServer(server) {
      server.middlewares.use('/api/agent', async (req: IncomingMessage, res: ServerResponse) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        const apiKey = process.env.DASHSCOPE_API_KEY?.trim()
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'DASHSCOPE_API_KEY not set',
              diagnosis: {
                envVarName: 'DASHSCOPE_API_KEY',
                processEnvValue: process.env.DASHSCOPE_API_KEY
                  ? `set (${process.env.DASHSCOPE_API_KEY.length} chars, starts with "${process.env.DASHSCOPE_API_KEY.slice(0, 4)}")`
                  : 'undefined / empty',
                hint: 'Restart dev server (Ctrl+C then npm run dev) after adding to .env.local. Vite loads env at startup only.',
                filePath: '/Users/jdub/Code/2026-gzy-kaoyan/possibilty/.env.local',
              },
            })
          )
          return
        }

        // 验证 key 格式（通义千问 key 应以 sk- 开头）
        if (!apiKey.startsWith('sk-')) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'DASHSCOPE_API_KEY format invalid',
              diagnosis: {
                startsWith: apiKey.slice(0, 4),
                expected: 'sk- (DashScope key prefix)',
                length: apiKey.length,
              },
            })
          )
          return
        }

        console.log(`[agent-proxy] key loaded: ${apiKey.slice(0, 4)}... (${apiKey.length} chars)`)

        // 读 body
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const bodyStr = Buffer.concat(chunks).toString('utf-8')
        const input = JSON.parse(bodyStr)

        // 根据 mode 选 system prompt
        const mode = input.mode === 'adjust' ? 'adjust' : 'generate'
        const systemPrompt =
          mode === 'adjust' ? SYSTEM_PROMPT_ADJUST : SYSTEM_PROMPT_GENERATE

        // 构造 user prompt：把 input 直接 JSON 化
        const userPrompt = JSON.stringify(input, null, 2)

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
                model: 'qwen-turbo',
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

          const respStatus = upstream.status
          const respBody = await upstream.text()
          // 打印前 1500 字符（含完整 content），方便调试
          console.log(
            `[agent-proxy] dashscope ${respStatus}: ${respBody.slice(0, 1500)}`
          )
          res.statusCode = respStatus
          res.setHeader('Content-Type', 'application/json')
          res.end(respBody)
        } catch (err) {
          console.error('[agent-proxy] fetch failed:', err)
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Upstream fetch failed',
            })
          )
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), agentProxy()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
})

// 启动时打印 env 状态（仅 dev server 启动时一次）
const _cwd = process.cwd()
const _envPath = path.resolve(_cwd, '.env.local')
const _exists = existsSync(_envPath)

console.log(`\n[agent-proxy] dev server starting`)
console.log(`[agent-proxy] cwd: ${_cwd}`)
console.log(`[agent-proxy] .env.local path: ${_envPath}`)
console.log(`[agent-proxy] .env.local exists: ${_exists ? 'YES' : 'NO'}`)

if (_exists) {
  // 解析 .env.local 看 DASHSCOPE_API_KEY 这一行
  const content = readFileSync(_envPath, 'utf-8')
  const match = content.match(/^DASHSCOPE_API_KEY=(.*)$/m)
  console.log(
    `[agent-proxy] .env.local has DASHSCOPE_API_KEY line: ${match ? `YES (${match[1].length} chars)` : 'NO'}`
  )
}

const _key = process.env.DASHSCOPE_API_KEY
console.log(
  `[agent-proxy] DASHSCOPE_API_KEY in process.env: ${_key ? `${_key.slice(0, 4)}... (${_key.length} chars)` : 'NOT SET'}`
)
console.log('')

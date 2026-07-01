import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * AI Agent 后端：构造 prompt + 调 OpenAI，返回排程结果。
 * 避免 OpenAI key 暴露到前端 bundle。
 *
 * 仅 dev server 生效。生产环境用 Cloudflare Pages Function (functions/api/agent.ts)。
 *
 * 路径：POST /api/agent
 * 请求体：{ today, dailyHours, defaultHours, tasks, existingToday }
 * 响应：{ entries: [...], reasoning, overflow_notes }
 */
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

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error:
                'OPENAI_API_KEY not set. Add it to .env.local (for dev) or .dev.vars (for Cloudflare Pages).',
            })
          )
          return
        }

        // 读 body
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const bodyStr = Buffer.concat(chunks).toString('utf-8')
        const input = JSON.parse(bodyStr)

        // 构造 user prompt：把 input 直接 JSON 化
        const userPrompt = JSON.stringify(input, null, 2)

        try {
          const upstream = await fetch(
            'https://api.openai.com/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0.3,
                max_tokens: 3000,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  { role: 'user', content: userPrompt },
                ],
              }),
            }
          )

          const respBody = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('Content-Type', 'application/json')
          res.end(respBody)
        } catch (err) {
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

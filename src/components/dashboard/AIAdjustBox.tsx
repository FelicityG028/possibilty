import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useSubTasks } from '@/hooks/useSubTasks'
import { useDailyPlanEntries } from '@/hooks/useDailyPlan'
import { useDailySettings, useDefaultSetting, useSetDailyHours } from '@/hooks/useDailySettings'
import {
  toAdjustmentPlan,
  toAdjustmentTasks,
  toDailyHoursMapForAdj,
  applyActions,
  isInRange,
  type AdjustmentAction,
  type AdjustmentOutput,
} from '@/lib/plannerAgent'
import { generatePlan, todayIso } from '@/lib/planner'
import type { SubTask, DailySetting, DailyPlanEntry } from '@/lib/types'
import { Button } from '@/components/ui/Button'

// 任务 deadline map（用于 clamp plan_date 不超出 task 范围）
function buildDeadlineMap(tasks: SubTask[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of tasks) {
    if (t.deadline) m.set(t.id, t.deadline)
  }
  return m
}

const FORWARD_DAYS = 30

/**
 * 把 AI 输出的 actions + recompute_range 应用到 DB
 *
 * 简化流程（任何调整都直接覆盖）：
 * 1. 处理 set_daily_hours actions（写 daily_settings）
 * 2. 构造新 entries：baseEntries + apply actions + (如有 recompute_range) 用 generatePlan 重算范围
 * 3. clamp plan_date 到 task.deadline
 * 4. RPC 写回（直接覆盖；actual_hours 保留）
 */
async function applyAdjustments(args: {
  output: AdjustmentOutput
  userRequest: string
  today: string
  baseEntries: DailyPlanEntry[]
  tasks: SubTask[]
  daily: DailySetting[]
  defaultHours: number
  setDailyHours: (date: string, hours: number) => Promise<unknown>
  qc: ReturnType<typeof useQueryClient>
}) {
  const { output, today, baseEntries, tasks, daily, defaultHours, setDailyHours, qc } = args

  // 1. set_daily_hours actions 写到 daily_settings
  for (const a of output.actions) {
    if (a.type === 'set_daily_hours') {
      await setDailyHours(a.date, a.hours)
    }
  }

  // 2. 计算最终 entries
  // 2a. 范围外（swap / 范围外的 add/remove）应用到 baseEntries
  let entries: DailyPlanEntry[] = baseEntries
  console.log('[AIAdjust] output.recompute_range =', JSON.stringify(output.recompute_range), '| actions.length =', output.actions.length, '| baseEntries count =', baseEntries.length)
  if (output.recompute_range) {
    console.log('[AIAdjust] >>> entering recompute_range branch')
    const { from, to } = output.recompute_range
    // 把 actions 分为：范围内 vs 范围外
    // 范围外：apply 到 baseEntries（用户改的范围外日期）
    // 范围内：保留 baseEntries 的原 entries + add actions（不删！）
    //       （因为 add actions 是用户明确要求保留的）
    // 但范围内 baseEntries 中**除了用户 add 之外的**应该删（让 generatePlan 重算）
    const actionsOutsideRange = output.actions.filter((a) => {
      if (a.type === 'swap') {
        return a.from_date < from || a.from_date > to || a.to_date < from || a.to_date > to
      }
      if (a.type === 'add' || a.type === 'remove') {
        return a.date < from || a.date > to
      }
      return true
    })
    // 范围外的 actions 直接 apply
    entries = applyActions(baseEntries, actionsOutsideRange)
    console.log('[AIAdjust] after applyActions(actionsOutsideRange), entries count =', entries.length)

    // ★ 收集范围内 add actions（这些是用户明确要的，保留！）
    const inRangeAdds: typeof output.actions = []
    for (const a of output.actions) {
      if (a.type === 'add' && a.date >= from && a.date <= to) {
        inRangeAdds.push(a)
      }
    }

    // 删除范围内除了 add actions 涉及的 entry 之外的所有 entries
    const addKeys = new Set(
      inRangeAdds
        .filter((a): a is Extract<typeof a, { type: 'add' }> => a.type === 'add')
        .map(a => `${a.date}|${a.sub_task_id}`)
    )
    entries = entries.filter(
      (e) => !(e.plan_date >= from && e.plan_date <= to && !addKeys.has(`${e.plan_date}|${e.sub_task_id}`))
    )
    console.log('[AIAdjust] after filter range, entries count =', entries.length)

    // generatePlan 重算范围（会基于 task 剩余 + 容量分配）
    const plan = generatePlan(tasks, daily, defaultHours, { startDate: from })
    console.log('[AIAdjust] plan.dates.length =', plan.dates.length)
    if (plan.dates.length > 0) {
      for (const d of plan.dates) {
        if (!isInRange(d, from, to)) continue
        for (const e of plan.byDate[d].entries) {
          entries.push({
            id: '',
            plan_date: d,
            sub_task_id: e.sub_task_id,
            planned_amount: e.planned_amount,
            planned_hours: e.planned_hours,
            is_completed: false,
            actual_amount: null,
            actual_hours: null,
            notes: null,
            created_at: new Date().toISOString(),
          })
        }
      }
    }
    console.log('[AIAdjust] after generatePlan push, entries count =', entries.length)
  } else {
    console.log('[AIAdjust] >>> entering ELSE branch (no recompute_range)')
    // 没有 recompute_range：直接 apply 所有 actions
    entries = applyActions(baseEntries, output.actions)
  }

  // 3. clamp plan_date 到 task.deadline
  const deadlineMap = buildDeadlineMap(tasks)
  const tagged = entries.map((e) => {
    const dl = deadlineMap.get(e.sub_task_id)
    let planDate = e.plan_date
    if (dl && planDate > dl) planDate = dl
    return {
      plan_date: planDate,
      sub_task_id: e.sub_task_id,
      planned_amount: e.planned_amount,
      planned_hours: e.planned_hours,
      actual_hours: e.actual_hours ?? null,
    }
  })

  // 4. 写回 DB
  console.log('[AIAdjust] tagged count:', tagged.length, '| sample first 3:',
    tagged.slice(0, 3).map(e => `${e.plan_date}|${e.sub_task_id.slice(0,8)}|h=${e.planned_hours}`).join(' / '))
  if (tagged.length === 0) return
  const { error: rpcErr, data: rpcData } = await supabase.rpc('sync_daily_plan', {
    p_entries: tagged,
    p_delete_from: today,
  })
  if (rpcErr) {
    // eslint-disable-next-line no-console
    console.error('[AIAdjust] RPC FAILED:', rpcErr.message)
    return
  }
  console.log('[AIAdjust] RPC success:', rpcData)
  // 刷新 React Query 缓存，让 UI 显示最新 entries
  qc.invalidateQueries({ queryKey: ['daily_plan'] })
  qc.invalidateQueries({ queryKey: ['daily_summary'] })
}

/**
 * AI 调整输入框
 * 用户输入需求（如"今天多排政治 8h"），AI 返回 actions，前端应用到 plan
 */
export function AIAdjustBox() {
  const { data: tasks = [] } = useSubTasks()
  const { data: entries = [] } = useDailyPlanEntries()
  const { data: daily = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const qc = useQueryClient()
  const setDailyHoursMut = useSetDailyHours()

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动调高 textarea：根据内容高度调整，最小 36px，最大 200px
  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(Math.max(el.scrollHeight, 36), 200) + 'px'
  }

  const [request, setRequest] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastResult, setLastResult] = useState<{
    actions: AdjustmentAction[]
    reasoning: string
    recompute_range?: { from: string; to: string }
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAdjust() {
    if (!request.trim()) return
    setIsLoading(true)
    setError(null)
    setLastResult(null)

    try {
      const today = todayIso()
      const taskMap = new Map(tasks.map((t) => [t.id, t.name]))
      const currentPlan = toAdjustmentPlan(entries, taskMap)
      const adjTasks = toAdjustmentTasks(tasks)
      const dailyHours = toDailyHoursMapForAdj(
        daily,
        defaultSetting?.available_hours ?? 6,
        today,
        FORWARD_DAYS
      )

      const resp = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'adjust',
          today,
          currentPlan,
          tasks: adjTasks,
          dailyHours,
          defaultHours: defaultSetting?.available_hours ?? 6,
          userRequest: request,
        }),
      })

      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`Agent API ${resp.status}: ${errText.slice(0, 200)}`)
      }

      const wrapper = await resp.json()
      const content = wrapper?.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        throw new Error(`Missing content: ${JSON.stringify(wrapper).slice(0, 200)}`)
      }

      const jsonText = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim()

      // Fallback: 截取第一个完整 {...} JSON（处理 AI 输出被截断的情况）
      let output: AdjustmentOutput
      try {
        output = JSON.parse(jsonText)
      } catch (e) {
        const firstBrace = jsonText.indexOf('{')
        if (firstBrace >= 0) {
          // 找到最外层匹配的右大括号
          let depth = 0
          let endIdx = -1
          for (let i = firstBrace; i < jsonText.length; i++) {
            if (jsonText[i] === '{') depth++
            else if (jsonText[i] === '}') {
              depth--
              if (depth === 0) {
                endIdx = i
                break
              }
            }
          }
          if (endIdx > 0) {
            const partial = jsonText.slice(firstBrace, endIdx + 1)
            console.warn('[AIAdjust] JSON truncated, trying partial:', partial.slice(0, 200))
            output = JSON.parse(partial)
          } else {
            throw new Error(`Failed to parse JSON: ${content.slice(0, 200)}`)
          }
        } else {
          throw new Error(`Failed to parse JSON: ${content.slice(0, 200)}`)
        }
      }

      if (!Array.isArray(output.actions)) {
        throw new Error(`Missing actions: ${jsonText.slice(0, 200)}`)
      }

      // ★ debug: 打印 LLM 完整输出
      console.log('[AIAdjust] LLM output:', JSON.stringify(output, null, 2))
      console.log('[AIAdjust] current tasks:', tasks.map(t => `${t.id.slice(0,8)} ${t.name} total=${(t as any).total_amount} done=${(t as any).completed_amount} deadline=${(t as any).deadline} rate=${(t as any).units_per_period}/${(t as any).period_hours}h`).join('\n  '))
      console.log('[AIAdjust] baseEntries count:', entries.length, 'sample:', entries.slice(0, 3).map(e => `${e.plan_date}|${e.sub_task_id.slice(0,8)}|h=${e.planned_hours}`).join(' / '))

      // 应用 adjustments（actions + recompute_range）到 DB
      await applyAdjustments({
        output,
        userRequest: request,
        today,
        baseEntries: entries,
        tasks,
        daily,
        defaultHours: defaultSetting?.available_hours ?? 6,
        setDailyHours: async (date, hours) => {
          await setDailyHoursMut.mutateAsync({ date, hours })
        },
        qc,
      })

      setLastResult({
        actions: output.actions,
        reasoning: output.reasoning || '',
        recompute_range: output.recompute_range,
      })
      setRequest('')
      // 用 setTimeout 等 DOM 更新后重置高度
      setTimeout(autoResize, 0)
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
      qc.invalidateQueries({ queryKey: ['daily_summary'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="p-3 rounded-lg"
      style={{ border: '1.5px dashed #111111', backgroundColor: '#FFFCF3' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: '#111111' }}>✨</span>
        <span className="text-sm font-medium" style={{ color: '#111111' }}>
          AI 调整排程
        </span>
        <span className="text-xs" style={{ color: '#666' }}>
          基于当前规划调整
        </span>
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={request}
          onChange={(e) => {
            setRequest(e.target.value)
            autoResize()
          }}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter 提交；Enter 单独按 = 换行
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isLoading) {
              e.preventDefault()
              handleAdjust()
            }
          }}
          placeholder="例：政治多排到 8h（⌘+Enter 提交）"
          disabled={isLoading}
          rows={1}
          className="flex-1 min-w-0 px-3 py-2 rounded text-sm focus:outline-none resize-none overflow-hidden"
          style={{
            border: '1.5px solid #111111',
            color: '#111111',
            backgroundColor: '#FFFFFF',
            maxHeight: '200px',
            minHeight: '36px',
            lineHeight: '1.4',
          }}
        />
        <Button
          onClick={handleAdjust}
          disabled={isLoading || !request.trim()}
          className="shrink-0 whitespace-nowrap"
          size="sm"
        >
          {isLoading ? '调整中…' : '调整'}
        </Button>
      </div>

      <div className="mt-1 text-right">
        <span
          className="text-xs"
          style={{ color: '#999' }}
          title="修改每日学习时间后会自动同步"
        >
          修改每日学习时间可自动同步
        </span>
      </div>

      {error && (
        <div
          className="mt-2 text-xs px-2 py-1 rounded"
          style={{ backgroundColor: '#EDBCDC', color: '#111111' }}
        >
          ❌ {error}
        </div>
      )}

      {lastResult && (
        <div
          className="mt-2 text-xs px-2 py-1 rounded"
          style={{ backgroundColor: '#EEE8DC', color: '#111111' }}
        >
          ✓ {lastResult.reasoning || `应用了 ${lastResult.actions.length} 个调整`}
        </div>
      )}
    </div>
  )
}

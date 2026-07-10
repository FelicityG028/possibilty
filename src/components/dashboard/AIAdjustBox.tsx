import { useState } from 'react'
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
 * 流程：
 * 1. 处理 set_daily_hours actions（写 daily_settings）
 * 2. 处理 swap/add/remove actions（构造新的 entries 数组）
 * 3. 如果有 recompute_range：删范围内 entries，调 generatePlan 重算，写回
 * 4. 标记 is_user_adjusted=true（让 sync 不覆盖）
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
}) {
  const { output, userRequest, today, baseEntries, tasks, daily, defaultHours, setDailyHours } = args

  // 1. set_daily_hours actions 写到 daily_settings
  for (const a of output.actions) {
    if (a.type === 'set_daily_hours') {
      await setDailyHours(a.date, a.hours)
    }
  }

  // 先拿 adjustmentId（recompute 范围里也要用）
  const affectedDates = Array.from(
    new Set(
      output.actions.flatMap((a) => {
        if (a.type === 'swap') return [a.from_date, a.to_date]
        if (a.type === 'add' || a.type === 'remove') return [a.date]
        return []
      })
    )
  )
  if (output.recompute_range) {
    affectedDates.push(output.recompute_range.from)
    affectedDates.push(output.recompute_range.to)
  }

  const { data: log } = await supabase
    .from('adjustment_logs')
    .insert({
      user_request: userRequest,
      reasoning: output.reasoning,
      actions: output.actions as unknown,
      affected_dates: affectedDates,
    })
    .select('id')
    .single()
  const adjustmentId = log?.id

  // 2. 计算基础 entries（先 apply swap/add/remove）
  const afterActions = applyActions(baseEntries, output.actions)

  // 3. 处理 recompute_range
  let finalEntries = afterActions
  if (output.recompute_range) {
    const { from, to } = output.recompute_range

    // ★ 关键修复：合并 actions + recompute_range
    // 如果 LLM 同时输出了 add/remove actions，**这些日期的精确意图优先**
    // 只有"没有显式修改过"的日期才用 generatePlan 重算（填补空缺）
    const explicitDates = new Set<string>()
    for (const a of output.actions) {
      if (a.type === 'swap') {
        explicitDates.add(a.from_date)
        explicitDates.add(a.to_date)
      } else if (a.type === 'add' || a.type === 'remove') {
        explicitDates.add(a.date)
      }
    }

    // 删范围内"非显式修改过"的 entries（让 generatePlan 重新填充）
    finalEntries = afterActions.filter(
      (e) =>
        !(e.plan_date >= from && e.plan_date <= to && !explicitDates.has(e.plan_date))
    )

    // 调 generatePlan 重算范围内（remaining 反映 actions 后的状态）
    const plan = generatePlan(tasks, daily, defaultHours, { startDate: from })
    if (plan.dates.length > 0) {
      for (const d of plan.dates) {
        if (!isInRange(d, from, to)) continue
        // 跳过"显式修改过的日期"——保留 LLM 的精确意图
        if (explicitDates.has(d)) continue
        for (const e of plan.byDate[d].entries) {
          // 转成 DailyPlanEntry（PlannedEntry 只有部分字段）
          finalEntries.push({
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
            is_user_adjusted: true, // recompute 范围里的也标调整
            adjustment_id: adjustmentId, // 占位（下面会覆盖）
          })
        }
      }
    }
  }

  // 5. 标记 is_user_adjusted + adjustment_id
  // clamp plan_date 到 task.deadline（防止 swap 或 generatePlan 错误写到 deadline 之后）
  const deadlineMap = buildDeadlineMap(tasks)
  const tagged = finalEntries.map((e) => {
    const dl = deadlineMap.get(e.sub_task_id)
    let planDate = e.plan_date
    if (dl && planDate > dl) planDate = dl
    return {
      ...e,
      plan_date: planDate,
      is_user_adjusted: true,
      adjustment_id: adjustmentId,
    }
  })

  // 6. 删 today+ 的所有 entries（除了 is_user_adjusted 的）
  const { data: oldNonAdjusted } = await supabase
    .from('daily_plan_entries')
    .select('id, plan_date, sub_task_id')
    .gte('plan_date', today)
    .eq('is_user_adjusted', false)
  if (oldNonAdjusted && oldNonAdjusted.length > 0) {
    await supabase
      .from('daily_plan_entries')
      .delete()
      .in(
        'id',
        oldNonAdjusted.map((e) => e.id)
      )
  }

  // 7. 写入新 entries（带 adjustment 标记）
  if (tagged.length > 0) {
    // log 任务名映射（排查 AI 是否找对 task）
    const taskMap = new Map(tasks.map((t) => [t.id, t.name]))
    const taskNames = new Set(
      tagged.map((e) => taskMap.get(e.sub_task_id) || '?')
    )
    console.log('[AIAdjust] writing tasks:', Array.from(taskNames).join(', '))
    const { error: rpcErr, data: rpcData } = await supabase.rpc('sync_daily_plan', {
      p_entries: tagged,
      p_delete_from: today,
    })
    if (rpcErr) {
      console.error('[AIAdjust] RPC FAILED:', rpcErr.message)
    } else {
      console.log('[AIAdjust] RPC success:', rpcData)
    }
  } else {
    console.warn('[AIAdjust] WARNING: tagged is empty, nothing to write')
  }
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
      })

      setLastResult({
        actions: output.actions,
        reasoning: output.reasoning || '',
        recompute_range: output.recompute_range,
      })
      setRequest('')
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
      qc.invalidateQueries({ queryKey: ['daily_summary'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * 清除所有 AI 调整：删 adjustment_logs + 删对应 is_user_adjusted entries
   * sync 会重算这些 days
   */
  async function clearAllAdjustments() {
    if (!confirm('清除所有 AI 调整？这会让 sync 用基线算法重排所有你之前调过的 days。')) return
    setIsLoading(true)
    setError(null)
    try {
      // 删 is_user_adjusted = true 的 entries
      await supabase
        .from('daily_plan_entries')
        .delete()
        .eq('is_user_adjusted', true)
      // 删 logs
      await supabase.from('adjustment_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      setLastResult({ actions: [], reasoning: '已清除所有调整，下次 sync 用基线算法重算' })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
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

      <div className="flex gap-2">
        <input
          type="text"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isLoading) handleAdjust()
          }}
          placeholder="例：政治多排到 8h"
          disabled={isLoading}
          className="flex-1 min-w-0 px-3 py-2 rounded text-sm focus:outline-none"
          style={{
            border: '1.5px solid #111111',
            color: '#111111',
            backgroundColor: '#FFFFFF',
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
        <button
          type="button"
          onClick={clearAllAdjustments}
          disabled={isLoading}
          className="text-xs underline"
          style={{ color: '#666' }}
        >
          清除所有 AI 调整（重置为基线）
        </button>
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

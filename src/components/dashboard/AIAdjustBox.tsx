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
  type AdjustmentAction,
  type AdjustmentOutput,
} from '@/lib/plannerAgent'
import { todayIso } from '@/lib/planner'
import { Button } from '@/components/ui/Button'

const FORWARD_DAYS = 30

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
  const setDailyHours = useSetDailyHours()

  const [request, setRequest] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastResult, setLastResult] = useState<{
    actions: AdjustmentAction[]
    reasoning: string
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

      let output: AdjustmentOutput
      try {
        output = JSON.parse(jsonText)
      } catch (e) {
        throw new Error(`Failed to parse JSON: ${content.slice(0, 200)}`)
      }

      if (!Array.isArray(output.actions)) {
        throw new Error(`Missing actions: ${jsonText.slice(0, 200)}`)
      }

      // 应用 actions 到 daily_plan_entries（持久化：标 is_user_adjusted）
      await applyToDb(output.actions, today, request, output.reasoning || '')

      setLastResult({ actions: output.actions, reasoning: output.reasoning || '' })
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

  async function applyToDb(
    actions: AdjustmentAction[],
    today: string,
    userRequest: string,
    reasoning: string
  ) {
    // set_daily_hours actions 单独处理
    for (const a of actions) {
      if (a.type === 'set_daily_hours') {
        await setDailyHours.mutateAsync({ date: a.date, hours: a.hours })
      }
    }

    // 其他 actions 应用到 daily_plan_entries
    const newEntries = applyActions(entries, actions)

    // 创建一个 adjustment_log 记录这次调整
    const affectedDates = Array.from(
      new Set(actions.flatMap((a) => {
        if (a.type === 'swap') return [a.from_date, a.to_date]
        if (a.type === 'add' || a.type === 'remove') return [a.date]
        return []
      }))
    )

    const { data: log } = await supabase
      .from('adjustment_logs')
      .insert({
        user_request: userRequest,
        reasoning,
        actions: actions as unknown,
        affected_dates: affectedDates,
      })
      .select('id')
      .single()

    const adjustmentId = log?.id

    // 标记 is_user_adjusted = true + adjustment_id
    const tagged = newEntries.map((e) => ({
      ...e,
      is_user_adjusted: true,
      adjustment_id: adjustmentId,
    }))

    // 删除今天及未来的旧 entries（但保留其他 adjustment 的）
    // 这里用 delete_by_actual_date，只删"非 is_user_adjusted + 不在 affected_dates"
    // 简化：只删今天以后"非 is_user_adjusted"的 entries
    const { data: oldNonAdjusted } = await supabase
      .from('daily_plan_entries')
      .select('id, plan_date, sub_task_id')
      .gte('plan_date', today)
      .eq('is_user_adjusted', false)

    if (oldNonAdjusted && oldNonAdjusted.length > 0) {
      const oldIds = oldNonAdjusted.map((e) => e.id)
      await supabase.from('daily_plan_entries').delete().in('id', oldIds)
    }

    // 写入新 entries（带 adjustment 标记）
    if (tagged.length > 0) {
      await supabase.rpc('sync_daily_plan', {
        p_entries: tagged,
        p_delete_from: today,
      })
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
          placeholder="例：今天和明天多排政治到 8h，文学史推到后天"
          disabled={isLoading}
          className="flex-1 px-3 py-2 rounded text-sm focus:outline-none"
          style={{
            border: '1.5px solid #111111',
            color: '#111111',
            backgroundColor: '#FFFFFF',
          }}
        />
        <Button onClick={handleAdjust} disabled={isLoading || !request.trim()}>
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

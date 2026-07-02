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

      // 应用 actions 到 daily_plan_entries
      await applyToDb(output.actions, today)

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

  async function applyToDb(actions: AdjustmentAction[], today: string) {
    // set_daily_hours actions 单独处理
    for (const a of actions) {
      if (a.type === 'set_daily_hours') {
        await setDailyHours.mutateAsync({ date: a.date, hours: a.hours })
      }
    }

    // 其他 actions 应用到 daily_plan_entries
    const newEntries = applyActions(entries, actions)

    // 删除今天及未来的旧 entries
    await supabase
      .from('daily_plan_entries')
      .delete()
      .gte('plan_date', today)

    // 写入新 entries
    if (newEntries.length > 0) {
      await supabase.rpc('sync_daily_plan', {
        p_entries: newEntries,
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

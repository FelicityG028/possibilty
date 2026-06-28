/**
 * 设置某天某任务的 actual_hours（用于 recurring 任务的每日完成度）
 *
 * 设计：
 *  - daily_plan_entries 表对 (plan_date, sub_task_id) 有 UNIQUE 约束
 *  - sync 会保留 actual_hours 不变
 *  - 这个 hook 仅更新 actual_hours
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface SetActualVars {
  date: string
  subTaskId: string
  /** null = 清除 */
  actualHours: number | null
}

export function useSetDailyActual() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, subTaskId, actualHours }: SetActualVars) => {
      const { error } = await supabase
        .from('daily_plan_entries')
        .update({ actual_hours: actualHours })
        .eq('plan_date', date)
        .eq('sub_task_id', subTaskId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    },
  })
}

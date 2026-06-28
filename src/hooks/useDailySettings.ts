import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DailySetting, DefaultSetting } from '@/lib/types'

const DAILY_KEY = ['daily_settings'] as const
const DEFAULT_KEY = ['default_settings'] as const

async function fetchDailySettings(): Promise<DailySetting[]> {
  const { data, error } = await supabase.from('daily_settings').select('*')
  if (error) throw error
  return (data ?? []) as DailySetting[]
}

async function fetchDefaultSetting(): Promise<DefaultSetting> {
  const { data, error } = await supabase
    .from('default_settings')
    .select('*')
    .eq('id', 1)
    .single()
  if (error) throw error
  return data as DefaultSetting
}

export function useDailySettings() {
  return useQuery({
    queryKey: DAILY_KEY,
    queryFn: fetchDailySettings,
  })
}

export function useDefaultSetting() {
  return useQuery({
    queryKey: DEFAULT_KEY,
    queryFn: fetchDefaultSetting,
  })
}

/** 获取某一天的有效可用时间（优先精确日期，否则回退到默认值） */
export function getAvailableHoursForDate(
  daily: DailySetting[] | undefined,
  defaultHours: number | undefined,
  dateIso: string
): number {
  const def = defaultHours ?? 6
  if (!daily) return def
  const exact = daily.find((s) => s.date === dateIso)
  return exact?.available_hours ?? def
}

export function useSetDailyHours() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, hours }: { date: string; hours: number }) => {
      const { error } = await supabase
        .from('daily_settings')
        .upsert({ date, available_hours: hours }, { onConflict: 'date' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DAILY_KEY })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    },
  })
}

export function useClearDailyHours() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (date: string) => {
      const { error } = await supabase.from('daily_settings').delete().eq('date', date)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DAILY_KEY })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    },
  })
}

export function useSetDefaultHours() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (hours: number) => {
      const { error } = await supabase
        .from('default_settings')
        .upsert({ id: 1, available_hours: hours })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DEFAULT_KEY })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    },
  })
}

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DailyPlanEntry } from '@/lib/types'

const QUERY_KEY = ['daily_plan'] as const

async function fetchDailyPlanEntries(): Promise<DailyPlanEntry[]> {
  const { data, error } = await supabase
    .from('daily_plan_entries')
    .select('*')
    .order('plan_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as DailyPlanEntry[]
}

export function useDailyPlanEntries() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchDailyPlanEntries,
  })
}

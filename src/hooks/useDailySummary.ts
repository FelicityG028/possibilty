import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DailySummary } from '@/lib/types'

const QUERY_KEY = ['daily_summary'] as const

async function fetchDailySummary(): Promise<DailySummary[]> {
  const { data, error } = await supabase
    .from('daily_summary')
    .select('*')
    .order('date', { ascending: false })
    .limit(365)
  if (error) throw error
  return (data ?? []) as DailySummary[]
}

export function useDailySummary() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchDailySummary,
    staleTime: 1000 * 60, // 1 min
  })
}

export function getSummaryForDate(
  summaries: DailySummary[] | undefined,
  dateIso: string
): DailySummary | undefined {
  return summaries?.find((s) => s.date === dateIso)
}

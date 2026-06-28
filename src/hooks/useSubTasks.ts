import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SubTask, SubTaskInsert, SubTaskUpdate } from '@/lib/types'

const QUERY_KEY = ['sub_tasks'] as const

async function fetchSubTasks(): Promise<SubTask[]> {
  const { data, error } = await supabase
    .from('sub_tasks')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as SubTask[]
}

export function useSubTasks() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchSubTasks,
  })
}

export function useCreateSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SubTaskInsert) => {
      const { data, error } = await supabase
        .from('sub_tasks')
        .insert(input)
        .select()
        .single()
      if (error) throw error
      return data as SubTask
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    },
  })
}

export function useUpdateSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: SubTaskUpdate }) => {
      const { data, error } = await supabase
        .from('sub_tasks')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as SubTask
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    },
  })
}

export function useDeleteSubTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sub_tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['daily_plan'] })
    },
  })
}

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { seedCategories } from '@/lib/seedCategories'
import type { Category } from '@/lib/types'

const QUERY_KEY = ['categories'] as const

async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as Category[]
}

/**
 * 启动时确保 8 大类已存在，然后返回类别列表。
 */
export function useEnsureCategories() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchCategories,
    staleTime: 1000 * 60 * 60, // 1 hour
  })

  useEffect(() => {
    if (query.data && query.data.length < 8) {
      seedCategories().then(() => query.refetch())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data?.length])

  return query
}

/** 别名，避免命名冲突 */
export function useCategories() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchCategories,
  })
}

/**
 * 8 大类种子数据。前端在启动时检查并插入（不覆盖已有数据）。
 * 实际生产环境更推荐在 Supabase SQL Editor 中跑 migrations/0001_init.sql，
 * 该文件作为前端兜底方案。
 */
import { supabase } from './supabase'
import type { Category } from './types'

export const SEED_CATEGORIES: Omit<Category, 'created_at'>[] = [
  { id: 1, name: '看书',         unit_label: '页', color: '#3b82f6', icon: '📖', sort_order: 1 },
  { id: 2, name: '看网课',       unit_label: '节', color: '#a855f7', icon: '🎬', sort_order: 2 },
  { id: 3, name: '刷题',         unit_label: '道', color: '#10b981', icon: '✏️', sort_order: 3 },
  { id: 4, name: '背诵知识点',   unit_label: '个', color: '#f59e0b', icon: '🧠', sort_order: 4 },
  { id: 5, name: '背诵单词',     unit_label: '个', color: '#ec4899', icon: '📝', sort_order: 5 },
  { id: 6, name: '梳理教材',     unit_label: '章', color: '#14b8a6', icon: '📚', sort_order: 6 },
  { id: 7, name: '整理论文',     unit_label: '篇', color: '#6366f1', icon: '📄', sort_order: 7 },
  { id: 8, name: '整理框架',     unit_label: '个', color: '#f97316', icon: '🗂️', sort_order: 8 },
]

/**
 * 插入 8 大类（如果尚未存在）。可重复调用，幂等。
 */
export async function seedCategories(): Promise<void> {
  const { error } = await supabase
    .from('categories')
    .upsert(SEED_CATEGORIES, { onConflict: 'name', ignoreDuplicates: true })

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[seedCategories] failed:', error)
  }
}

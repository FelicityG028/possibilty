-- ============================================================================
-- 0002_add_recurring.sql
-- 支持"每日固定时长"任务（如 背单词 30min/天）
-- 在 Supabase 控制台 SQL Editor 增量运行（不会丢失已有数据）
-- ============================================================================

-- 1. 允许 finite 专用字段为 NULL（recurring 不需要这些）
ALTER TABLE public.sub_tasks
  ALTER COLUMN total_amount     DROP NOT NULL,
  ALTER COLUMN units_per_period DROP NOT NULL,
  ALTER COLUMN period_hours     DROP NOT NULL,
  ALTER COLUMN deadline         DROP NOT NULL;

-- 2. 添加 kind 和 daily_hours
ALTER TABLE public.sub_tasks
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'finite'
    CHECK (kind IN ('finite', 'recurring')),
  ADD COLUMN IF NOT EXISTS daily_hours NUMERIC(5, 2)
    CHECK (daily_hours IS NULL OR (daily_hours > 0 AND daily_hours <= 24));

-- 3. 替换 CHECK 约束
ALTER TABLE public.sub_tasks DROP CONSTRAINT IF EXISTS sub_tasks_completed_le_total;
ALTER TABLE public.sub_tasks DROP CONSTRAINT IF EXISTS sub_tasks_finite_check;
ALTER TABLE public.sub_tasks DROP CONSTRAINT IF EXISTS sub_tasks_kind_check;
ALTER TABLE public.sub_tasks ADD CONSTRAINT sub_tasks_kind_check CHECK (
  (kind = 'finite'    AND total_amount IS NOT NULL AND units_per_period IS NOT NULL
                       AND period_hours IS NOT NULL AND deadline IS NOT NULL)
  OR
  (kind = 'recurring' AND daily_hours IS NOT NULL)
);

-- 4. completed_amount 也要放宽：允许 > total_amount（recurring 模式）
--    或者保持 0 默认即可
ALTER TABLE public.sub_tasks DROP CONSTRAINT IF EXISTS sub_tasks_completed_le_total;

-- ============================================================================
-- 0003_recurring_deadline.sql
-- 允许 recurring 任务有截止时间（可选）
-- ============================================================================

-- 替换 kind CHECK 约束：recurring 可以有 deadline
ALTER TABLE public.sub_tasks DROP CONSTRAINT IF EXISTS sub_tasks_kind_check;
ALTER TABLE public.sub_tasks ADD CONSTRAINT sub_tasks_kind_check CHECK (
  (kind = 'finite'    AND total_amount IS NOT NULL AND units_per_period IS NOT NULL
                       AND period_hours IS NOT NULL AND deadline IS NOT NULL)
  OR
  (kind = 'recurring' AND daily_hours IS NOT NULL)
);
-- 注意：recurring 任务的 deadline 仍然是可选的（可为 NULL = 永久有效）

-- 添加 daily_plan_entries.actual_amount 自动初始化列
-- （如已存在则跳过）
ALTER TABLE public.daily_plan_entries
  ADD COLUMN IF NOT EXISTS actual_hours NUMERIC(8, 2);

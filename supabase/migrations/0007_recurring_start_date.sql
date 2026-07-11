-- ============================================================================
-- 0007_recurring_start_date.sql
-- 给 recurring 任务加 start_date 字段，控制从哪天开始排
-- ============================================================================

ALTER TABLE public.sub_tasks
  ADD COLUMN IF NOT EXISTS start_date DATE;

COMMENT ON COLUMN public.sub_tasks.start_date IS
  'recurring 任务：从这天起每天排；不填则从今天起排。finite 任务忽略此字段';
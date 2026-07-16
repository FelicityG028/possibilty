-- ============================================================================
-- 0009_actual_amount.sql
-- 引入 actual_amount 列，让"完成量"与"计划"解耦
-- 之前 completed_amount 是从 planned_amount 累加的，计划一变已完成量就变
-- 现在 completed_amount = SUM(actual_amount) 通过 trigger 维护
-- ============================================================================

-- 1. 添加 actual_amount 列
ALTER TABLE public.daily_plan_entries
  ADD COLUMN IF NOT EXISTS actual_amount NUMERIC(12, 2) DEFAULT 0
    CHECK (actual_amount IS NULL OR actual_amount >= 0);

-- 2. 触发器：当 daily_plan_entries.actual_amount 变化时，自动聚合到 sub_tasks.completed_amount
CREATE OR REPLACE FUNCTION public.sync_completed_amount_from_entries()
RETURNS TRIGGER AS $$
DECLARE
  v_sub_task_id UUID;
  v_total NUMERIC(12, 2);
BEGIN
  -- 从 NEW 或 OLD 获取 sub_task_id（AFTER trigger 的 TG_OP 区分）
  v_sub_task_id := COALESCE(NEW.sub_task_id, OLD.sub_task_id);

  -- 聚合该 task 所有 daily_plan_entries.actual_amount
  SELECT COALESCE(SUM(actual_amount), 0)
    INTO v_total
    FROM public.daily_plan_entries
    WHERE sub_task_id = v_sub_task_id;

  -- 更新 sub_tasks.completed_amount
  UPDATE public.sub_tasks
    SET completed_amount = v_total,
        status = CASE
          WHEN v_total >= total_amount THEN 'completed'
          WHEN status = 'completed' THEN 'active'  -- 之前 completed 现在不满，重新 active
          ELSE status
        END
    WHERE id = v_sub_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_completed_amount ON public.daily_plan_entries;
CREATE TRIGGER trg_sync_completed_amount
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_plan_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_completed_amount_from_entries();

-- 3. 历史数据迁移：如果 daily_plan_entries 没有 actual_amount，但有 actual_hours，
--    用 actual_hours（recurring 任务的实际学习小时数）作为初始值
--    对 finite 任务保持 0（用户没记录实际完成）
UPDATE public.daily_plan_entries
  SET actual_amount = COALESCE(actual_hours, 0)
  WHERE actual_amount IS NULL;

-- 4. 重新同步所有 task 的 completed_amount（基于新的 actual_amount）
UPDATE public.sub_tasks t
  SET completed_amount = COALESCE((
    SELECT SUM(actual_amount)
    FROM public.daily_plan_entries
    WHERE sub_task_id = t.id
  ), 0);

-- 5. 索引：加快按 sub_task_id 聚合
CREATE INDEX IF NOT EXISTS idx_dpe_actual_amount_lookup
  ON public.daily_plan_entries(sub_task_id)
  WHERE actual_amount IS NOT NULL;
-- ============================================================================
-- 0005_sync_rpc.sql
-- 同步 RPC：在数据库端原子地完成 delete + upsert
-- 简化设计：任何调整都直接覆盖；不再区分 is_user_adjusted / adjustment_id
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_daily_plan(
  p_entries JSONB,
  p_delete_from DATE
) RETURNS TABLE(deleted_count INT, upserted_count INT) AS $$
DECLARE
  v_deleted INT;
  v_upserted INT;
BEGIN
  -- 1. 删除过期 entries（旧有但新 plan 没有的）
  --    简化：直接按 (plan_date, sub_task_id) 删除 p_entries 中不存在的
  WITH new_keys AS (
    SELECT
      (e->>'plan_date')::date AS plan_date,
      (e->>'sub_task_id')::uuid AS sub_task_id
    FROM jsonb_array_elements(p_entries) AS e
  )
  DELETE FROM public.daily_plan_entries dpe
  WHERE dpe.plan_date >= p_delete_from
    AND NOT EXISTS (
      SELECT 1 FROM new_keys nk
      WHERE nk.plan_date = dpe.plan_date AND nk.sub_task_id = dpe.sub_task_id
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 2. Upsert 新的 entries（事务内）
  --    先对 (plan_date, sub_task_id) 去重 + 合并，避免 21000 错误
  --    actual_hours 用 COALESCE 保留旧值（如果新 entries 没传）
  WITH aggregated AS (
    SELECT
      plan_date,
      sub_task_id,
      SUM(planned_amount) AS planned_amount,
      SUM(planned_hours)  AS planned_hours,
      (array_agg(actual_hours) FILTER (WHERE actual_hours IS NOT NULL))[1] AS actual_hours
    FROM (
      SELECT
        (e->>'plan_date')::date        AS plan_date,
        (e->>'sub_task_id')::uuid      AS sub_task_id,
        (e->>'planned_amount')::numeric AS planned_amount,
        (e->>'planned_hours')::numeric  AS planned_hours,
        (e->>'actual_hours')::numeric    AS actual_hours
      FROM jsonb_array_elements(p_entries) AS e
    ) raw
    GROUP BY plan_date, sub_task_id
  )
  INSERT INTO public.daily_plan_entries (plan_date, sub_task_id, planned_amount, planned_hours, actual_hours)
  SELECT plan_date, sub_task_id, planned_amount, planned_hours, actual_hours
  FROM aggregated
  ON CONFLICT (plan_date, sub_task_id) DO UPDATE SET
    planned_amount = EXCLUDED.planned_amount,
    planned_hours  = EXCLUDED.planned_hours,
    actual_hours   = COALESCE(EXCLUDED.actual_hours, public.daily_plan_entries.actual_hours);
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  RETURN QUERY SELECT v_deleted, v_upserted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.sync_daily_plan(JSONB, DATE) TO anon, authenticated;
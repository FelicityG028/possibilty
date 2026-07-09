-- ============================================================================
-- 0005_sync_rpc.sql
-- 创建同步 RPC 函数：在数据库端原子地完成 delete + upsert
-- 避免客户端 upsert + 复合唯一约束的 500/409 问题
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_daily_plan(
  p_entries JSONB,           -- 要 upsert 的 entries 数组
  p_delete_from DATE         -- 清理从哪天开始（通常是今天）
) RETURNS TABLE(deleted_count INT, upserted_count INT) AS $$
DECLARE
  v_deleted INT;
  v_upserted INT;
BEGIN
  -- 1. 删除过期 entries（旧有但新 plan 没有的）
  WITH new_keys AS (
    SELECT
      (e->>'plan_date')::date AS plan_date,
      (e->>'sub_task_id')::uuid AS sub_task_id
    FROM jsonb_array_elements(p_entries) AS e
  )
  -- 删"过期" entries（不在新 plan 里的）
  -- ★ 关键：跳过 is_user_adjusted=true 的 entries（不删 AI 调整的）
  DELETE FROM public.daily_plan_entries dpe
  WHERE dpe.plan_date >= p_delete_from
    AND NOT dpe.is_user_adjusted
    AND NOT EXISTS (
      SELECT 1 FROM new_keys nk
      WHERE nk.plan_date = dpe.plan_date AND nk.sub_task_id = dpe.sub_task_id
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 2. Upsert 新的 entries（事务内）
  --    先对 (plan_date, sub_task_id) 去重 + 合并，避免 21000 错误
  --    支持 is_user_adjusted / adjustment_id（v0.3+ 持久化 AI 调整用）
  --    不嵌套子查询（避免 e 列名歧义）
  WITH aggregated AS (
    SELECT
      (e->>'plan_date')::date        AS plan_date,
      (e->>'sub_task_id')::uuid      AS sub_task_id,
      SUM((e->>'planned_amount')::numeric) AS planned_amount,
      SUM((e->>'planned_hours')::numeric)  AS planned_hours,
      -- actual_hours：取任一非 null 值（前端会传相同的）
      (array_agg((e->>'actual_hours')::numeric) FILTER (WHERE e->>'actual_hours' IS NOT NULL))[1] AS actual_hours,
      -- is_user_adjusted：任一 entry 标记 true 则视为调整过
      COALESCE(bool_or((e->>'is_user_adjusted')::boolean), FALSE) AS is_user_adjusted,
      -- adjustment_id：取任一非空的（同一组 entries 应该用同一个 id）
      -- cast 为 uuid 因为列是 uuid 类型
      (array_agg((e->>'adjustment_id')::uuid) FILTER (WHERE e->>'adjustment_id' IS NOT NULL))[1] AS adjustment_id
    FROM jsonb_array_elements(p_entries) AS e
    GROUP BY (e->>'plan_date')::date, (e->>'sub_task_id')::uuid
  )
  INSERT INTO public.daily_plan_entries
    (plan_date, sub_task_id, planned_amount, planned_hours, actual_hours, is_user_adjusted, adjustment_id)
  SELECT plan_date, sub_task_id, planned_amount, planned_hours, actual_hours, is_user_adjusted, adjustment_id
  FROM aggregated
  ON CONFLICT (plan_date, sub_task_id) DO UPDATE SET
    planned_amount = EXCLUDED.planned_amount,
    planned_hours  = EXCLUDED.planned_hours,
    actual_hours   = COALESCE(EXCLUDED.actual_hours, public.daily_plan_entries.actual_hours),
    -- is_user_adjusted 同步（新的是 true 就 true；新是 false 保持旧值；防止 sync 把用户调整覆盖掉）
    is_user_adjusted = public.daily_plan_entries.is_user_adjusted OR EXCLUDED.is_user_adjusted,
    -- adjustment_id 同步
    adjustment_id = COALESCE(EXCLUDED.adjustment_id, public.daily_plan_entries.adjustment_id);
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  RETURN QUERY SELECT v_deleted, v_upserted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 授权 anon 角色调用
GRANT EXECUTE ON FUNCTION public.sync_daily_plan(JSONB, DATE) TO anon, authenticated;

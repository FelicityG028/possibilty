-- ============================================================================
-- 0008_simplify_plan.sql
-- 简化设计：去掉 is_user_adjusted / adjustment_id 概念
-- 数据库只管 daily_plan_entries，任何调整都直接覆盖
-- ============================================================================

-- 1. 删除 adjustment_logs 表（不再需要）
DROP TABLE IF EXISTS public.adjustment_logs;

-- 2. 删除 daily_plan_entries.is_user_adjusted 列
ALTER TABLE public.daily_plan_entries DROP COLUMN IF EXISTS is_user_adjusted;

-- 3. 删除 daily_plan_entries.adjustment_id 列
ALTER TABLE public.daily_plan_entries DROP COLUMN IF EXISTS adjustment_id;

-- 4. 删除相关索引
DROP INDEX IF EXISTS idx_dpe_user_adjusted;
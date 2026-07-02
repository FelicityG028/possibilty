-- ============================================================================
-- 0006_user_adjustments.sql
-- 让 AI 调整的 plan 不被下次 sync 覆盖
-- ============================================================================

-- 1. 加 is_user_adjusted 字段：标记这条 entry 是用户/AI 手动调整过的
ALTER TABLE public.daily_plan_entries
  ADD COLUMN IF NOT EXISTS is_user_adjusted BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. 加 adjustment_id：关联到具体的调整记录，方便失效/撤销
ALTER TABLE public.daily_plan_entries
  ADD COLUMN IF NOT EXISTS adjustment_id UUID;

-- 3. 索引：方便 sync 跳过
CREATE INDEX IF NOT EXISTS idx_dpe_user_adjusted
  ON public.daily_plan_entries(is_user_adjusted)
  WHERE is_user_adjusted = TRUE;

-- 4. 加 adjustment_logs 表：记录用户/AI 做了哪些调整
CREATE TABLE IF NOT EXISTS public.adjustment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_request TEXT NOT NULL,                       -- 用户输入的原文
  reasoning TEXT,                                     -- AI 解释
  actions JSONB NOT NULL,                             -- actions 数组
  affected_dates TEXT[] NOT NULL DEFAULT '{}',        -- 涉及的日期
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. RLS
ALTER TABLE public.adjustment_logs DISABLE ROW LEVEL SECURITY;

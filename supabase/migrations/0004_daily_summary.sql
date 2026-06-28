-- ============================================================================
-- 0004_daily_summary.sql
-- 新建 daily_summary 表：记录每天的预期学习时长和实际学习时长
-- 用于完成度统计和历史回顾
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.daily_summary (
  date             DATE PRIMARY KEY,
  -- 预期学习时长：来自 daily_settings 覆盖 或 default_settings
  expected_hours   NUMERIC(5, 2) NOT NULL,
  -- 实际学习时长：所有任务当天 actual 之和（自动汇总）
  actual_hours     NUMERIC(8, 2) NOT NULL DEFAULT 0,
  -- 完成度 0-1 = actual / expected（视图计算）
  -- 任务数
  task_count       INT NOT NULL DEFAULT 0,
  -- 是否加班：plan 总时长 > expected
  is_overflow      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON public.daily_summary(date);

-- RLS
ALTER TABLE public.daily_summary DISABLE ROW LEVEL SECURITY;

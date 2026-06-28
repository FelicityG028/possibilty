-- ============================================================================
-- 考研任务管理器 - 初始化 schema
-- 在 Supabase 控制台 SQL Editor 中运行此文件
-- ============================================================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. categories - 8 大类（种子数据由前端 seed）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  unit_label  TEXT NOT NULL,           -- "页"、"个"、"节" 等
  color       TEXT NOT NULL,           -- 十六进制颜色
  icon        TEXT,                    -- emoji 或图标名
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8 大类种子数据
INSERT INTO public.categories (name, unit_label, color, icon, sort_order) VALUES
  ('看书',         '页',  '#3b82f6', '📖', 1),
  ('看网课',       '节',  '#a855f7', '🎬', 2),
  ('刷题',         '道',  '#10b981', '✏️', 3),
  ('背诵知识点',   '个',  '#f59e0b', '🧠', 4),
  ('背诵单词',     '个',  '#ec4899', '📝', 5),
  ('梳理教材',     '章',  '#14b8a6', '📚', 6),
  ('整理论文',     '篇',  '#6366f1', '📄', 7),
  ('整理框架',     '个',  '#f97316', '🗂️', 8)
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. sub_tasks - 子任务
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sub_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       INT NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL,
  total_amount      NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
  units_per_period  NUMERIC(12, 2) NOT NULL CHECK (units_per_period > 0),
  period_hours      NUMERIC(8, 2)  NOT NULL CHECK (period_hours > 0),
  deadline          DATE NOT NULL,
  completed_amount  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (completed_amount >= 0),
  status            TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'paused', 'completed')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sub_tasks_completed_le_total CHECK (completed_amount <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_sub_tasks_status   ON public.sub_tasks(status);
CREATE INDEX IF NOT EXISTS idx_sub_tasks_deadline ON public.sub_tasks(deadline);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sub_tasks_updated_at ON public.sub_tasks;
CREATE TRIGGER trg_sub_tasks_updated_at
  BEFORE UPDATE ON public.sub_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. daily_settings - 每日可用学习时间（按日期覆盖）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_settings (
  date             DATE PRIMARY KEY,
  available_hours  NUMERIC(5, 2) NOT NULL CHECK (available_hours >= 0 AND available_hours <= 24)
);

-- ----------------------------------------------------------------------------
-- 3b. default_settings - 默认每日学习时间（单行表）
--    因为 PRIMARY KEY 不允许 NULL，单独成表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.default_settings (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  available_hours  NUMERIC(5, 2) NOT NULL CHECK (available_hours >= 0 AND available_hours <= 24)
);

INSERT INTO public.default_settings (id, available_hours)
VALUES (1, 6.0)  -- 默认每天 6 小时
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. daily_plan_entries - 每日计划条目（planner 写入的缓存）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_plan_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date       DATE NOT NULL,
  sub_task_id     UUID NOT NULL REFERENCES public.sub_tasks(id) ON DELETE CASCADE,
  planned_amount  NUMERIC(12, 2) NOT NULL CHECK (planned_amount >= 0),
  planned_hours   NUMERIC(8, 2)  NOT NULL CHECK (planned_hours >= 0),
  is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  actual_amount   NUMERIC(12, 2),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_date, sub_task_id)
);

CREATE INDEX IF NOT EXISTS idx_dpe_plan_date   ON public.daily_plan_entries(plan_date);
CREATE INDEX IF NOT EXISTS idx_dpe_sub_task_id ON public.daily_plan_entries(sub_task_id);

-- ----------------------------------------------------------------------------
-- 5. progress_logs - 进度历史（可选）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progress_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_task_id   UUID NOT NULL REFERENCES public.sub_tasks(id) ON DELETE CASCADE,
  amount_delta  NUMERIC(12, 2) NOT NULL,
  log_date      DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_progress_logs_sub_task ON public.progress_logs(sub_task_id);

-- ----------------------------------------------------------------------------
-- Row Level Security (单用户模式：全开放)
-- 由于 anon key 暴露给前端，按需启用 RLS 收紧权限。
-- 当前默认 disable RLS 以便单用户使用。
-- ----------------------------------------------------------------------------
ALTER TABLE public.categories          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_tasks           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_settings      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.default_settings    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_plan_entries  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_logs       DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 测试数据脚本：覆盖各种场景
-- 假设当前日期：2026-06-28
-- 用法：复制全部内容到 Supabase SQL Editor 运行
-- ============================================================================

-- 1. 清理所有数据（保留 categories 和 default_settings）
TRUNCATE public.sub_tasks CASCADE;
TRUNCATE public.daily_settings;
TRUNCATE public.daily_plan_entries CASCADE;
TRUNCATE public.daily_summary CASCADE;
TRUNCATE public.progress_logs CASCADE;
UPDATE public.default_settings SET available_hours = 6.0 WHERE id = 1;

-- 2. 有限任务 (finite)
INSERT INTO public.sub_tasks (category_id, name, kind, total_amount, units_per_period, period_hours, deadline, completed_amount, status) VALUES
  -- (1) 5 天后截止, 正常 pending, 大任务
  (1, '现代汉语教程',       'finite', 300, 1, 2, '2026-07-03',   0, 'active'),
  -- (2) 2 天后截止, 紧急 (应被排在前几天)
  (1, '古代汉语冲刺',       'finite', 100, 1, 1, '2026-06-30',   0, 'active'),
  -- (3) 已完成的任务
  (2, '现代文学课',         'finite',  50, 1, 1, '2026-07-30',  50, 'completed'),
  -- (4) 逾期任务 (deadline 已过, 部分完成)
  (3, '外国文学真题',       'finite', 200, 10, 1, '2026-06-15', 50, 'active'),
  -- (5) 进行中的任务
  (4, '文学理论背诵',       'finite', 150, 10, 1, '2026-07-12', 60, 'active'),
  -- (6) 暂停的任务 (不参与排程)
  (6, '外国文学教材梳理',   'finite',  10, 1, 1, '2026-06-25',   0, 'paused');

-- 3. 每日任务 (recurring)
INSERT INTO public.sub_tasks (category_id, name, kind, daily_hours, deadline, status) VALUES
  -- (7) 每天 0.5h, 无截止
  (5, '英语单词',           'recurring', 0.5, NULL,           'active'),
  -- (8) 每天 1.5h, 8/30 截止
  (4, '政治冲刺背诵',       'recurring', 1.5, '2026-08-30',   'active');

-- 4. 每日设置: 今日临时改为 5h, 昨天 7h
INSERT INTO public.daily_settings (date, available_hours) VALUES
  (CURRENT_DATE,       5.0),
  (CURRENT_DATE - 1,   7.0);

-- 5. 昨天的 plan entries (模拟用户已用过 app)
--    现代汉语教程: 计划 30 页, 实际完成 30 页
--    英语单词:     计划 0.5h,  实际完成 0.5h
INSERT INTO public.daily_plan_entries (plan_date, sub_task_id, planned_amount, planned_hours, actual_hours)
VALUES
  (CURRENT_DATE - 1,
   (SELECT id FROM public.sub_tasks WHERE name = '现代汉语教程' LIMIT 1),
   30, 60, 60),
  (CURRENT_DATE - 1,
   (SELECT id FROM public.sub_tasks WHERE name = '英语单词'     LIMIT 1),
   0,  0.5, 0.5);

-- 6. 校验
SELECT
  'sub_tasks 总数'       AS 表, count(*) AS 行数 FROM public.sub_tasks
UNION ALL SELECT '有限任务',     count(*) FROM public.sub_tasks WHERE kind = 'finite'
UNION ALL SELECT '每日任务',     count(*) FROM public.sub_tasks WHERE kind = 'recurring'
UNION ALL SELECT 'active',       count(*) FROM public.sub_tasks WHERE status = 'active'
UNION ALL SELECT 'completed',    count(*) FROM public.sub_tasks WHERE status = 'completed'
UNION ALL SELECT 'paused',       count(*) FROM public.sub_tasks WHERE status = 'paused'
UNION ALL SELECT 'daily_settings', count(*) FROM public.daily_settings
UNION ALL SELECT 'daily_plan_entries', count(*) FROM public.daily_plan_entries
UNION ALL SELECT 'default_settings',  available_hours FROM public.default_settings WHERE id = 1;

-- ============================================================
-- 一键导出所有数据
-- 所有 query 都强制输出 8 列（UNION ALL 要求列数一致）
-- ============================================================

(
  SELECT 'category' AS table_name, id::text AS field_1, name AS field_2, color AS field_3, unit_label AS field_4,
         '' AS field_5, '' AS field_6, '' AS field_7, '' AS field_8
  FROM public.categories
  ORDER BY sort_order
)
UNION ALL
(
  SELECT 'sub_task',
    name, kind,
    COALESCE(total_amount::text, '-'),
    COALESCE(units_per_period::text || '/' || period_hours::text || 'h', daily_hours::text || 'h/day'),
    COALESCE(completed_amount::text || '/' || total_amount::text, '-'),
    COALESCE(deadline::text, '-'),
    status,
    '' AS field_8
  FROM public.sub_tasks
  ORDER BY created_at DESC
)
UNION ALL
(
  SELECT 'daily_setting',
    date::text, available_hours::text,
    '' AS field_3, '' AS field_4, '' AS field_5, '' AS field_6, '' AS field_7, '' AS field_8
  FROM public.daily_settings
  ORDER BY date DESC
)
UNION ALL
(
  SELECT 'daily_summary',
    date::text,
    expected_hours::text || 'h',
    actual_hours::text || 'h (' || ROUND(actual_hours::numeric / NULLIF(expected_hours, 0) * 100, 0) || '%)',
    task_count::text || ' tasks',
    is_overflow::text,
    '' AS field_6, '' AS field_7, '' AS field_8
  FROM public.daily_summary
  ORDER BY date DESC
  LIMIT 14
)
UNION ALL
(
  SELECT 'plan_entry',
    plan_date::text, sub_task_id::text,
    planned_amount::text, planned_hours::text || 'h',
    COALESCE(actual_hours::text || 'h', '-'),
    '' AS field_6, '' AS field_7, '' AS field_8
  FROM public.daily_plan_entries
  ORDER BY plan_date, sub_task_id
)
UNION ALL
(
  SELECT 'progress_log',
    created_at::text, sub_task_id::text,
    amount_delta::text, log_date::text,
    '' AS field_5, '' AS field_6, '' AS field_7, '' AS field_8
  FROM public.progress_logs
  ORDER BY created_at DESC
  LIMIT 30
);
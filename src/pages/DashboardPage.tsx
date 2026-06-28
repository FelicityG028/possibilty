import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useSubTasks } from '@/hooks/useSubTasks'
import { useCategories } from '@/hooks/useCategories'
import { useDailyPlanEntries } from '@/hooks/useDailyPlan'
import {
  getAvailableHoursForDate,
  useDailySettings,
  useDefaultSetting,
} from '@/hooks/useDailySettings'
import { useDailyPlanSync } from '@/hooks/useDailyPlanSync'
import { useDailySummarySync } from '@/hooks/useDailySummarySync'
import { MonthCalendar } from '@/components/calendar/MonthCalendar'
import { GanttChart } from '@/components/gantt/GanttChart'
import { ViewSwitcher } from '@/components/layout/ViewSwitcher'
import { DailyHoursEditor } from '@/components/calendar/DailyHoursEditor'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { getTodayProgress, getAggregateProjection } from '@/lib/dailyProgress'

export function DashboardPage() {
  useDailyPlanSync()
  useDailySummarySync()
  const viewMode = useUIStore((s) => s.viewMode)
  const today = useUIStore((s) => s.selectedDate)
  const { data: tasks = [] } = useSubTasks()
  const { data: categories = [] } = useCategories()
  const { data: entries = [] } = useDailyPlanEntries()
  const { data: settings = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()

  const [todayExpanded, setTodayExpanded] = useState(true)

  const catMap = new Map(categories.map((c) => [c.id, c]))
  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const todayEntries = entries.filter((e) => e.plan_date === today)
  const todayHours = todayEntries.reduce((s, e) => s + e.planned_hours, 0)
  const available = getAvailableHoursForDate(settings, defaultSetting?.available_hours, today)
  const activeTasks = tasks.filter((t) => t.status === 'active')
  const todayOverflow = todayHours - available

  // 汇总所有任务的预测
  const projection = getAggregateProjection(tasks, entries, today)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {format(new Date(today), 'M月d日')} · 今日
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeTasks.length} 个进行中任务
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DailyHoursEditor date={today} />
          <ViewSwitcher />
        </div>
      </div>

      {/* 按计划预测：当前是否能按时完成所有任务？ */}
      {projection.wontFinishCount > 0 && (
        <div
          className="p-4 rounded-lg"
          style={{ backgroundColor: '#BBCAE7', color: '#111111' }}
        >
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-medium">
                按当前计划，{projection.wontFinishCount} 个任务无法按时完成
              </p>
              <p className="text-xs mt-1">
                总差额：
                <b className="tabular-nums mx-1">
                  {projection.totalDelta.toFixed(0)}
                </b>
                单位（预计完成 {(projection.totalProjected / Math.max(1, projection.totalAmount) * 100).toFixed(0)}%）
              </p>
              {projection.requiredExtraDailyHours > 0 && (
                <p className="text-xs mt-1">
                  💡 要全部按时完成，每天需要额外加{' '}
                  <b className="tabular-nums">{projection.requiredExtraDailyHours.toFixed(1)}</b>h
                  （或调整任务/截止日期）
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 今日摘要 - 可折叠 */}
      <div className="p-4">
        <button
          type="button"
          onClick={() => setTodayExpanded((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold" style={{ color: '#111111' }}>
              今日任务
            </h2>
            <span className="text-sm" style={{ color: '#111111' }}>
              共 <b style={{ color: '#111111' }}>{todayEntries.length}</b> 项
              {todayEntries.length > 0 && ` · ${todayHours.toFixed(1)}h / ${available}h`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {todayOverflow > 0 && (
              <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded">
                超出 {todayOverflow.toFixed(1)}h
              </span>
            )}
            <span
              className="transition-transform"
              style={{
                transform: todayExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                color: '#111111',
              }}
            >
              ▼
            </span>
          </div>
        </button>

        {todayExpanded && (
          <div className="mt-3">
            {activeTasks.length === 0 ? (
              <EmptyState
                icon="📚"
                title="还没有任务"
                description="到「任务」页面添加你的第一个子任务吧"
                action={
                  <Link to="/tasks">
                    <Button variant="primary">+ 添加任务</Button>
                  </Link>
                }
              />
            ) : todayEntries.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">
                今天没有计划任务 🎉 （可能是全部完成或截止日都过了）
              </p>
            ) : (
              <div className="space-y-2">
                {todayEntries.map((e) => {
                  const task = taskMap.get(e.sub_task_id)
                  if (!task) return null
                  const cat = catMap.get(task.category_id)
                  const isRecurring = task.kind === 'recurring'
                  const progress = getTodayProgress(task, today, entries)
                  return (
                    <div
                      key={e.id}
                      className="relative flex items-center gap-3 p-2 pl-4 rounded transition-colors"
                      style={{ backgroundColor: 'transparent' }}
                      onMouseEnter={(ev) => (ev.currentTarget.style.backgroundColor = '#EEE8DC')}
                      onMouseLeave={(ev) => (ev.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <span
                        className="absolute left-0 top-2 bottom-2 w-1 rounded-r"
                        style={{ backgroundColor: '#EDBCDC' }}
                      />
                      <span
                        className="w-1 self-stretch rounded-full"
                        style={{ backgroundColor: cat?.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
                          <span>{cat?.icon}</span>
                          <span>{cat?.name}</span>
                          {isRecurring && (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 text-[10px]">
                              每日
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {task.name}
                        </div>
                        {isRecurring ? (
                          <div className="mt-1 text-xs text-gray-600">
                            ⏰ 今天学了 {progress?.actualHours?.toFixed(1) ?? '0.0'}h / 每天 {e.planned_hours.toFixed(1)}h
                          </div>
                        ) : progress ? (
                          <div className="mt-1 flex items-center gap-2">
                            <ProgressBar
                              value={progress.ratio}
                              color={cat?.color}
                              height={4}
                              className="flex-1"
                            />
                            <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                              今日 {progress.completed.toFixed(1)} / {progress.planned.toFixed(1)}
                              {cat?.unit_label}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 主视图 */}
      {viewMode === 'calendar' ? <MonthCalendar /> : <GanttChart />}
    </div>
  )
}

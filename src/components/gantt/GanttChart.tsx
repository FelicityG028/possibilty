import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, differenceInDays, format, isSameDay, isWeekend, startOfDay } from 'date-fns'
import { useSubTasks } from '@/hooks/useSubTasks'
import { useCategories } from '@/hooks/useCategories'

const DAY_WIDTH = 44 // 每个日期列宽 px（加宽方便看日期）
const ROW_HEIGHT = 80 // 拉高行高（原 36 → 80）
const HEADER_HEIGHT = 64

export function GanttChart() {
  const navigate = useNavigate()
  const { data: tasks = [] } = useSubTasks()
  const { data: categories = [] } = useCategories()
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const active = tasks.filter((t) => t.status !== 'completed')

  // 全部可见日期 = 从所有 active 任务中取最早开始到最晚截止 + 前后各加 2 天 padding
  const { startDate, endDate, days } = useMemo(() => {
    if (active.length === 0) {
      const s = startOfDay(new Date())
      return { startDate: s, endDate: addDays(s, 14), days: 15 }
    }
    const today = startOfDay(new Date())
    let start = today
    let end = today
    for (const t of active) {
      // finite 用 deadline；recurring 取今天 + 30 天作为可视化窗口
      const dl = t.deadline ? new Date(t.deadline) : addDays(today, 30)
      if (dl < start) start = dl
      if (dl > end) end = dl
    }
    start = addDays(start, -1)
    end = addDays(end, 1)
    const span = differenceInDays(end, start) + 1
    return {
      startDate: start,
      endDate: end,
      days: Math.max(span, 14),
    }
  }, [active])

  const today = startOfDay(new Date())
  const todayOffset = differenceInDays(today, startDate)

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">甘特图</h2>
        <div className="text-xs text-gray-500 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> 计划区间
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" /> 已完成
          </span>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="text-center text-gray-500 py-12">没有 active 任务可显示</div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ width: days * DAY_WIDTH + 240, position: 'relative' }}>
            {/* 日期表头 */}
            <div
              className="flex border-b border-gray-200 sticky top-0 bg-white z-10"
              style={{ height: HEADER_HEIGHT }}
            >
              <div className="w-[240px] flex-shrink-0 px-4 py-2 text-sm font-medium text-gray-700 border-r border-gray-200 bg-gray-50">
                任务
              </div>
              <div className="flex">
                {Array.from({ length: days }).map((_, i) => {
                  const d = addDays(startDate, i)
                  const isToday = isSameDay(d, today)
                  const weekend = isWeekend(d)
                  return (
                    <div
                      key={i}
                      className={`flex-shrink-0 border-r border-gray-100 text-xs flex flex-col items-center justify-center ${
                        weekend ? 'bg-gray-50' : ''
                      } ${isToday ? 'bg-rose-50' : ''}`}
                      style={{ width: DAY_WIDTH, height: HEADER_HEIGHT }}
                    >
                      <span className={`text-sm font-medium ${isToday ? 'text-rose-600' : 'text-gray-700'}`}>
                        {format(d, 'd')}
                      </span>
                      <span className="text-gray-400">{format(d, 'M月')}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 任务行 */}
            {active.map((t) => {
              const cat = catMap.get(t.category_id)
              const isRecurring = t.kind === 'recurring'
              const dl = t.deadline ? new Date(t.deadline) : addDays(today, 30)
              const taskStart = today
              const startOffset = Math.max(0, differenceInDays(taskStart, startDate))
              const span = Math.max(2, differenceInDays(dl, taskStart) + 2)
              const progress = isRecurring
                ? 0
                : t.total_amount
                ? (t.completed_amount / t.total_amount) * 100
                : 0

              return (
                <div
                  key={t.id}
                  className="flex border-b border-gray-100 hover:bg-gray-50 group"
                  style={{ height: ROW_HEIGHT }}
                >
                  <button
                    onClick={() => navigate('/tasks')}
                    className="w-[240px] flex-shrink-0 px-4 py-2 text-left border-r border-gray-200 bg-white group-hover:bg-gray-50 flex flex-col justify-center"
                  >
                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                      <span>{cat?.icon}</span>
                      <span className="truncate">{cat?.name}</span>
                      {isRecurring && (
                        <span className="ml-1 px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 text-[10px]">
                          每日
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-gray-900 truncate">{t.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {isRecurring
                        ? `每天 ${t.daily_hours}h`
                        : t.total_amount
                        ? `${t.completed_amount.toFixed(0)} / ${t.total_amount.toFixed(0)}${cat?.unit_label ?? ''}`
                        : ''}
                    </div>
                  </button>
                  <div className="relative flex-1">
                    {/* 周末背景 */}
                    {Array.from({ length: days }).map((_, i) => {
                      const d = addDays(startDate, i)
                      return isWeekend(d) ? (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 bg-gray-50/50"
                          style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                        />
                      ) : null
                    })}
                    {/* 今天竖线 */}
                    {todayOffset >= 0 && todayOffset < days && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-blue-400 z-10"
                        style={{ left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }}
                      />
                    )}
                    {/* 任务条 */}
                    <div
                      className="absolute rounded overflow-hidden flex items-center"
                      style={{
                        left: startOffset * DAY_WIDTH + 2,
                        width: span * DAY_WIDTH - 4,
                        top: 14,
                        height: ROW_HEIGHT - 28,
                        backgroundColor: `${cat?.color}30`,
                        border: `1px solid ${cat?.color}`,
                      }}
                    >
                      {isRecurring ? (
                        <div
                          className="h-full w-full flex items-center justify-center"
                          style={{ backgroundColor: `${cat?.color}40` }}
                        >
                          <span className="text-xs text-gray-800 font-medium">
                            每天 {t.daily_hours}h
                          </span>
                        </div>
                      ) : (
                        <>
                          <div
                            className="h-full flex items-center"
                            style={{
                              width: `${Math.min(100, progress)}%`,
                              backgroundColor: cat?.color,
                            }}
                          >
                            <span className="text-xs text-white font-medium px-2 truncate">
                              {progress > 10 ? `${progress.toFixed(0)}%` : ''}
                            </span>
                          </div>
                          <span className="absolute right-2 text-xs text-gray-700 px-1 truncate max-w-[140px]">
                            {t.total_amount && t.total_amount - t.completed_amount > 0
                              ? `剩 ${(t.total_amount - t.completed_amount).toFixed(0)}${cat?.unit_label ?? ''}`
                              : t.total_amount && t.total_amount - t.completed_amount <= 0
                              ? '✅ 完成'
                              : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-t border-gray-200 text-xs text-gray-500">
        起点：{format(startDate, 'yyyy-MM-dd')} · 终点：{format(endDate, 'yyyy-MM-dd')} · 共
        {days} 天 · 蓝线 = 今天
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, differenceInDays, format, isSameDay, isWeekend, startOfDay } from 'date-fns'
import { useSubTasks } from '@/hooks/useSubTasks'
import { useCategories } from '@/hooks/useCategories'

const DAY_WIDTH = 44
const ROW_HEIGHT = 80
const HEADER_HEIGHT = 64

export function GanttChart() {
  const navigate = useNavigate()
  const { data: tasks = [] } = useSubTasks()
  const { data: categories = [] } = useCategories()
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const active = tasks.filter((t) => t.status !== 'completed')

  const { startDate, endDate, days } = useMemo(() => {
    if (active.length === 0) {
      const s = startOfDay(new Date())
      return { startDate: s, endDate: addDays(s, 14), days: 15 }
    }
    const today = startOfDay(new Date())
    let start = today
    let end = today
    for (const t of active) {
      const dl = t.deadline ? new Date(t.deadline) : addDays(today, 30)
      if (dl < start) start = dl
      if (dl > end) end = dl
    }
    // 右边 padding 1 天（视觉上 task bar 不贴右边界）
    // 左边不加 padding（避免显示不存在的过去日期）
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
    <div
      className="overflow-hidden rounded-lg"
      style={{ backgroundColor: '#FFFCF3' }}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: '#111111' }}>
          甘特图
        </h2>
        <div className="text-xs flex items-center gap-3" style={{ color: '#111111' }}>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#BBCAE7' }} /> 计划区间
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10b981' }} /> 已完成
          </span>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="text-center py-12" style={{ color: '#111111' }}>
          没有 active 任务可显示
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ width: days * DAY_WIDTH + 240, position: 'relative' }}>
            {/* 日期表头 */}
            <div
              className="flex sticky top-0 z-10"
              style={{ height: HEADER_HEIGHT, backgroundColor: '#FFFCF3' }}
            >
              <div
                className="w-[240px] flex-shrink-0 px-4 py-2 text-sm font-medium"
                style={{ color: '#111111' }}
              >
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
                      className={`flex-shrink-0 text-xs flex flex-col items-center justify-center ${
                        weekend ? '' : ''
                      }`}
                      style={{
                        width: DAY_WIDTH,
                        height: HEADER_HEIGHT,
                        backgroundColor: isToday ? '#EDBCDC' : 'transparent',
                      }}
                    >
                      <span
                        className="text-sm font-medium"
                        style={{ color: '#111111' }}
                      >
                        {format(d, 'd')}
                      </span>
                      <span style={{ color: '#111111' }}>{format(d, 'M月')}</span>
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
              const baseColor = cat?.color ?? '#94a3b8'

              return (
                <div
                  key={t.id}
                  className="flex group"
                  style={{ height: ROW_HEIGHT }}
                >
                  <button
                    onClick={() => navigate('/tasks')}
                    className="w-[240px] flex-shrink-0 px-4 py-2 text-left flex flex-col justify-center"
                    style={{ backgroundColor: '#FFFCF3' }}
                  >
                    <div
                      className="flex items-center gap-1 text-xs mb-1"
                      style={{ color: '#111111' }}
                    >
                      <span>{cat?.icon}</span>
                      <span className="truncate">{cat?.name}</span>
                      {isRecurring && (
                        <span
                          className="ml-1 px-1.5 py-0.5 rounded text-[10px]"
                          style={{ backgroundColor: '#EDBCDC', color: '#111111' }}
                        >
                          每日
                        </span>
                      )}
                    </div>
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: '#111111' }}
                    >
                      {t.name}
                    </div>
                    <div
                      className="text-xs mt-0.5 truncate"
                      style={{ color: '#111111' }}
                    >
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
                          className="absolute top-0 bottom-0"
                          style={{
                            left: i * DAY_WIDTH,
                            width: DAY_WIDTH,
                            backgroundColor: 'rgba(0,0,0,0.03)',
                          }}
                        />
                      ) : null
                    })}
                    {/* 今天竖线 */}
                    {todayOffset >= 0 && todayOffset < days && (
                      <div
                        className="absolute top-0 bottom-0 w-px z-10"
                        style={{
                          left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2,
                          backgroundColor: '#111111',
                        }}
                      />
                    )}
                    {/* 任务条：无边框，底色与进度色不同，降饱和 */}
                    <div
                      className="absolute rounded overflow-hidden flex items-center"
                      style={{
                        left: startOffset * DAY_WIDTH + 2,
                        width: span * DAY_WIDTH - 4,
                        top: 14,
                        height: ROW_HEIGHT - 28,
                        backgroundColor: `${baseColor}33`,
                      }}
                    >
                      {isRecurring ? (
                        <div
                          className="h-full w-full flex items-center justify-center"
                          style={{
                            backgroundColor: `${baseColor}66`,
                          }}
                        >
                          <span
                            className="text-xs font-medium"
                            style={{ color: '#111111' }}
                          >
                            每天 {t.daily_hours}h
                          </span>
                        </div>
                      ) : (
                        <>
                          <div
                            className="h-full flex items-center"
                            style={{
                              width: `${Math.min(100, progress)}%`,
                              backgroundColor: `color-mix(in srgb, ${baseColor} 50%, white)`,
                            }}
                          >
                            <span
                              className="text-xs font-medium px-2 truncate"
                              style={{ color: '#111111' }}
                            >
                              {progress > 10 ? `${progress.toFixed(0)}%` : ''}
                            </span>
                          </div>
                          <span
                            className="absolute right-2 text-xs px-1 truncate max-w-[140px]"
                            style={{ color: '#111111' }}
                          >
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

      <div className="px-4 py-2 text-xs" style={{ color: '#111111' }}>
        起点：{format(startDate, 'yyyy-MM-dd')} · 终点：{format(endDate, 'yyyy-MM-dd')} · 共
        {days} 天 · 黑色竖线 = 今天
      </div>
    </div>
  )
}

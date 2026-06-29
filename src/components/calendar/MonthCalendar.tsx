import { useState, useMemo } from 'react'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns'
import { useUIStore } from '@/store/uiStore'
import { useDailyPlanEntries } from '@/hooks/useDailyPlan'
import { useSubTasks } from '@/hooks/useSubTasks'
import { useCategories } from '@/hooks/useCategories'
import {
  getAvailableHoursForDate,
  useDailySettings,
  useDefaultSetting,
} from '@/hooks/useDailySettings'
import { toIso } from '@/lib/planner'
import { getDayCompletion } from '@/lib/dailyProgress'
import { DayDetailDrawer } from './DayDetailDrawer'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function MonthCalendar() {
  const [cursor, setCursor] = useState(() => new Date())
  const setSelectedDate = useUIStore((s) => s.setSelectedDate)
  const { data: entries = [] } = useDailyPlanEntries()
  const { data: tasks = [] } = useSubTasks()
  const { data: categories = [] } = useCategories()
  const { data: settings = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const [openDate, setOpenDate] = useState<string | null>(null)

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  // 聚合每天的 task count / hours / overflow
  const dayStats = useMemo(() => {
    const map: Record<string, { hours: number; tasks: Set<string> }> = {}
    for (const e of entries) {
      if (!map[e.plan_date]) map[e.plan_date] = { hours: 0, tasks: new Set() }
      map[e.plan_date].hours += e.planned_hours
      map[e.plan_date].tasks.add(e.sub_task_id)
    }
    return map
  }, [entries])

  const monthStart = startOfMonth(cursor)
  const monthEnd = endOfMonth(cursor)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: calStart, end: calEnd })
  const today = new Date()

  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ border: '1.5px dashed #111111' }}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor((c) => subMonths(c, 1))}
            className="p-1.5 hover:bg-gray-100 rounded"
            aria-label="上月"
          >
            ‹
          </button>
          <h2
            className="text-lg font-semibold px-3 py-1 rounded whitespace-nowrap"
            style={{ backgroundColor: '#111111', color: 'white' }}
          >
            {format(cursor, 'yyyy年M月')}
          </h2>
          <button
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="p-1.5 hover:bg-gray-100 rounded"
            aria-label="下月"
          >
            ›
          </button>
          <button
            onClick={() => {
              setCursor(new Date())
              setSelectedDate(toIso(new Date()))
            }}
            className="ml-2 px-2 py-1 text-xs rounded"
            style={{ color: '#111111' }}
          >
            今天
          </button>
        </div>
      </div>

      <div
        className="grid grid-cols-7 border-b"
        style={{ borderColor: '#111111' }}
      >
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium"
            style={{ color: '#111111' }}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = toIso(day)
          const inMonth = isSameMonth(day, cursor)
          const isToday = isSameDay(day, today)
          const stats = dayStats[iso]
          const hours = stats?.hours ?? 0
          const available = getAvailableHoursForDate(settings, defaultSetting?.available_hours, iso)
          const overflow = hours > available
          const taskCount = stats?.tasks.size ?? 0

          // 任务颜色小条
          const colors: string[] = []
          if (stats) {
            for (const id of stats.tasks) {
              const t = taskMap.get(id)
              if (!t) continue
              const c = catMap.get(t.category_id)?.color ?? '#94a3b8'
              if (colors.length < 4) colors.push(c)
            }
          }

          return (
            <button
              key={iso}
              onClick={() => {
                setSelectedDate(iso)
                setOpenDate(iso)
              }}
              className={`relative h-20 sm:h-24 px-2 py-1.5 text-left transition-colors ${
                inMonth ? '' : 'opacity-50'
              }`}
              style={{
                borderRight: '1.5px dashed #111111',
                borderBottom: '1.5px dashed #111111',
                backgroundColor: 'transparent',
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="inline-flex items-center justify-center w-6 h-6 text-xs rounded-full"
                  style={
                    isToday
                      ? { backgroundColor: '#EDBCDC', color: '#111111', fontWeight: 600 }
                      : { color: '#111111' }
                  }
                >
                  {format(day, 'd')}
                </span>
                {overflow && (
                  <span className="text-orange-500 text-xs" title="加班">⚠️</span>
                )}
              </div>
              {taskCount > 0 && (
                <div className="mt-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] text-gray-500 truncate">
                      {taskCount} 项 · {hours.toFixed(1)}h
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {colors.map((c, i) => (
                      <span
                        key={i}
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    {taskCount > 4 && (
                      <span className="text-[10px] text-gray-400">+{taskCount - 4}</span>
                    )}
                  </div>
                  {(() => {
                    // 完成度 = 实际学时 / 今日可用学时
                    // 当用户临时把 7h 改成 6h 时，分母用 6h
                    const comp = getDayCompletion(iso, tasks, entries)
                    const dayRatio = available > 0 ? comp.actual_hours / available : 0
                    const pct = Math.min(100, Math.round(dayRatio * 100))
                    return (
                      <>
                        <div className="flex items-center gap-1">
                          <div className="h-1 flex-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full"
                              style={{
                                width: `${pct}%`,
                                backgroundColor:
                                  dayRatio >= 1
                                    ? '#10b981'
                                    : overflow
                                    ? '#fb923c'
                                    : '#f43f5e',
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-gray-500 tabular-nums w-12 text-right">
                            {comp.actual_hours.toFixed(1)}/{available.toFixed(1)}h
                          </span>
                        </div>
                        {overflow && (
                          <div className="text-[10px] text-orange-600">加班</div>
                        )}
                      </>
                    )
                  })()}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {openDate && (
        <DayDetailDrawer
          date={openDate}
          onClose={() => setOpenDate(null)}
        />
      )}
    </div>
  )
}

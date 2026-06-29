import { useState } from 'react'
import { format } from 'date-fns'
import { useSubTasks, useDeleteSubTask, useUpdateSubTask } from '@/hooks/useSubTasks'
import { useCategories } from '@/hooks/useCategories'
import { useDailyPlanEntries } from '@/hooks/useDailyPlan'
import { useDefaultSetting } from '@/hooks/useDailySettings'
import { supabase } from '@/lib/supabase'
import { SubTaskForm } from './SubTaskForm'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { getProjectedCompletion } from '@/lib/dailyProgress'
import { todayIso } from '@/lib/planner'
import type { SubTask } from '@/lib/types'

function daysUntil(iso: string | null): number {
  if (!iso) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(iso)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export function SubTaskList() {
  const { data: tasks = [], isLoading } = useSubTasks()
  const { data: categories = [] } = useCategories()
  const { data: entries = [], refetch: refetchEntries } = useDailyPlanEntries()
  const { data: defaultSetting } = useDefaultSetting()
  const deleteMut = useDeleteSubTask()
  const updateMut = useUpdateSubTask()
  const [rebuilding, setRebuilding] = useState(false)

  const [editing, setEditing] = useState<SubTask | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const catMap = new Map(categories.map((c) => [c.id, c]))
  const active = tasks.filter((t) => t.status !== 'completed')
  const completed = tasks.filter((t) => t.status === 'completed')
  const visible = showArchived ? [...active, ...completed] : active
  const defaultSettingHours = defaultSetting?.available_hours ?? 6

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(t: SubTask) {
    setEditing(t)
    setFormOpen(true)
  }

  async function togglePause(t: SubTask) {
    await updateMut.mutateAsync({
      id: t.id,
      patch: { status: t.status === 'paused' ? 'active' : 'paused' },
    })
  }

  /**
   * 应急恢复：删除所有 daily_plan_entries，让 sync 重新生成
   * 用于"数据看起来异常 / 任务不显示"时手动修复
   */
  async function rebuildPlan() {
    if (!confirm('确定清空所有日历规划记录并重新生成？过去日期的数据会丢失。')) return
    setRebuilding(true)
    try {
      await supabase
        .from('daily_plan_entries')
        .delete()
        .gte('plan_date', '1900-01-01') // 所有日期
      await refetchEntries()
      // 触发 useDailyPlanSync 重新跑（修改 sub_tasks 的某个字段强制刷新）
      // 这里直接刷新页面让 sync 自动重跑
      window.location.reload()
    } catch (e) {
      alert('重置失败：' + (e instanceof Error ? e.message : String(e)))
      setRebuilding(false)
    }
  }

  if (isLoading) {
    return <div className="text-center text-gray-500 py-12">加载中…</div>
  }

  if (tasks.length === 0) {
    return (
      <>
        <EmptyState
          icon="🌱"
          title="还没有任务"
          description="点击下方按钮添加你的第一个子任务，比如一本要看的书。"
          action={
            <Button variant="primary" onClick={openCreate}>
              + 添加子任务
            </Button>
          }
        />
        <SubTaskForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
      </>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-600">
          {active.length} 个进行中 · {completed.length} 个已完成
          {entries.length === 0 && tasks.filter(t => t.status === 'active').length > 0 && (
            <span className="ml-2 text-orange-600">⚠️ 日历暂无规划</span>
          )}
        </div>
        <div className="flex gap-2">
          {entries.length === 0 && tasks.filter(t => t.status === 'active').length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={rebuildPlan}
              disabled={rebuilding}
            >
              {rebuilding ? '重建中…' : '🔧 重建规划'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? '隐藏已完成' : '查看已完成'}
          </Button>
          <Button variant="primary" size="sm" onClick={openCreate}>
            + 添加
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {visible.map((t) => {
          const cat = catMap.get(t.category_id)
          const isRecurring = t.kind === 'recurring'
          const days = daysUntil(t.deadline)
          const overdue = days < 0 && t.status !== 'completed' && !isRecurring
          return (
            <div
              key={t.id}
              className="relative p-4 pl-5 rounded-lg transition-shadow"
              style={{
                backgroundColor: '#EEE8DC',
              }}
            >
              <span
                className="absolute left-0 top-2 bottom-2 w-1 rounded-r"
                style={{ backgroundColor: '#EDBCDC' }}
              />
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: `${cat?.color}15`,
                        color: '#111111',
                      }}
                    >
                      <span>{cat?.icon}</span>
                      <span>{cat?.name}</span>
                    </span>
                    {isRecurring ? (
                      <span
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ backgroundColor: '#EDBCDC', color: '#111111' }}
                      >
                        ⏰ 每日 {t.daily_hours}h
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ backgroundColor: '#EDBCDC', color: '#111111' }}
                      >
                        📚 有限
                      </span>
                    )}
                    {t.status === 'paused' && (
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                        暂停
                      </span>
                    )}
                    {t.status === 'completed' && (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                        已完成
                      </span>
                    )}
                    {overdue && (
                      <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">
                        已逾期
                      </span>
                    )}
                  </div>
                  <h3
                    className="inline-block font-medium px-2.5 py-0.5 rounded truncate max-w-full"
                    style={{ backgroundColor: '#111111', color: '#EDBCDC' }}
                  >
                    {t.name}
                  </h3>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {isRecurring ? (
                      <>每天分配 {t.daily_hours}h</>
                    ) : (
                      <>
                        截止 {format(new Date(t.deadline!), 'yyyy-MM-dd')}
                        {!overdue && days >= 0 && ` · 还剩 ${days} 天`}
                        {overdue && ` · 超出 ${-days} 天`}
                        {' · '}
                        {t.units_per_period}
                        {cat?.unit_label} / {t.period_hours}h
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                    编辑
                  </Button>
                  {t.status !== 'completed' && (
                    <Button variant="ghost" size="sm" onClick={() => togglePause(t)}>
                      {t.status === 'paused' ? '继续' : '暂停'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确定删除「${t.name}」？`)) deleteMut.mutate(t.id)
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>

              {isRecurring ? (
                <div className="mt-3 text-sm text-gray-600 bg-pink-50 border border-pink-100 rounded-md px-3 py-2">
                  ⏰ 每天固定 <b>{t.daily_hours}h</b>（≈ {(t.daily_hours! * 60).toFixed(0)} 分钟）
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <ProgressBar
                      value={t.completed_amount / t.total_amount!}
                      color={cat?.color}
                      height={6}
                      className="flex-1"
                    />
                    <span className="text-xs text-gray-600 tabular-nums whitespace-nowrap">
                      累计 {t.completed_amount.toFixed(0)} / {t.total_amount!.toFixed(0)}
                      {cat?.unit_label}（{((t.completed_amount / t.total_amount!) * 100).toFixed(0)}%）
                    </span>
                  </div>
                  {(() => {
                    const proj = getProjectedCompletion(t, entries, todayIso())
                    if (!proj || proj.delta <= 0) return null
                    return (
                      <div
                        className="rounded-md px-3 py-2 text-xs"
                        style={{ backgroundColor: '#BBCAE7', color: '#111111' }}
                      >
                        <div className="flex items-center gap-1 font-medium">
                          <span>⚠️</span>
                          <span>
                            按当前计划，到 {format(new Date(t.deadline!), 'M月d日')} 还差{' '}
                            <b className="tabular-nums">{proj.delta.toFixed(0)}</b>
                            {cat?.unit_label}
                          </span>
                        </div>
                        {proj.requiredDailyHours != null && (
                          <div className="mt-0.5">
                            要按时完成，每天需{' '}
                            <b className="tabular-nums">{proj.requiredDailyHours.toFixed(1)}</b>h
                            （当前默认 {defaultSettingHours}h/天）
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}

              {t.notes && (
                <div className="mt-2 text-xs text-gray-500 italic border-l-2 border-gray-200 pl-2">
                  {t.notes}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <SubTaskForm open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
    </div>
  )
}

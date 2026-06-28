import { useState, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useSubTasks, useUpdateSubTask } from '@/hooks/useSubTasks'
import { useCategories } from '@/hooks/useCategories'
import {
  useDailySettings,
  useDefaultSetting,
  getAvailableHoursForDate,
  useSetDailyHours,
} from '@/hooks/useDailySettings'
import {
  generatePlan,
  suggestExtendDeadline,
  todayIso,
} from '@/lib/planner'
import { format } from 'date-fns'

interface OverflowDialogProps {
  date: string
  onClose: () => void
}

type Strategy = 'compress' | 'extend' | 'increase_hours' | 'pause_task'

export function OverflowDialog({ date, onClose }: OverflowDialogProps) {
  const { data: tasks = [] } = useSubTasks()
  const { data: categories = [] } = useCategories()
  const { data: settings = [] } = useDailySettings()
  const { data: defaultSetting } = useDefaultSetting()
  const updateMut = useUpdateSubTask()
  const setHours = useSetDailyHours()

  const [strategy, setStrategy] = useState<Strategy>('increase_hours')
  const [extraHours, setExtraHours] = useState('2')
  const [extraDays, setExtraDays] = useState('7')
  const [pauseTaskId, setPauseTaskId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  const plan = useMemo(
    () => generatePlan(tasks, settings, defaultSetting?.available_hours ?? 6, { startDate: todayIso() }),
    [tasks, settings, defaultSetting]
  )
  const dayPlan = plan.byDate[date]
  const available = getAvailableHoursForDate(settings, defaultSetting?.available_hours, date)
  const overflow = (dayPlan?.total_hours ?? 0) - available

  if (!dayPlan || overflow <= 0) {
    return (
      <Modal open onClose={onClose} title="今日计划正常" maxWidth="md">
        <p className="text-gray-600">当天任务量在可用时间内，无需调整。</p>
        <div className="mt-4 text-right">
          <Button variant="primary" onClick={onClose}>好的</Button>
        </div>
      </Modal>
    )
  }

  async function apply() {
    setError(null)
    setBusy(true)
    try {
      if (strategy === 'increase_hours') {
        const h = parseFloat(extraHours)
        if (!(h > 0)) throw new Error('请输入有效的小时数')
        const newHours = available + h
        if (newHours > 24) throw new Error('一天不能超过 24 小时')
        await setHours.mutateAsync({ date, hours: newHours })
      } else if (strategy === 'extend') {
        const days = parseInt(extraDays, 10)
        if (!(days > 0)) throw new Error('请输入有效的天数')
        // 对该日所有未完成任务延长 deadline
        const entryTaskIds = dayPlan.entries
          .map((e) => taskMap.get(e.sub_task_id))
          .filter(Boolean)
        for (const t of entryTaskIds) {
          if (!t) continue
          const newDl = suggestExtendDeadline(t, date, days)
          await updateMut.mutateAsync({ id: t.id, patch: { deadline: newDl } })
        }
      } else if (strategy === 'pause_task') {
        if (!pauseTaskId) throw new Error('请选择要暂停的任务')
        await updateMut.mutateAsync({
          id: pauseTaskId,
          patch: { status: 'paused' },
        })
      } else if (strategy === 'compress') {
        // 等比压缩在当前 planner 实现下需要重建模型，先给出友好提示
        throw new Error('等比压缩：建议使用"延长截止日期"代替')
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const previewTasks = dayPlan.entries
    .map((e) => ({ ...e, task: taskMap.get(e.sub_task_id) }))
    .filter((e) => e.task)
    .map((e) => ({
      ...e,
      cat: e.task ? catMap.get(e.task.category_id) : undefined,
    }))

  return (
    <Modal
      open
      onClose={onClose}
      title="当天计划超出可用时间"
      maxWidth="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={apply} disabled={busy}>
            {busy ? '处理中…' : '应用'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-orange-50 border border-orange-200 rounded-md p-3 text-sm">
          <p className="text-orange-900">
            {format(new Date(date), 'yyyy年M月d日')} 计划总时长{' '}
            <b>{dayPlan.total_hours.toFixed(1)}h</b>，可用 <b>{available}h</b>，
            超出 <b className="text-orange-700">{overflow.toFixed(1)}h</b>。
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">当天任务：</p>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {previewTasks.map((e) => (
              <li
                key={e.sub_task_id}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: e.cat?.color }}
                  />
                  <span className="text-gray-900 truncate max-w-[180px]">{e.task?.name}</span>
                </span>
                <span className="text-gray-500 tabular-nums">
                  {e.planned_hours.toFixed(1)}h
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">选择处理方式：</p>
          <div className="space-y-2">
            <label className="flex items-start gap-2 p-2 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="strategy"
                value="increase_hours"
                checked={strategy === 'increase_hours'}
                onChange={() => setStrategy('increase_hours')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">提高当天可用时间</div>
                <div className="text-xs text-gray-500 mt-1">
                  增加 <input
                    type="number"
                    step="0.5"
                    min="0.1"
                    value={extraHours}
                    onChange={(e) => setExtraHours(e.target.value)}
                    className="w-16 px-1 py-0.5 text-xs border border-gray-300 rounded mx-1"
                    onClick={(e) => e.stopPropagation()}
                  /> 小时 (从 {available}h → {Math.min(24, available + parseFloat(extraHours || '0'))}h)
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 p-2 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="strategy"
                value="extend"
                checked={strategy === 'extend'}
                onChange={() => setStrategy('extend')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">延长当天所有任务的截止日期</div>
                <div className="text-xs text-gray-500 mt-1">
                  全部向后顺延 <input
                    type="number"
                    step="1"
                    min="1"
                    value={extraDays}
                    onChange={(e) => setExtraDays(e.target.value)}
                    className="w-16 px-1 py-0.5 text-xs border border-gray-300 rounded mx-1"
                    onClick={(e) => e.stopPropagation()}
                  /> 天
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2 p-2 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="strategy"
                value="pause_task"
                checked={strategy === 'pause_task'}
                onChange={() => setStrategy('pause_task')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">暂停某个任务</div>
                <select
                  value={pauseTaskId}
                  onChange={(e) => setPauseTaskId(e.target.value)}
                  className="mt-1 w-full text-xs border border-gray-300 rounded px-1 py-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">— 选择任务 —</option>
                  {dayPlan.entries.map((e) => {
                    const t = taskMap.get(e.sub_task_id)
                    return t ? (
                      <option key={e.sub_task_id} value={e.sub_task_id}>
                        {t.name}
                      </option>
                    ) : null
                  })}
                </select>
              </div>
            </label>

            <label className="flex items-start gap-2 p-2 border border-gray-200 rounded-md cursor-not-allowed opacity-60">
              <input type="radio" name="strategy" value="compress" disabled className="mt-1" />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">等比压缩</div>
                <div className="text-xs text-gray-500 mt-1">暂未实现，请用"延长截止日期"代替</div>
              </div>
            </label>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

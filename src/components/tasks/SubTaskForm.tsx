import { useState, useEffect, useRef, FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { CategoryPicker } from './CategoryPicker'
import { useCategories } from '@/hooks/useCategories'
import { useCreateSubTask, useUpdateSubTask } from '@/hooks/useSubTasks'
import type { SubTask, SubTaskInsert } from '@/lib/types'

interface SubTaskFormProps {
  open: boolean
  onClose: () => void
  /** 传入则为编辑模式 */
  editing?: SubTask | null
}

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoAddDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type TaskKind = 'finite' | 'recurring'

export function SubTaskForm({ open, onClose, editing }: SubTaskFormProps) {
  const {
    data: categories = [],
    isLoading: catsLoading,
    error: catsError,
    refetch: refetchCats,
  } = useCategories()
  const createMut = useCreateSubTask()
  const updateMut = useUpdateSubTask()

  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TaskKind>('finite')
  // finite fields
  const [total, setTotal] = useState('')
  const [units, setUnits] = useState('1')
  const [hours, setHours] = useState('')
  const [deadline, setDeadline] = useState(isoAddDays(7))
  // recurring field
  const [dailyHours, setDailyHours] = useState('1')
  const [recurringDeadline, setRecurringDeadline] = useState('') // 截止时间（可选）
  // shared
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const initedKey = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (!editing && categories.length === 0) return

    const key = editing ? `edit-${editing.id}` : `new-${Date.now()}`
    if (initedKey.current === key) return
    initedKey.current = key

    if (editing) {
      setCategoryId(editing.category_id)
      setName(editing.name)
      setKind(editing.kind)
      if (editing.kind === 'finite') {
        setTotal(String(editing.total_amount ?? ''))
        setUnits(String(editing.units_per_period ?? '1'))
        setHours(String(editing.period_hours ?? ''))
        setDeadline(editing.deadline ?? isoAddDays(7))
      } else {
        setDailyHours(String(editing.daily_hours ?? '1'))
        setRecurringDeadline(editing.deadline ?? '')
      }
      setNotes(editing.notes ?? '')
    } else {
      setCategoryId(categories[0]?.id ?? null)
      setName('')
      setKind('finite')
      setTotal('')
      setUnits('1')
      setHours('')
      setDeadline(isoAddDays(7))
      setDailyHours('1')
      setRecurringDeadline('')
      setNotes('')
    }
    setError(null)
  }, [open, editing, categories])

  useEffect(() => {
    if (!open) initedKey.current = null
  }, [open])

  const selectedCat = categories.find((c) => c.id === categoryId) ?? null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (categoryId == null) {
      setError('请选择一个大类')
      return
    }
    if (!name.trim()) {
      setError('请输入任务名称')
      return
    }

    let payload: SubTaskInsert
    if (kind === 'finite') {
      const t = parseFloat(total)
      const u = parseFloat(units)
      const h = parseFloat(hours)
      if (!(t > 0)) {
        setError('总量必须大于 0')
        return
      }
      if (!(u > 0)) {
        setError('每次完成量必须大于 0')
        return
      }
      if (!(h > 0)) {
        setError('耗时必须大于 0')
        return
      }
      if (deadline < isoToday()) {
        setError('截止日期不能早于今天')
        return
      }
      payload = {
        category_id: categoryId,
        name: name.trim(),
        kind: 'finite',
        total_amount: t,
        units_per_period: u,
        period_hours: h,
        deadline,
        daily_hours: null,
        notes: notes.trim() || null,
      }
    } else {
      const dh = parseFloat(dailyHours)
      if (!(dh > 0) || dh > 24) {
        setError('每日时长必须在 0-24 小时之间')
        return
      }
      if (recurringDeadline && recurringDeadline < isoToday()) {
        setError('截止日期不能早于今天')
        return
      }
      payload = {
        category_id: categoryId,
        name: name.trim(),
        kind: 'recurring',
        total_amount: null,
        units_per_period: null,
        period_hours: null,
        deadline: recurringDeadline || null,
        daily_hours: dh,
        notes: notes.trim() || null,
      }
    }

    setSubmitting(true)
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, patch: payload })
      } else {
        await createMut.mutateAsync(payload)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? '编辑子任务' : '新建子任务'}
      maxWidth="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            type="submit"
            form="subtask-form"
            variant="primary"
            disabled={submitting}
          >
            {submitting ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <form id="subtask-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            大类 <span className="text-red-500">*</span>
          </label>
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            isLoading={catsLoading}
            error={catsError as Error | null}
            onRetry={() => refetchCats()}
          />
        </div>

        <Input
          label="任务名称"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={selectedCat ? `如：现代汉语教程` : ''}
          required
        />

        {/* 任务类型切换 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">任务类型</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind('finite')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                kind === 'finite'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-medium text-gray-900">📚 有限任务</div>
              <div className="text-xs text-gray-500 mt-0.5">
                有总量和截止日期，如"300页，2小时1页，6/30前"
              </div>
            </button>
            <button
              type="button"
              onClick={() => setKind('recurring')}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                kind === 'recurring'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-medium text-gray-900">⏰ 每日任务</div>
              <div className="text-xs text-gray-500 mt-0.5">
                每天固定时长，无截止，如"背单词 30min/天"
              </div>
            </button>
          </div>
        </div>

        {kind === 'finite' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={`总量（${selectedCat?.unit_label ?? '单位'}）`}
                name="total"
                type="number"
                step="1"
                min="1"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="300"
                required
              />
              <Input
                label="截止日期"
                name="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                min={isoToday()}
                required
              />
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
              <p className="text-sm font-medium text-gray-700 mb-2">学习速度</p>
              <p className="text-xs text-gray-500 mb-3">
                表达：每 <b>耗时</b> 完成 <b>数量</b>
                <br />
                例：每 2 小时看 1 页 → 数量=1，耗时=2
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={`数量（${selectedCat?.unit_label ?? '单位'}）`}
                  name="units"
                  type="number"
                  step="1"
                  min="1"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  required
                />
                <Input
                  label="耗时（小时）"
                  name="hours"
                  type="number"
                  step="1"
                  min="1"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="2"
                  required
                />
              </div>
            </div>
          </>
        ) : (
          <div className="bg-pink-50 border border-pink-200 rounded-md p-3">
            <p className="text-sm font-medium text-gray-700 mb-2">每日学习时长</p>
            <p className="text-xs text-gray-500 mb-3">
              每天日历上都会自动分配这个时长。可设置截止日期。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="时长（小时/天）"
                name="dailyHours"
                type="number"
                step="1"
                min="1"
                max="24"
                value={dailyHours}
                onChange={(e) => setDailyHours(e.target.value)}
                placeholder="1"
                required
              />
              <Input
                label="截止日期（可选）"
                name="recurringDeadline"
                type="date"
                value={recurringDeadline}
                onChange={(e) => setRecurringDeadline(e.target.value)}
                min={isoToday()}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              ≈ {parseInt(dailyHours || '0', 10) * 60} 分钟/天
              {!recurringDeadline && ' · 不填 = 永久有效'}
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
          <textarea
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
            {error}
          </div>
        )}
      </form>
    </Modal>
  )
}

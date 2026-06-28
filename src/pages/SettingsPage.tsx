import { useState, useEffect } from 'react'
import { useDefaultSetting, useSetDefaultHours } from '@/hooks/useDailySettings'
import { useCategories } from '@/hooks/useCategories'
import { Button } from '@/components/ui/Button'

export function SettingsPage() {
  const { data: defaultSetting } = useDefaultSetting()
  const { data: categories = [] } = useCategories()
  const setDefault = useSetDefaultHours()

  const [defaultHours, setDefaultHours] = useState(String(defaultSetting?.available_hours ?? 6))
  const [savedHint, setSavedHint] = useState(false)

  useEffect(() => {
    setDefaultHours(String(defaultSetting?.available_hours ?? 6))
  }, [defaultSetting?.available_hours])

  async function save() {
    const v = parseFloat(defaultHours)
    if (Number.isNaN(v) || v < 0 || v > 24) return
    await setDefault.mutateAsync(v)
    setSavedHint(true)
    setTimeout(() => setSavedHint(false), 1500)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold" style={{ color: '#111111' }}>
        设置
      </h1>

      <section className="p-5" style={{ borderBottom: '1.5px dashed #111111' }}>
        <h2 className="text-base font-semibold mb-1" style={{ color: '#111111' }}>
          默认每日学习时间
        </h2>
        <p className="text-xs mb-3" style={{ color: '#111111' }}>
          每天日历的默认可用时长。每天可在日视图里临时调整。
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            min="0"
            max="24"
            value={defaultHours}
            onChange={(e) => setDefaultHours(e.target.value)}
            className="w-24 px-3 py-2 rounded-md"
            style={{ border: '1.5px dashed #111111' }}
          />
          <span className="text-sm" style={{ color: '#111111' }}>
            小时 / 天
          </span>
          <Button onClick={save} disabled={setDefault.isPending}>
            {setDefault.isPending ? '保存中…' : '保存'}
          </Button>
          {savedHint && <span className="text-sm text-green-600">已保存</span>}
        </div>
      </section>

      <section className="p-5" style={{ borderBottom: '1.5px dashed #111111' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#111111' }}>
          8 大类
        </h2>
        <p className="text-xs mb-3" style={{ color: '#111111' }}>
          由系统预置。在 Supabase 控制台可调整名称/颜色/单位。
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {categories.map((c) => (
            <div
              key={c.id}
              className="rounded-md p-3 flex flex-col items-center"
              style={{ backgroundColor: '#EEE8DC', border: '1.5px dashed #111111' }}
            >
              <span className="text-2xl mb-1">{c.icon}</span>
              <span className="text-sm font-medium" style={{ color: '#EDBCDC' }}>
                {c.name}
              </span>
              <span className="text-xs" style={{ color: '#111111' }}>
                单位：{c.unit_label}
              </span>
              <span
                className="mt-1 w-8 h-1 rounded-full"
                style={{ backgroundColor: c.color }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="p-5">
        <h2 className="text-base font-semibold mb-3" style={{ color: '#111111' }}>
          关于
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: '#111111' }}>
          考研任务管理器 · 用于把大任务按速度 + 截止日期自动拆解到每一天。
          数据存储在 Supabase，部署在 Vercel。源码开源。
        </p>
        <p className="text-xs text-gray-400 mt-3">v0.1.0</p>
      </section>
    </div>
  )
}

import { useState } from 'react'
import type { Category } from '@/lib/types'
import { supabase } from '@/lib/supabase'

interface CategoryPickerProps {
  categories: Category[]
  value: number | null
  onChange: (id: number) => void
  isLoading?: boolean
  error?: Error | null
  onRetry?: () => void
}

export function CategoryPicker({
  categories,
  value,
  onChange,
  isLoading = false,
  error = null,
  onRetry,
}: CategoryPickerProps) {
  const [diag, setDiag] = useState<string | null>(null)
  const [diagRunning, setDiagRunning] = useState(false)

  async function runDiagnostic() {
    setDiagRunning(true)
    setDiag(null)
    const lines: string[] = []
    try {
      // 1. 配置信息
      const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '(未设置)'
      const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '(未设置)'
      lines.push(`URL: ${url}`)
      lines.push(`KEY 前 16: ${key.slice(0, 16)}... (len=${key.length})`)

      // 2. 直接读 categories
      const { data, error: e1 } = await supabase
        .from('categories')
        .select('id, name, unit_label, color')
        .order('id', { ascending: true })
      if (e1) {
        lines.push(`❌ categories 读取失败: ${e1.message}`)
        lines.push(`   code: ${e1.code ?? '-'}  hint: ${e1.hint ?? '-'}`)
      } else {
        lines.push(`✅ categories 读取成功，共 ${data?.length ?? 0} 行`)
        for (const r of data ?? []) {
          lines.push(`   - id=${r.id}  ${r.name} (${r.unit_label})`)
        }
      }

      // 3. 探测 default_settings 是否存在
      const { error: e3 } = await supabase.from('default_settings').select('id').limit(1)
      if (e3) {
        lines.push(`❌ default_settings 缺失: ${e3.message}`)
      } else {
        lines.push(`✅ default_settings 表存在`)
      }
    } catch (e) {
      lines.push(`❌ 诊断异常: ${e instanceof Error ? e.message : String(e)}`)
    }
    setDiag(lines.join('\n'))
    setDiagRunning(false)
  }

  if (error) {
    return (
      <div className="border-2 border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-700">
        <div className="flex items-center gap-2 font-medium">
          <span>⚠️</span>
          <span>类别加载失败</span>
        </div>
        <p className="mt-1 text-xs text-red-600">
          请检查 .env.local 中 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 是否正确，
          以及 Supabase 控制台是否已执行 [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)。
        </p>
        <p className="mt-1 text-xs text-red-500 font-mono break-all">
          {error.message}
        </p>
        <div className="mt-2 flex gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 rounded"
            >
              重试
            </button>
          )}
          <button
            type="button"
            onClick={runDiagnostic}
            disabled={diagRunning}
            className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 rounded"
          >
            {diagRunning ? '诊断中…' : '运行诊断'}
          </button>
        </div>
        {diag && (
          <pre className="mt-2 text-[11px] text-red-900 bg-red-100/60 p-2 rounded whitespace-pre-wrap break-all">
            {diag}
          </pre>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col items-center justify-center p-3 rounded-lg border-2 border-gray-100 bg-gray-50 animate-pulse"
          >
            <div className="w-6 h-6 bg-gray-200 rounded mb-1" />
            <div className="w-12 h-3 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (categories.length === 0) {
    return (
      <div className="border-2 border-amber-200 bg-amber-50 rounded-lg p-3 text-sm text-amber-800">
        <div className="flex items-center gap-2 font-medium">
          <span>📭</span>
          <span>暂无类别（已查到 0 行）</span>
        </div>
        <p className="mt-1 text-xs text-amber-700">
          数据库连接成功但是 categories 表是空的。请：
        </p>
        <ol className="mt-1 text-xs text-amber-700 list-decimal pl-5 space-y-0.5">
          <li>打开 Supabase → Table Editor → 确认 <code className="bg-amber-100 px-1 rounded">categories</code> 表存在</li>
          <li>如果表不存在或为空：SQL Editor → New query → 粘贴运行 <code className="bg-amber-100 px-1 rounded">migrations/0001_init.sql</code> 全部内容</li>
          <li>如果表存在：点击下方"运行诊断"看具体卡在哪</li>
        </ol>
        <div className="mt-2 flex gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 rounded"
            >
              重新查询
            </button>
          )}
          <button
            type="button"
            onClick={runDiagnostic}
            disabled={diagRunning}
            className="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 rounded"
          >
            {diagRunning ? '诊断中…' : '运行诊断'}
          </button>
        </div>
        {diag && (
          <pre className="mt-2 text-[11px] text-amber-900 bg-amber-100/60 p-2 rounded whitespace-pre-wrap break-all">
            {diag}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {categories.map((c) => {
        const selected = c.id === value
        return (
          <button
            type="button"
            key={c.id}
            onClick={() => onChange(c.id)}
            className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all ${
              selected
                ? 'border-rose-500 bg-rose-50 ring-2 ring-rose-200'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <span className="text-2xl mb-1">{c.icon}</span>
            <span
              className="text-xs font-medium text-center leading-tight"
              style={{ color: '#111111' }}
            >
              {c.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

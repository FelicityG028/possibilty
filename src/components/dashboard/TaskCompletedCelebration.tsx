/**
 * 任务完成彩蛋：当某个 task 从 "未完成" 变为 "已完成" 时
 *   屏幕中央显示彩蛋动画 + 恭喜消息，1.5 秒后消失
 *
 * 触发条件：task.completed_amount 跨过 task.total_amount
 * 去重：每个任务只庆祝一次，使用 localStorage 持久化已庆祝任务 ID，
 *       避免刷新页面或重新加载数据后反复提醒。
 */
import { useEffect, useRef, useState } from 'react'
import type { SubTask } from '@/lib/types'

interface TaskCompletedCelebrationProps {
  tasks: SubTask[]
}

interface Celebration {
  taskName: string
  categoryIcon?: string
  categoryColor?: string
}

const CELEBRATED_TASKS_KEY = 'celebrated-task-ids'

function loadCelebratedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(CELEBRATED_TASKS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

function saveCelebratedIds(ids: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CELEBRATED_TASKS_KEY, JSON.stringify([...ids]))
  } catch {
    // 忽略隐私模式等写入失败
  }
}

export function TaskCompletedCelebration({ tasks }: TaskCompletedCelebrationProps) {
  const [celebration, setCelebration] = useState<Celebration | null>(null)
  const prevStatusRef = useRef<Map<string, boolean>>(new Map())
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const prevMap = prevStatusRef.current
    const nextMap = new Map<string, boolean>()
    const celebratedIds = loadCelebratedIds()

    for (const t of tasks) {
      if (t.kind !== 'finite') continue
      if (!t.total_amount || t.total_amount <= 0) continue
      const isCompleted = t.completed_amount >= t.total_amount
      nextMap.set(t.id, isCompleted)

      // 跨过 100% 边界，且该任务从未庆祝过
      const wasCompleted = prevMap.get(t.id) ?? false
      if (!wasCompleted && isCompleted && !celebratedIds.has(t.id)) {
        celebratedIds.add(t.id)
        saveCelebratedIds(celebratedIds)
        // 找到 category 信息（可选）
        setCelebration({
          taskName: t.name,
          categoryIcon: undefined,
          categoryColor: undefined,
        })
        // 1.8 秒后自动消失
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => setCelebration(null), 1800)
      }
    }

    prevStatusRef.current = nextMap
  }, [tasks])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  if (!celebration) return null

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center"
      style={{ animation: 'fadeIn 0.3s ease-out' }}
    >
      {/* 彩屑 */}
      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: 60 }).map((_, i) => {
          const angle = (i / 60) * 360
          const distance = 200 + Math.random() * 200
          const delay = Math.random() * 0.3
          return (
            <span
              key={i}
              className="absolute text-3xl"
              style={{
                top: '50%',
                left: '50%',
                animation: `confettiBurst 1.6s ease-out ${delay}s forwards`,
                transform: `rotate(${angle}deg) translateX(${distance}px)`,
              }}
            >
              {['🎉', '🎊', '✨', '⭐', '💖', '🌟'][i % 6]}
            </span>
          )
        })}
      </div>

      {/* 中心恭喜文字 */}
      <div
        className="relative px-10 py-6 rounded-2xl shadow-2xl text-center"
        style={{
          background: 'rgba(255, 252, 243, 0.95)',
          border: '3px dashed #111111',
          animation: 'popIn 0.4s ease-out',
        }}
      >
        <div className="text-6xl mb-2">🎉</div>
        <div className="text-2xl font-bold" style={{ color: '#111111' }}>
          任务完成！
        </div>
        <div className="text-sm mt-1" style={{ color: '#666' }}>
          {celebration.taskName}
        </div>
      </div>

      <style>{`
        @keyframes confettiBurst {
          0% {
            opacity: 1;
            transform: rotate(0deg) translateX(0) translateY(0);
          }
          100% {
            opacity: 0;
            transform: rotate(720deg) translateX(var(--distance, 200px)) translateY(300px);
          }
        }
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}

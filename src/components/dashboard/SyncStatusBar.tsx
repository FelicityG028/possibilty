import { useSyncStatus } from '@/hooks/useDailyPlanSync'

/**
 * 同步状态条：显示在 Dashboard 顶部
 * - AI agent 跑时显示"AI 排程中..."
 * - fallback 时显示"使用简化算法"
 */
export function SyncStatusBar() {
  const status = useSyncStatus()

  if (!status.isRunning && status.mode === 'idle') return null

  if (status.isRunning) {
    return (
      <div
        className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
        style={{ backgroundColor: '#EDBCDC', color: '#111111' }}
      >
        <span className="inline-block w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: '#111111' }} />
        <span>AI 排程中...</span>
      </div>
    )
  }

  if (status.mode === 'fallback' && status.lastError) {
    return (
      <div
        className="px-3 py-2 rounded-lg text-xs flex items-center gap-2"
        style={{ backgroundColor: '#FFFCF3', color: '#111111', border: '1px dashed #111111' }}
      >
        <span>⚠️</span>
        <span>AI 排程失败，已使用简化算法</span>
        <span className="text-gray-500 text-[10px] truncate max-w-[200px]" title={status.lastError}>
          {status.lastError}
        </span>
      </div>
    )
  }

  return null
}

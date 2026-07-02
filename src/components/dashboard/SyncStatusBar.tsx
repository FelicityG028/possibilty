import { useSyncStatus } from '@/hooks/useDailyPlanSync'

/**
 * 同步状态条：sync 跑时显示加载提示
 */
export function SyncStatusBar() {
  const status = useSyncStatus()

  if (!status.isRunning) return null

  return (
    <div
      className="px-3 py-2 rounded-lg text-sm flex items-center gap-2"
      style={{ backgroundColor: '#EDBCDC', color: '#111111' }}
    >
      <span
        className="inline-block w-3 h-3 rounded-full animate-pulse"
        style={{ backgroundColor: '#111111' }}
      />
      <span>排程中...</span>
    </div>
  )
}

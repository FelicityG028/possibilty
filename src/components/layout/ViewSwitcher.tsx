import { useUIStore } from '@/store/uiStore'

export function ViewSwitcher() {
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)

  return (
    <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5">
      {(['calendar', 'gantt'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={`px-3 py-1.5 text-sm font-medium rounded ${
            viewMode === mode
              ? 'bg-rose-500 text-white'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {mode === 'calendar' ? '📅 日历' : '📊 甘特'}
        </button>
      ))}
    </div>
  )
}

import { useUIStore } from '@/store/uiStore'

export function ViewSwitcher() {
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)

  return (
    <div
      className="inline-flex rounded-md p-0.5"
      style={{ border: '1.5px dashed #111111' }}
    >
      {(['calendar', 'gantt'] as const).map((mode) => {
        const active = viewMode === mode
        return (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className="px-3 py-1.5 text-sm font-medium rounded transition-colors"
            style={
              active
                ? { backgroundColor: '#111111', color: '#FFFCF3' }
                : { backgroundColor: '#FFFCF3', color: '#111111' }
            }
          >
            {mode === 'calendar' ? '日历' : '甘特'}
          </button>
        )
      })}
    </div>
  )
}

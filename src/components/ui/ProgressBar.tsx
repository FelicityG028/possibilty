interface ProgressBarProps {
  value: number // 0..1
  color?: string
  height?: number
  showLabel?: boolean
  className?: string
}

export function ProgressBar({
  value,
  color = '#BBCAE7',
  height = 8,
  showLabel = false,
  className = '',
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={`relative w-full bg-gray-200 rounded-full overflow-hidden ${className}`} style={{ height }}>
      <div
        className="absolute top-0 left-0 h-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-700">
          {pct.toFixed(0)}%
        </div>
      )}
    </div>
  )
}

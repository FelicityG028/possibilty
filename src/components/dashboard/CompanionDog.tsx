import { useEffect, useState } from 'react'
import { getBucketForRatio, pickDogMessage } from '@/lib/dogMessages'

interface CompanionDogProps {
  /** 今日完成度 0-1 */
  ratio: number
  /** 今天是否有任务 */
  hasTasks: boolean
}

/**
 * 陪伴小狗 - 浮在右下角，根据完成度随机抽鼓励语
 */
export function CompanionDog({ ratio, hasTasks }: CompanionDogProps) {
  const [message, setMessage] = useState('')
  const [seed, setSeed] = useState(0)

  // 比例变化时换一句
  useEffect(() => {
    const bucket = getBucketForRatio(ratio, hasTasks)
    setMessage(pickDogMessage(bucket, seed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, hasTasks])

  // 点击小狗换一句
  function refresh() {
    const bucket = getBucketForRatio(ratio, hasTasks)
    setSeed((s) => s + 1)
    setMessage(pickDogMessage(bucket, seed + 1))
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 max-w-xs select-none">
      <div className="flex items-end gap-2">
        {/* 对话气泡 */}
        <button
          type="button"
          onClick={refresh}
          className="relative px-4 py-3 rounded-2xl text-left transition-transform hover:scale-105"
          style={{
            backgroundColor: '#FFFFFF',
            border: '1.5px dashed #111111',
            color: '#111111',
            fontSize: '13px',
            lineHeight: 1.5,
            maxWidth: '260px',
          }}
          title="点我换一句"
        >
          {message || '汪！'}
          {/* 气泡尖角 */}
          <span
            className="absolute -right-2 bottom-3 w-3 h-3 rotate-45"
            style={{
              backgroundColor: '#FFFFFF',
              borderRight: '1.5px dashed #111111',
              borderBottom: '1.5px dashed #111111',
            }}
          />
        </button>

        {/* 小狗 */}
        <div
          className="text-5xl cursor-pointer select-none"
          onClick={refresh}
          title="卓语小孩加油！"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}
        >
          🐶
        </div>
      </div>
    </div>
  )
}

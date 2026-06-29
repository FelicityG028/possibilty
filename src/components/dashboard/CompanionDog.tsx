import { useEffect, useState } from 'react'
import { getBucketForRatio, pickDogMessage } from '@/lib/dogMessages'

interface CompanionDogProps {
  /** 今日完成度 0-1 */
  ratio: number
  /** 今天是否有任务 */
  hasTasks: boolean
}

/**
 * 小狗 SVG - 含眨眼、摇尾巴、轻微弹跳动画
 */
function DogSVG() {
  return (
    <svg viewBox="0 0 120 110" className="w-14 h-14" style={{ overflow: 'visible' }}>
      <style>{`
        @keyframes wag {
          0%, 100% { transform: rotate(-10deg); }
          50%      { transform: rotate(35deg); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes blink {
          0%, 92%, 100% { transform: scaleY(1); }
          96%           { transform: scaleY(0.1); }
        }
        @keyframes pop {
          0%   { transform: scale(0.7); opacity: 0; }
          60%  { transform: scale(1.06); opacity: 1; }
          100% { transform: scale(1); }
        }
        .dog-wrap { animation: bounce 2.4s ease-in-out infinite; transform-origin: 60px 90px; }
        .dog-tail { animation: wag 0.55s ease-in-out infinite; transform-origin: 96px 78px; }
        .dog-eye  { animation: blink 4.5s infinite; transform-origin: center; transform-box: fill-box; }
        .bubble-pop { animation: pop 0.28s ease-out; }
      `}</style>

      <g className="dog-wrap">
        {/* 身体 */}
        <ellipse cx="60" cy="85" rx="32" ry="18" fill="#E8A87C" />
        {/* 四条腿 */}
        <rect x="38" y="92" width="9" height="14" rx="3" fill="#C9874A" />
        <rect x="73" y="92" width="9" height="14" rx="3" fill="#C9874A" />
        {/* 头 */}
        <circle cx="60" cy="48" r="28" fill="#E8A87C" />
        {/* 左耳 */}
        <ellipse cx="38" cy="30" rx="8" ry="14" fill="#A66B3F" transform="rotate(-25 38 30)" />
        {/* 右耳 */}
        <ellipse cx="82" cy="30" rx="8" ry="14" fill="#A66B3F" transform="rotate(25 82 30)" />
        {/* 眼睛白 */}
        <circle cx="50" cy="46" r="5" fill="#FFFFFF" />
        <circle cx="70" cy="46" r="5" fill="#FFFFFF" />
        {/* 眼睛黑（带眨眼动画）*/}
        <ellipse className="dog-eye" cx="50" cy="47" rx="3" ry="4" fill="#111111" />
        <ellipse className="dog-eye" cx="70" cy="47" rx="3" ry="4" fill="#111111" />
        {/* 鼻子 */}
        <ellipse cx="60" cy="58" rx="4" ry="3" fill="#111111" />
        {/* 嘴 */}
        <path d="M 55 64 Q 60 69 65 64" stroke="#111111" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* 红脸蛋 */}
        <circle cx="40" cy="56" r="3.5" fill="#F2A4A4" opacity="0.6" />
        <circle cx="80" cy="56" r="3.5" fill="#F2A4A4" opacity="0.6" />
      </g>

      {/* 尾巴（独立动画，挂在身体外）*/}
      <g className="dog-tail">
        <path
          d="M 92 78 Q 110 65 105 90"
          stroke="#E8A87C"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}

/**
 * 陪伴小狗 - 左下角浮动，根据完成度随机抽鼓励语
 */
export function CompanionDog({ ratio, hasTasks }: CompanionDogProps) {
  const [message, setMessage] = useState('')
  const [seed, setSeed] = useState(0)

  useEffect(() => {
    const bucket = getBucketForRatio(ratio, hasTasks)
    setMessage(pickDogMessage(bucket, seed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, hasTasks])

  function refresh() {
    const bucket = getBucketForRatio(ratio, hasTasks)
    setSeed((s) => s + 1)
    setMessage(pickDogMessage(bucket, seed + 1))
  }

  return (
    <div className="fixed bottom-6 left-6 z-40 max-w-xs select-none">
      <div className="flex items-end gap-2">
        {/* 小狗（带阴影）*/}
        <div
          className="cursor-pointer select-none"
          onClick={refresh}
          title="卓语小孩加油！"
          style={{
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.15))',
            animation: 'bounce 2.4s ease-in-out infinite',
          }}
        >
          <DogSVG />
        </div>

        {/* 对话气泡（带弹出动画）*/}
        <div className="relative">
          <div
            key={seed}
            onClick={refresh}
            className="bubble-pop px-4 py-3 rounded-2xl text-left cursor-pointer transition-transform hover:scale-105"
            style={{
              backgroundColor: '#FFFFFF',
              border: '1.5px dashed #111111',
              color: '#111111',
              fontSize: '13px',
              lineHeight: 1.5,
              maxWidth: '260px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
            title="点我换一句"
          >
            {message || '汪！'}
          </div>
          {/* 气泡尖角（指向左边的狗）*/}
          <span
            className="absolute -left-2 bottom-3 w-3 h-3 rotate-45"
            style={{
              backgroundColor: '#FFFFFF',
              borderLeft: '1.5px dashed #111111',
              borderBottom: '1.5px dashed #111111',
            }}
          />
        </div>
      </div>
    </div>
  )
}

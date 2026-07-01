import { useEffect, useState, useRef } from 'react'
import { getBucketForRatio, pickDogMessage } from '@/lib/dogMessages'

interface CompanionDogProps {
  /** 今日完成度 0-1 */
  ratio: number
  /** 今天是否有任务 */
  hasTasks: boolean
}

/**
 * 选 emoji — 统一用 🐶
 * 完成度 100% 时短暂显示 🎉 庆祝
 */
function pickDogEmoji(ratio: number): string {
  if (ratio >= 1) return '🎉' // 完成 → 庆祝
  return '🐶'
}

/**
 * 简单撒花效果
 */
function Confetti() {
  const pieces = Array.from({ length: 12 })
  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible">
      {pieces.map((_, i) => {
        const angle = (i / 12) * 360
        const distance = 40 + Math.random() * 30
        return (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 text-lg"
            style={{
              animation: `confetti 1s ease-out forwards`,
              transform: `rotate(${angle}deg) translateX(${distance}px)`,
              // @ts-ignore
              '--angle': `${angle}deg`,
            }}
          >
            {['🎉', '✨', '⭐', '💖'][i % 4]}
          </span>
        )
      })}
      <style>{`
        @keyframes confetti {
          0%   { transform: translate(-50%, -50%) rotate(0deg) translateX(0); opacity: 1; }
          100% { transform: translate(-50%, -50%) rotate(720deg) translateX(0); opacity: 0; top: -40px; }
        }
      `}</style>
    </div>
  )
}

/**
 * 陪伴小狗 - 左下角浮动
 * 互动：点击狗 / 气泡 换一句鼓励；点击狗 = 摇尾巴 + 短暂变成跑步狗
 */
export function CompanionDog({ ratio, hasTasks }: CompanionDogProps) {
  const [message, setMessage] = useState('')
  const [seed, setSeed] = useState(0)
  const [clicked, setClicked] = useState(false) // 点击时短暂换 emoji
  const [showConfetti, setShowConfetti] = useState(false)
  const prevRatioRef = useRef(ratio)

  useEffect(() => {
    const bucket = getBucketForRatio(ratio, hasTasks)
    setMessage(pickDogMessage(bucket, seed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, hasTasks])

  // 完成度跨过 100% 时撒花
  useEffect(() => {
    if (prevRatioRef.current < 1 && ratio >= 1 && hasTasks) {
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 1200)
    }
    prevRatioRef.current = ratio
  }, [ratio, hasTasks])

  function refresh() {
    const bucket = getBucketForRatio(ratio, hasTasks)
    setSeed((s) => s + 1)
    setMessage(pickDogMessage(bucket, seed + 1))
    // 点击反馈：emoji 短暂变 "跑步" 状态
    setClicked(true)
    setTimeout(() => setClicked(false), 600)
  }

  const normalEmoji = pickDogEmoji(ratio)
  const displayEmoji = clicked ? '🐕‍🦺' : normalEmoji

  return (
    <div className="fixed bottom-6 left-6 z-40 max-w-xs select-none">
      <div className="flex items-end gap-2">
        {/* 小狗 */}
        <div
          className="cursor-pointer select-none relative"
          onClick={refresh}
          title="卓语小孩加油！"
          style={{
            fontSize: '52px',
            lineHeight: 1,
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.15))',
            animation: clicked
              ? 'dog-shake 0.6s ease-out, dog-float 2.4s ease-in-out 0.6s infinite'
              : 'dog-float 2.4s ease-in-out infinite',
            transformOrigin: 'center bottom',
            userSelect: 'none',
          }}
        >
          {showConfetti && <Confetti />}
          {displayEmoji}
          <style>{`
            @keyframes dog-float {
              0%, 100% { transform: translateY(0) rotate(0deg); }
              50%      { transform: translateY(-4px) rotate(-3deg); }
            }
            @keyframes dog-shake {
              0%, 100% { transform: translateY(0) rotate(0deg); }
              20%      { transform: translateY(-6px) rotate(-12deg); }
              40%      { transform: translateY(-6px) rotate(12deg); }
              60%      { transform: translateY(-6px) rotate(-8deg); }
              80%      { transform: translateY(-6px) rotate(8deg); }
            }
          `}</style>
        </div>

        {/* 对话气泡（带弹出动画）*/}
        <div className="relative">
          <div
            key={seed}
            onClick={refresh}
            className="bubble-pop px-4 py-3 rounded-2xl text-left cursor-pointer transition-transform hover:scale-105 active:scale-95"
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
      <style>{`
        @keyframes pop {
          0%   { transform: scale(0.7); opacity: 0; }
          60%  { transform: scale(1.06); opacity: 1; }
          100% { transform: scale(1); }
        }
        .bubble-pop { animation: pop 0.28s ease-out; }
      `}</style>
    </div>
  )
}

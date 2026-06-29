/**
 * 陪伴小狗鼓励语库
 * 每个档位有 6-8 句不同的鼓励话
 * 全部用"卓语小孩"称呼
 *
 * 档位：
 *   - veryLow:  0-20%
 *   - low:     20-40%
 *   - mid:     40-60%
 *   - high:    60-80%
 *   - veryHigh:80-100%
 *   - empty:   今日没有任务
 *   - done:    已完成 100%（明天的鼓励）
 */

export const dogMessages = {
  veryLow: [
    '好的开始就是胜利，卓语小孩！',
    '卓语小孩加油～慢慢来，不急的。',
    '汪！先做一点点就好，我已经看到你的努力了。',
    '卓语小孩今天已经迈出第一步了，很棒！',
    '哪怕只做了一页，也是了不起的一页～',
    '不要紧，卓语小孩，先从最轻松的开始吧。',
    '我会一直陪着你，慢慢来。🐶',
    '今天不用完美，卓语小孩只要开始就好。',
  ],
  low: [
    '进展中！卓语小孩保持节奏～',
    '已经做了一点了，卓语小孩，继续保持～',
    '汪汪！看到你在努力了，卓语小孩很棒。',
    '一点点在积累，卓语小孩不要小看自己的进步。',
    '卓语小孩，按自己的节奏来就好～',
    '再坚持一下下，今天就会不一样了。',
    '稳扎稳打，卓语小孩你已经在路上了。',
  ],
  mid: [
    '过半啦卓语小孩！再加把劲～',
    '汪！进度条快到一半了，卓语小孩很稳。',
    '不急不慢，卓语小孩按计划来。',
    '已经做了不少了，卓语小孩继续保持！',
    '中间最难熬，但你正在度过，卓语小孩。',
    '坚持就是胜利，卓语小孩已经在中段了。',
    '看着你一步步推进，我好开心呀。🐕',
  ],
  high: [
    '胜利就在眼前，卓语小孩！',
    '快完成啦！卓语小孩再加把劲！',
    '汪汪！差一点点就到了，卓语小孩！',
    '卓语小孩冲刺一下，今天就要圆满啦！',
    '已经做了大半了，卓语小孩你是真的强！',
    '最后这一段，卓语小孩你一定可以的。',
    '马上就是今天的赢家了，卓语小孩！',
  ],
  veryHigh: [
    '太棒了卓语小孩！今天的你超厉害！',
    '汪！今天的目标几乎完成啦，卓语小孩威武！',
    '卓语小孩今天的你，简直是学习机器！',
    '剩下的就当奖励自己，卓语小孩慢慢收尾吧。',
    '今天的你，已经超越昨天的自己啦！',
    '卓语小孩冲刺成功在即，我已经准备好摇尾巴了！',
  ],
  empty: [
    '今天没有任务呢，卓语小孩休息一下吧～',
    '今天没有计划，卓语小孩想做什么就做什么吧。',
    '汪！难得清闲，卓语小孩好好充电吧。',
    '卓语小孩，今天的你可以彻底躺平～',
    '没事没事，没任务的日子也值得开心！🐶',
  ],
  done: [
    '卓语小孩今天满分通关！太厉害了！🎉',
    '汪汪汪！今天的所有任务都完成了，卓语小孩！',
    '卓语小孩今天的表现，我给你打满分！',
    '任务全清，卓语小孩今天可以好好休息啦～',
    '今天的你，完美。明天继续加油！🐕',
  ],
} as const

export type DogMessageBucket = keyof typeof dogMessages

/**
 * 根据完成度 (0-1) 返回档位
 */
export function getBucketForRatio(ratio: number, hasTasks: boolean): DogMessageBucket {
  if (!hasTasks) return 'empty'
  if (ratio >= 1) return 'done'
  if (ratio >= 0.8) return 'veryHigh'
  if (ratio >= 0.6) return 'high'
  if (ratio >= 0.4) return 'mid'
  if (ratio >= 0.2) return 'low'
  return 'veryLow'
}

/**
 * 从指定档位随机抽一句
 */
export function pickDogMessage(bucket: DogMessageBucket, seed?: number): string {
  const list = dogMessages[bucket]
  const idx = seed != null
    ? Math.abs(seed) % list.length
    : Math.floor(Math.random() * list.length)
  return list[idx]
}

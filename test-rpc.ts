import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1].trim()!
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1].trim()!
const supabase = createClient(url, key)

async function main() {
  // 找一个真实 task id（避免 FK 错误）
  const { data: t } = await supabase.from('sub_tasks').select('id, name').limit(1).single()
  console.log('Using safe task:', t!.name)

  // 模拟 AIAdjustBox 的 RPC 调用：用政治 task id 7-21 加 3h
  const { data: tasks } = await supabase.from('sub_tasks').select('id, name')
  const political = tasks?.find(t => t.name === '政治·核心考案')
  if (!political) { console.log('political not found'); return }

  console.log('\n--- Test 1: RPC with empty entries, p_delete_from=2026-07-21 ---')
  const { data: r1, error: e1 } = await supabase.rpc('sync_daily_plan', {
    p_entries: [
      { plan_date: '2026-07-21', sub_task_id: t!.id, planned_amount: 0, planned_hours: 0, actual_hours: null }
    ],
    p_delete_from: '2026-07-21',
  })
  console.log('result:', r1, 'err:', e1)

  const { data: before } = await supabase
    .from('daily_plan_entries')
    .select('id, plan_date, sub_task_id, planned_hours')
    .eq('plan_date', '2026-07-21')
    .eq('sub_task_id', political.id)
  console.log('7-21 political after test 1:', before)
}
main()
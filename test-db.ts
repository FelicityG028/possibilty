import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1].trim()!
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1].trim()!
const supabase = createClient(url, key)

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('daily_plan_entries')
    .select('*')
    .gte('plan_date', today)
    .order('plan_date', { ascending: true })
    .limit(100)

  if (error) { console.error('err:', error); return }
  console.log('rows:', data?.length)
  let adj = 0
  for (const r of data ?? []) {
    if (r.is_user_adjusted) {
      adj++
      console.log('ADJUSTED:', r.plan_date, r.sub_task_id.slice(0, 8), 'h=' + r.planned_hours, 'amt=' + r.planned_amount)
    }
  }
  console.log('is_user_adjusted count:', adj)
  console.log('---')
  console.log('sample first 10 rows:')
  for (const r of (data ?? []).slice(0, 10)) {
    console.log(r.plan_date, r.sub_task_id.slice(0, 8), 'h=' + r.planned_hours, 'amt=' + r.planned_amount, 'adj=' + r.is_user_adjusted)
  }
}
main()
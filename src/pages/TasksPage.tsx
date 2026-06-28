import { SubTaskList } from '@/components/tasks/SubTaskList'
import { useDailyPlanSync } from '@/hooks/useDailyPlanSync'

export function TasksPage() {
  useDailyPlanSync()
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4" style={{ color: '#111111' }}>
        子任务管理
      </h1>
      <SubTaskList />
    </div>
  )
}

import { SubTaskList } from '@/components/tasks/SubTaskList'
import { useDailyPlanSync } from '@/hooks/useDailyPlanSync'

export function TasksPage() {
  useDailyPlanSync()
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">子任务管理</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          录入每个大任务的速度和截止日期，应用会自动算出每天的安排
        </p>
      </div>
      <SubTaskList />
    </div>
  )
}

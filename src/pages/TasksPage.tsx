import { SubTaskList } from '@/components/tasks/SubTaskList'
import { useDailyPlanSync } from '@/hooks/useDailyPlanSync'

export function TasksPage() {
  useDailyPlanSync()
  return (
    <div>
      <div
        className="mb-4 p-4 rounded-lg"
        style={{ backgroundColor: '#EEE8DC' }}
      >
        <h1 className="text-2xl font-bold" style={{ color: '#EDBCDC' }}>
          子任务管理
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#111111' }}>
          录入每个大任务的速度和截止日期，应用会自动算出每天的安排
        </p>
      </div>
      <SubTaskList />
    </div>
  )
}

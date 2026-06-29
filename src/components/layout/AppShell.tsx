import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen p-4" style={{ backgroundColor: '#FAF4E8' }}>
      <div
        className="h-full min-h-[calc(100vh-2rem)] rounded-3xl flex overflow-hidden"
        style={{ border: '2px solid #111111' }}
      >
        <div
          className="rounded-2xl m-4 mr-0 w-60 flex-shrink-0 overflow-hidden"
          style={{ backgroundColor: '#111111' }}
        >
          <Sidebar />
        </div>
        <main className="flex-1 min-w-0 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

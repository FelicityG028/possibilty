import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#FAF4E8' }}>
      <Sidebar />
      <main className="flex-1 min-w-0 p-4">
        <div
          className="h-full rounded-3xl p-6 pb-2"
          style={{
            border: '2px solid #111111',
            backgroundColor: 'transparent',
          }}
        >
          {children}
        </div>
      </main>
    </div>
  )
}

import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-rose-50/40 via-white to-pink-50/30">
      <Sidebar />
      <main className="flex-1 min-w-0 max-w-[1400px] mx-auto px-6 lg:px-10 py-6 lg:py-8">
        {children}
      </main>
    </div>
  )
}

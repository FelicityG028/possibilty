import { Link, useLocation } from 'react-router-dom'
import { useUIStore } from '@/store/uiStore'

const navItems = [
  { to: '/', label: '今日', icon: '📅', section: 'General' },
  { to: '/tasks', label: '任务', icon: '✅', section: 'General' },
  { to: '/settings', label: '设置', icon: '⚙️', section: 'Tools' },
]

export function Sidebar() {
  const location = useLocation()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  const groups: Record<string, typeof navItems> = {}
  for (const item of navItems) {
    if (!groups[item.section]) groups[item.section] = []
    groups[item.section].push(item)
  }

  return (
    <aside className="w-60 bg-slate-950 text-white h-screen flex flex-col sticky top-0 flex-shrink-0">
      {/* Logo */}
      <Link to="/" className="px-6 py-6 flex items-center gap-2 group">
        <span
          className="font-cursive text-3xl font-semibold text-pink-400 leading-none"
          style={{ letterSpacing: '0.01em' }}
        >
          Possiblity
        </span>
        <span className="w-2 h-2 rounded-full bg-pink-500 mt-1 group-hover:scale-125 transition-transform" />
      </Link>

      {/* Nav groups */}
      <nav className="flex-1 px-3 py-2 space-y-4 overflow-y-auto">
        {Object.entries(groups).map(([section, items]) => (
          <div key={section}>
            <div className="px-3 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              {section}
            </div>
            <div className="mt-1 space-y-0.5">
              {items.map((item) => {
                const active = location.pathname === item.to
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      active
                        ? 'bg-pink-500/15 text-pink-300 font-medium'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                  >
                    {active && (
                      <span className="w-1 h-4 bg-pink-500 rounded-r -ml-3 mr-2" />
                    )}
                    <span className="text-base">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Theme toggle (footer) */}
      <div className="p-3 border-t border-slate-800/60">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-white rounded-lg transition-colors"
        >
          <span className="text-base">{theme === 'dark' ? '☀️' : '🌙'}</span>
          <span>切换主题</span>
        </button>
      </div>
    </aside>
  )
}

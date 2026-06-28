import { Link, useLocation } from 'react-router-dom'
import { useUIStore } from '@/store/uiStore'

interface HeaderProps {
  onToggleTheme: () => void
}

export function Header({ onToggleTheme }: HeaderProps) {
  const theme = useUIStore((s) => s.theme)
  const location = useLocation()

  const navItems = [
    { to: '/', label: '今日' },
    { to: '/tasks', label: '任务' },
    { to: '/settings', label: '设置' },
  ]

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <span
                className="font-cursive text-3xl font-semibold text-blue-600 leading-none"
                style={{ letterSpacing: '0.02em' }}
              >
                Possiblity
              </span>
            </Link>
            <nav className="flex gap-1">
              {navItems.map((item) => {
                const active = location.pathname === item.to
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-md text-gray-600 hover:bg-gray-100"
            title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
            aria-label="切换主题"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </header>
  )
}

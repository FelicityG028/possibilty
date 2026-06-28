import { create } from 'zustand'
import type { Theme, ViewMode } from '@/lib/types'

interface UIState {
  viewMode: ViewMode
  theme: Theme
  selectedDate: string // YYYY-MM-DD
  setViewMode: (mode: ViewMode) => void
  setTheme: (theme: Theme) => void
  setSelectedDate: (date: string) => void
}

const todayIso = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const useUIStore = create<UIState>((set) => ({
  viewMode: 'calendar',
  theme: 'light',
  selectedDate: todayIso(),
  setViewMode: (viewMode) => set({ viewMode }),
  setTheme: (theme) => set({ theme }),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
}))

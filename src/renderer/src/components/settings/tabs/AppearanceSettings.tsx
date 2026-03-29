import { Monitor, Moon, Sun } from 'lucide-react'
import React from 'react'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

type ThemeOption = 'dark' | 'light' | 'system'

const THEMES: { id: ThemeOption; label: string; icon: React.ReactNode; description: string }[] = [
  { id: 'dark',   label: 'Dark',   icon: <Moon className="h-5 w-5" />,    description: 'Easy on the eyes' },
  { id: 'light',  label: 'Light',  icon: <Sun className="h-5 w-5" />,     description: 'High contrast' },
  { id: 'system', label: 'System', icon: <Monitor className="h-5 w-5" />, description: 'Follow OS setting' },
]

export function AppearanceSettings() {
  const { theme, setTheme } = useUIStore()

  const handleSelect = (id: ThemeOption) => {
    if (id === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setTheme(prefersDark ? 'dark' : 'light')
      localStorage.setItem('postly-theme', 'system')
    } else {
      setTheme(id)
    }
  }

  // Determine which card is visually active
  const stored = localStorage.getItem('postly-theme') as ThemeOption | null
  const activeId: ThemeOption = stored === 'system' ? 'system' : (theme ?? 'dark')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-th-text-primary">Appearance</h2>
        <p className="mt-1 text-sm text-th-text-muted">Choose how Postly looks to you.</p>
      </div>

      <div>
        <label className="mb-3 block text-xs font-medium uppercase tracking-wide text-th-text-subtle">
          Theme
        </label>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map(({ id, label, icon, description }) => (
            <button
              key={id}
              onClick={() => handleSelect(id)}
              className={cn(
                'flex flex-col items-center gap-2.5 rounded-lg border px-4 py-4 text-center transition-colors focus:outline-none',
                activeId === id
                  ? 'border-blue-500 bg-blue-500/10 text-th-text-primary'
                  : 'border-th-border bg-th-surface-raised text-th-text-muted hover:border-th-border-strong hover:text-th-text-secondary'
              )}
            >
              <span className={cn(activeId === id ? 'text-blue-400' : '')}>{icon}</span>
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="mt-0.5 text-xs text-th-text-subtle">{description}</div>
              </div>
              {activeId === id && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

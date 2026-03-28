import React, { useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useCollectionsStore } from '@/store/collections'
import { cn } from '@/lib/utils'

export function SidebarSearch() {
  const setSearchQuery = useCollectionsStore((s) => s.setSearchQuery)
  const [value, setValue] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setValue(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSearchQuery(v), 150)
  }

  const handleClear = () => {
    setValue('')
    setSearchQuery('')
  }

  return (
    <div className="relative flex items-center">
      <Search className="absolute left-2.5 h-3.5 w-3.5 text-neutral-500" />
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Search..."
        className={cn(
          'w-full rounded border border-neutral-800 bg-neutral-900 py-1.5 pl-8 pr-8 text-sm',
          'text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600'
        )}
      />
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-2 text-neutral-500 hover:text-neutral-300 focus:outline-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

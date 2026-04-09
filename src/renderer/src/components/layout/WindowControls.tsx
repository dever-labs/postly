import { useEffect, useState } from 'react'

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="0.6" y="0.6" width="8.8" height="8.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      {/* front square */}
      <rect x="0.6" y="2.6" width="6.8" height="6.8" stroke="currentColor" strokeWidth="1.2" />
      {/* back square peek (top-right) */}
      <path d="M3 2V0.6h6.4v6.4H8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

const BASE = 'no-drag flex h-12 w-[46px] items-center justify-center transition-colors duration-100'
const NEUTRAL = `${BASE} text-th-text-subtle hover:bg-white/10 hover:text-th-text-primary light:hover:bg-black/[0.08] light:hover:text-th-text-primary`
const CLOSE = `${BASE} text-th-text-subtle hover:bg-red-500 hover:text-white light:hover:bg-red-500 light:hover:text-white`

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
    return window.api.window.onMaximizeChange(setIsMaximized)
  }, [])

  return (
    <div className="no-drag fixed right-0 top-0 z-50 flex">
      <button className={NEUTRAL} onClick={() => window.api.window.minimize()} title="Minimize">
        <MinimizeIcon />
      </button>
      <button className={NEUTRAL} onClick={() => window.api.window.maximize()} title={isMaximized ? 'Restore' : 'Maximize'}>
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button className={CLOSE} onClick={() => window.api.window.close()} title="Close">
        <CloseIcon />
      </button>
    </div>
  )
}

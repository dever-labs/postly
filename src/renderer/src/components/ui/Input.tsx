import React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full rounded border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary',
      'placeholder:text-th-text-subtle focus:border-th-border-strong focus:outline-none focus:ring-1 focus:ring-th-border-strong',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'

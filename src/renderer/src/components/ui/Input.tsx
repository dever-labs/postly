import React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100',
      'placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'

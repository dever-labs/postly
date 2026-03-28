import { cva, type VariantProps } from 'class-variance-authority'
import React from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-neutral-700 text-neutral-100 hover:bg-neutral-600',
        outline: 'border border-neutral-700 bg-transparent text-neutral-200 hover:bg-neutral-800',
        ghost: 'bg-transparent text-neutral-200 hover:bg-neutral-800',
        destructive: 'bg-rose-600 text-white hover:bg-rose-700',
      },
      size: {
        default: 'h-8 px-3 text-sm',
        sm: 'h-7 px-2 text-xs',
        lg: 'h-10 px-4 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
)
Button.displayName = 'Button'

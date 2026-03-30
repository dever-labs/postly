import { cva, type VariantProps } from 'class-variance-authority'
import React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-th-surface-hover text-th-text-primary',
        green: 'bg-emerald-900/50 text-emerald-400',
        yellow: 'bg-amber-900/50 text-amber-400',
        red: 'bg-rose-900/50 text-rose-400',
        blue: 'bg-blue-900/50 text-blue-400',
        orange: 'bg-orange-900/50 text-orange-400',
        purple: 'bg-purple-900/50 text-purple-400',
        grey: 'bg-th-surface-raised text-th-text-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
)

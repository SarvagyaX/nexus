import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva('inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium leading-5', {
  variants: {
    variant: {
      default: 'border-sky-400/25 bg-sky-400/10 text-sky-200',
      success: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
      warning: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
      danger: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
      violet: 'border-violet-400/20 bg-violet-400/10 text-violet-200',
      muted: 'border-border bg-secondary text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ className, variant, ...props }, ref) {
  return <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
})

export { Badge, badgeVariants }

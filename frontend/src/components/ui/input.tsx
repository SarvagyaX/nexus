import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn('flex h-10 w-full rounded-lg border border-input bg-background/70 px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/80 focus-visible:border-sky-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/20 disabled:cursor-not-allowed disabled:opacity-50', className)}
      {...props}
    />
  )
})

export { Input }

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import type { ComponentProps, HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = ({ className, inset, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) => (
  <DropdownMenuPrimitive.SubTrigger className={cn('flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:size-4', inset && 'pl-8', className)} {...props}>
    {children}<ChevronRight className="ml-auto text-muted-foreground" />
  </DropdownMenuPrimitive.SubTrigger>
)

const DropdownMenuSubContent = ({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) => (
  <DropdownMenuPrimitive.SubContent className={cn('z-50 min-w-36 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl', className)} {...props} />
)

const DropdownMenuContent = ({ className, sideOffset = 6, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content sideOffset={sideOffset} className={cn('z-50 min-w-48 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_18px_50px_rgba(0,0,0,0.42)] outline-none', className)} {...props} />
  </DropdownMenuPrimitive.Portal>
)

const DropdownMenuItem = ({ className, inset, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) => (
  <DropdownMenuPrimitive.Item className={cn('relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-colors focus:bg-accent focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0', inset && 'pl-8', className)} {...props} />
)

const DropdownMenuCheckboxItem = ({ className, children, checked, ...props }: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) => (
  <DropdownMenuPrimitive.CheckboxItem checked={checked} className={cn('relative flex cursor-default select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40', className)} {...props}>
    <span className="absolute left-2 flex size-4 items-center justify-center"><DropdownMenuPrimitive.ItemIndicator><Check className="size-4" /></DropdownMenuPrimitive.ItemIndicator></span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
)

const DropdownMenuRadioItem = ({ className, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) => (
  <DropdownMenuPrimitive.RadioItem className={cn('relative flex cursor-default select-none items-center rounded-md py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40', className)} {...props}>
    <span className="absolute left-2 flex size-4 items-center justify-center"><DropdownMenuPrimitive.ItemIndicator><Circle className="size-2 fill-current" /></DropdownMenuPrimitive.ItemIndicator></span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
)

const DropdownMenuLabel = ({ className, inset, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) => (
  <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', inset && 'pl-8', className)} {...props} />
)

const DropdownMenuSeparator = ({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) => (
  <DropdownMenuPrimitive.Separator className={cn('-mx-1.5 my-1 h-px bg-border', className)} {...props} />
)

const DropdownMenuShortcut = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)} {...props} />
)

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuGroup,
  DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuRadioGroup,
}

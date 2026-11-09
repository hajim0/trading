"use client"

import * as React from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface SelectContextValue {
  value?: string
  onValueChange?: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  selectedLabel: string | null
  setSelectedLabel: (label: string) => void
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelectContext() {
  const context = React.useContext(SelectContext)
  if (!context) {
    throw new Error("Select components must be used within a Select")
  }
  return context
}

export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  disabled?: boolean
}

export function Select({
  value: controlledValue,
  defaultValue,
  onValueChange,
  open: controlledOpen,
  onOpenChange,
  children,
}: SelectProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue || "")
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null)

  const isControlledValue = controlledValue !== undefined
  const value = isControlledValue ? controlledValue : uncontrolledValue

  const isControlledOpen = controlledOpen !== undefined
  const open = isControlledOpen ? controlledOpen : uncontrolledOpen

  const setOpen = React.useCallback(
    (newOpen: boolean) => {
      if (!isControlledOpen) setUncontrolledOpen(newOpen)
      onOpenChange?.(newOpen)
    },
    [isControlledOpen, onOpenChange]
  )

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (!isControlledValue) setUncontrolledValue(newValue)
      onValueChange?.(newValue)
      setOpen(false)
    },
    [isControlledValue, onValueChange, setOpen]
  )

  return (
    <SelectContext.Provider
      value={{
        value,
        onValueChange: handleValueChange,
        open,
        setOpen,
        selectedLabel,
        setSelectedLabel,
      }}
    >
      <div className="relative inline-block w-full">{children}</div>
    </SelectContext.Provider>
  )
}

export interface SelectTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = useSelectContext()

    return (
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-neutral-800 bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
      </button>
    )
  }
)
SelectTrigger.displayName = "SelectTrigger"

export interface SelectValueProps {
  placeholder?: string
  className?: string
}

export function SelectValue({ placeholder, className }: SelectValueProps) {
  const { value, selectedLabel } = useSelectContext()
  const display = selectedLabel || value || placeholder

  return (
    <span
      className={cn(
        "truncate block text-left",
        !value && !selectedLabel ? "text-neutral-500" : "text-white",
        className
      )}
    >
      {display}
    </span>
  )
}

export interface SelectContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  position?: "popper" | "item-aligned"
}

export const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = useSelectContext()
    const contentRef = React.useRef<HTMLDivElement | null>(null)

    React.useEffect(() => {
      if (!open) return

      function handleClickOutside(event: MouseEvent) {
        if (
          contentRef.current &&
          !contentRef.current.contains(event.target as Node)
        ) {
          // If click was outside, close
          setOpen(false)
        }
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          setOpen(false)
        }
      }

      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleKeyDown)
      return () => {
        document.removeEventListener("mousedown", handleClickOutside)
        document.removeEventListener("keydown", handleKeyDown)
      }
    }, [open, setOpen])

    if (!open) return null

    return (
      <div
        ref={(node) => {
          contentRef.current = node
          if (typeof ref === "function") ref(node)
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
        }}
        className={cn(
          "absolute left-0 top-full mt-1.5 z-50 min-w-[8rem] w-full overflow-hidden rounded-xl border border-neutral-800 bg-[#141414] text-white shadow-2xl animate-in fade-in-0 zoom-in-95",
          className
        )}
        {...props}
      >
        <div className="p-1 max-h-60 overflow-y-auto">{children}</div>
      </div>
    )
  }
)
SelectContent.displayName = "SelectContent"

export interface SelectItemProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value: string
  disabled?: boolean
}

export const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, value: itemValue, disabled, ...props }, ref) => {
    const { value, onValueChange, setSelectedLabel } = useSelectContext()
    const isSelected = value === itemValue

    React.useEffect(() => {
      if (isSelected && typeof children === "string") {
        setSelectedLabel(children)
      }
    }, [isSelected, children, setSelectedLabel])

    return (
      <div
        ref={ref}
        onClick={() => {
          if (!disabled) {
            onValueChange?.(itemValue)
            if (typeof children === "string") {
              setSelectedLabel(children)
            }
          }
        }}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-3 pr-8 text-sm outline-none transition-colors hover:bg-neutral-800/80 hover:text-white focus:bg-neutral-800",
          isSelected && "bg-neutral-800/50 text-white font-semibold",
          disabled && "pointer-events-none opacity-50",
          className
        )}
        {...props}
      >
        <span className="truncate">{children}</span>
        {isSelected && (
          <span className="absolute right-2.5 flex h-3.5 w-3.5 items-center justify-center">
            <Check className="h-4 w-4 text-blue-400" />
          </span>
        )}
      </div>
    )
  }
)
SelectItem.displayName = "SelectItem"

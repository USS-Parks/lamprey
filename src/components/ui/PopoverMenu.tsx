import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type PopoverAlign =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'
  | 'right-start'
  | 'left-start'

interface PopoverMenuProps {
  open: boolean
  onClose: () => void
  // Element to anchor against. The popover positions itself near this
  // element and restores focus to it when closed via Esc/outside-click.
  anchorRef: React.RefObject<HTMLElement | null>
  align?: PopoverAlign
  width?: number | string
  minWidth?: number
  role?: 'menu' | 'dialog' | 'listbox'
  ariaLabel?: string
  children: React.ReactNode
  // Whether to focus the first menuitem on open (default true for `menu`).
  autoFocus?: boolean
}

const VIEWPORT_PADDING = 8
const ANCHOR_GAP = 4

interface Position {
  top: number
  left: number
}

function computePosition(
  anchorRect: DOMRect,
  popoverRect: { width: number; height: number },
  align: PopoverAlign
): Position {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = 0
  let left = 0

  switch (align) {
    case 'bottom-start':
      top = anchorRect.bottom + ANCHOR_GAP
      left = anchorRect.left
      break
    case 'bottom-end':
      top = anchorRect.bottom + ANCHOR_GAP
      left = anchorRect.right - popoverRect.width
      break
    case 'top-start':
      top = anchorRect.top - popoverRect.height - ANCHOR_GAP
      left = anchorRect.left
      break
    case 'top-end':
      top = anchorRect.top - popoverRect.height - ANCHOR_GAP
      left = anchorRect.right - popoverRect.width
      break
    case 'right-start':
      top = anchorRect.top
      left = anchorRect.right + ANCHOR_GAP
      break
    case 'left-start':
      top = anchorRect.top
      left = anchorRect.left - popoverRect.width - ANCHOR_GAP
      break
  }

  // Flip if overflowing vertically.
  if (top + popoverRect.height > vh - VIEWPORT_PADDING) {
    const flipped = anchorRect.top - popoverRect.height - ANCHOR_GAP
    if (flipped >= VIEWPORT_PADDING) top = flipped
    else top = vh - popoverRect.height - VIEWPORT_PADDING
  }
  if (top < VIEWPORT_PADDING) top = VIEWPORT_PADDING

  // Clamp horizontally.
  if (left + popoverRect.width > vw - VIEWPORT_PADDING) {
    left = vw - popoverRect.width - VIEWPORT_PADDING
  }
  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING

  return { top, left }
}

function focusableItems(root: HTMLElement): HTMLElement[] {
  const sel =
    '[role="menuitem"]:not([aria-disabled="true"]), [role="option"]:not([aria-disabled="true"]), input, button:not([disabled])'
  return Array.from(root.querySelectorAll<HTMLElement>(sel))
}

export function PopoverMenu({
  open,
  onClose,
  anchorRef,
  align = 'bottom-start',
  width,
  minWidth,
  role = 'menu',
  ariaLabel,
  children,
  autoFocus = true
}: PopoverMenuProps): React.ReactElement | null {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [reduced] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
      : false
  )

  // Position on open and on window resize/scroll.
  useLayoutEffect(() => {
    if (!open) return
    const reposition = () => {
      const anchor = anchorRef.current
      const pop = popoverRef.current
      if (!anchor || !pop) return
      const ar = anchor.getBoundingClientRect()
      const pr = { width: pop.offsetWidth, height: pop.offsetHeight }
      setPos(computePosition(ar, pr, align))
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, align, anchorRef])

  // Outside-click + Esc + initial focus.
  useEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const handleDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (popoverRef.current?.contains(t)) return
      if (anchor && anchor.contains(t)) return
      onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        anchor?.focus()
        return
      }
      if (role !== 'menu') return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = popoverRef.current ? focusableItems(popoverRef.current) : []
        if (items.length === 0) return
        e.preventDefault()
        const current = document.activeElement as HTMLElement | null
        const idx = current ? items.indexOf(current) : -1
        const next =
          e.key === 'ArrowDown'
            ? items[(idx + 1) % items.length]
            : items[(idx - 1 + items.length) % items.length]
        next?.focus()
      }
    }
    window.addEventListener('mousedown', handleDown)
    window.addEventListener('keydown', handleKey, true)
    if (autoFocus) {
      // Defer so the popover is in the DOM before we hunt for items.
      queueMicrotask(() => {
        const items = popoverRef.current ? focusableItems(popoverRef.current) : []
        items[0]?.focus()
      })
    }
    return () => {
      window.removeEventListener('mousedown', handleDown)
      window.removeEventListener('keydown', handleKey, true)
    }
  }, [open, onClose, anchorRef, autoFocus, role])

  if (!open) return null

  // Hide the popover until we've measured it so it never flashes at the
  // wrong position. position:fixed escapes any clipped/transformed parents.
  const style: React.CSSProperties = {
    position: 'fixed',
    top: pos?.top ?? -9999,
    left: pos?.left ?? -9999,
    width,
    minWidth,
    opacity: pos ? 1 : 0,
    transition: reduced ? 'none' : 'opacity 140ms ease-out, transform 140ms ease-out',
    transform: pos ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.98)',
    transformOrigin: align.startsWith('bottom') ? 'top' : 'bottom'
  }

  return createPortal(
    <div
      ref={popoverRef}
      role={role}
      aria-label={ariaLabel}
      aria-orientation="vertical"
      style={style}
      className="z-[100] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] py-1 shadow-xl"
    >
      {children}
    </div>,
    document.body
  )
}

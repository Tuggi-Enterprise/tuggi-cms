'use client'

/**
 * The modal shell the two irreversible actions of this card share.
 *
 * It exists because `window.confirm` is not usable here (spec §6): it holds no structure,
 * does not translate, cannot name the person who is about to receive the grant, and its
 * button says "OK". And because the four accessibility guarantees below have to be real,
 * not intentions — WCAG 2.2 SC 2.4.3 (focus order) and SC 2.1.2 (no keyboard trap):
 *
 * - focus enters the dialog, on the element `initialFocusRef` points at — never the
 *   button that executes (Apple HIG, *Alerts*);
 * - ESC closes, unless the dialog says it is busy;
 * - focus is held inside while it is open;
 * - focus returns to whatever opened it.
 */

import { useCallback, useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Props {
  open: boolean
  title: string
  /** Blocks ESC and the backdrop while a batch is running: closing mid-run hides state. */
  busy?: boolean
  onClose: () => void
  initialFocusRef?: React.RefObject<HTMLElement | null>
  children: React.ReactNode
  footer?: React.ReactNode
}

export function DialogShell({
  open,
  title,
  busy,
  onClose,
  initialFocusRef,
  children,
  footer,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<Element | null>(null)

  const close = useCallback(() => {
    if (busy) return
    onClose()
  }, [busy, onClose])

  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement
    const opener = openerRef.current
    // Next paint: the initial target may not be mounted on the first commit.
    const raf = requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        containerRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        null
      target?.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [open, initialFocusRef])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      ).filter((node) => node.offsetParent !== null)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, close])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/50 backdrop-blur-sm"
      onClick={close}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900"
          onClick={(event) => event.stopPropagation()}
        >
          <h2 className="mb-4 text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          {children}
          {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
        </div>
      </div>
    </div>
  )
}

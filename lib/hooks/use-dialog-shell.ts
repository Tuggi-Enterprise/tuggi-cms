'use client'

/**
 * WHAT A THING THAT OPENS OVER THE SCREEN OWES THE OPERATOR, in one place.
 *
 * Four behaviours, and they are not decoration — each one is a way out that a mouse already has
 * and a keyboard did not:
 *
 *  · the page behind does not scroll, so closing does not land the operator somewhere else;
 *  · `Escape` closes, which is the only way out that costs nothing to discover;
 *  · focus goes INTO the dialog on open, or the next `Tab` walks the list behind it;
 *  · focus goes BACK to whatever opened it on close, or the operator is returned to the top of
 *    the document and has to find their row again.
 *
 * IT IS A HOOK BECAUSE THERE ARE TWO OF THEM ON ONE SCREEN. `DirectoryFilterSheet` had three of
 * the four written inline and `ClientEditorModal` — the client record, the surface the operator
 * spends the most time in — had none of them at all: no `role`, no `aria-modal`, no `Escape`, no
 * focus returned. Two implementations of one decision is the defect CLAUDE.md §6 names, and here
 * the second one was simply missing.
 *
 * WHAT IT DOES NOT DO: it does not trap `Tab`. `aria-modal="true"` on the panel is what tells
 * assistive technology to treat everything outside as inert, and a hand-rolled trap that gets a
 * corner wrong locks the keyboard inside a dialog with no way out — worse than the honest
 * version. The caller sets that attribute; this hook cannot, because it does not render.
 */

import { useEffect, useRef } from 'react'

/**
 * Returns the ref to put on whatever should hold focus when the dialog opens.
 *
 * PUT IT ON THE CLOSE BUTTON and not on the first field. On a phone, focusing a text input
 * raises the software keyboard over the content the operator opened the dialog to read — the
 * reason `DirectoryFilterSheet` already focused `Fechar` rather than its search box.
 */
export function useDialogShell(open: boolean, onClose: () => void) {
  const initialFocusRef = useRef<HTMLElement | null>(null)

  /**
   * `onClose` is rebuilt by most callers on every render, so it is held in a ref rather than
   * declared as a dependency. As a dependency it would tear down and rebuild the scroll lock and
   * the key listener on every render of the screen behind.
   */
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    if (!open) return

    // Captured BEFORE focus moves, which is the whole point: this is the control the operator
    // will be returned to.
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    initialFocusRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      // `isConnected` because the opener may be gone: an act on a card can remove the row while
      // its record is open, and focusing a detached node silently drops focus on `<body>`.
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  return initialFocusRef
}

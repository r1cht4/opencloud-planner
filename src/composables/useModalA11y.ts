/**
 * useModalA11y – accessibility behaviour for the hand-rolled modal dialogs.
 *
 * Wires up the three things a `role="dialog"` overlay needs that the browser does
 * not give us for free when the dialog is a plain `<div>`:
 *   1. Focus moves into the dialog when it opens (first focusable element).
 *   2. Focus is trapped: Tab / Shift+Tab cycle within the dialog instead of
 *      escaping to the page behind it.
 *   3. Escape closes the dialog, and focus returns to whatever was focused before
 *      it opened (usually the trigger button).
 *
 * The consumer keeps ownership of open/close state and markup; this composable only
 * observes `isOpen` and acts on the element referenced by `panelRef`.
 */

import { watch, nextTick, onUnmounted, getCurrentInstance, type Ref } from 'vue'

/** Selector for elements that can receive keyboard focus. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export function useModalA11y(
  panelRef: Ref<HTMLElement | null>,
  isOpen: Ref<boolean>,
  opts: { onClose: () => void }
): void {
  let previouslyFocused: HTMLElement | null = null

  function focusableEls(): HTMLElement[] {
    const panel = panelRef.value
    if (!panel) return []
    // Elements removed via v-if are not in the DOM, so the selector alone is enough.
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!isOpen.value) return

    if (e.key === 'Escape') {
      e.preventDefault()
      opts.onClose()
      return
    }

    if (e.key === 'Tab') {
      const els = focusableEls()
      if (els.length === 0) {
        // Nothing focusable inside — keep focus from leaving the dialog.
        e.preventDefault()
        return
      }
      const first = els[0]
      const last = els[els.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!panelRef.value?.contains(active)

      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !inside) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  watch(isOpen, async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null
      // Capture phase so the trap runs before the focused control's own handlers.
      document.addEventListener('keydown', onKeydown, true)
      await nextTick()
      focusableEls()[0]?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown, true)
      previouslyFocused?.focus?.()
      previouslyFocused = null
    }
  })

  // Guarded so the composable can be exercised in unit tests without a component.
  if (getCurrentInstance()) {
    onUnmounted(() => {
      document.removeEventListener('keydown', onKeydown, true)
    })
  }
}

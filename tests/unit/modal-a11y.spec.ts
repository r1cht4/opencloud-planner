// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useModalA11y } from '../../src/composables/useModalA11y'

function buildPanel(): HTMLElement {
  const panel = document.createElement('div')
  panel.innerHTML =
    '<button id="first">First</button>' +
    '<input id="middle" />' +
    '<button id="last">Last</button>'
  document.body.appendChild(panel)
  return panel
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useModalA11y', () => {
  it('moves focus into the panel on open and restores it on close', async () => {
    const panel = buildPanel()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const isOpen = ref(false)
    useModalA11y(ref(panel), isOpen, {
      onClose: () => {
        isOpen.value = false
      }
    })

    isOpen.value = true
    await flushPromises()
    await nextTick()
    expect(document.activeElement?.id).toBe('first')
    expect(panel.contains(document.activeElement)).toBe(true)

    isOpen.value = false
    await flushPromises()
    expect(document.activeElement).toBe(trigger)
  })

  it('calls onClose when Escape is pressed while open', async () => {
    const panel = buildPanel()
    const onClose = vi.fn()
    const isOpen = ref(false)
    useModalA11y(ref(panel), isOpen, { onClose })

    isOpen.value = true
    await flushPromises()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on Escape when closed', () => {
    const panel = buildPanel()
    const onClose = vi.fn()
    const isOpen = ref(false)
    useModalA11y(ref(panel), isOpen, { onClose })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab: from the last element it wraps to the first', async () => {
    const panel = buildPanel()
    const isOpen = ref(false)
    useModalA11y(ref(panel), isOpen, { onClose: () => {} })

    isOpen.value = true
    await flushPromises()

    document.getElementById('last')!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
    expect(document.activeElement?.id).toBe('first')
  })

  it('traps Shift+Tab: from the first element it wraps to the last', async () => {
    const panel = buildPanel()
    const isOpen = ref(false)
    useModalA11y(ref(panel), isOpen, { onClose: () => {} })

    isOpen.value = true
    await flushPromises()

    document.getElementById('first')!.focus()
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })
    )
    expect(document.activeElement?.id).toBe('last')
  })
})

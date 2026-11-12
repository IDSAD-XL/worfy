import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, type ButtonVariant } from '../../src/renderer/theme/Button'

// worfy-ui-kit ticket 15: one Button of the `theme` module with the variants primary, secondary,
// danger, link and icon, and one scale of button heights built on `--row-height` of tokens.css.

afterEach(cleanup)

const css = readFileSync(join(__dirname, '../../src/renderer/theme/button.css'), 'utf8')

/** The declarations of the first rule whose selector list holds exactly `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|[},]\\s*)${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm').exec(css)
  if (rule === null) throw new Error(`no rule for ${selector} in button.css`)
  return rule[1] ?? ''
}

const VARIANTS: readonly Exclude<ButtonVariant, 'icon'>[] = ['primary', 'secondary', 'danger', 'link']

describe('Button', () => {
  it.each(VARIANTS)('the %s variant is a button of type button with its name', (variant) => {
    const onClick = vi.fn()
    render(
      <Button variant={variant} onClick={onClick}>
        Run wave
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Run wave' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.classList.contains('w-button')).toBe(true)
    expect(button.classList.contains(`w-button--${variant}`)).toBe(true)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('the icon variant is a button of type button named by its label, the icon hidden', () => {
    render(<Button variant="icon" aria-label="Close" icon={<svg data-testid="glyph" />} />)
    const button = screen.getByRole('button', { name: 'Close' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.classList.contains('w-button--icon')).toBe(true)
    expect(screen.getByTestId('glyph').parentElement?.getAttribute('aria-hidden')).toBe('true')
  })

  it('a secondary button is the default', () => {
    render(<Button>Cancel</Button>)
    expect(screen.getByRole('button', { name: 'Cancel' }).classList.contains('w-button--secondary')).toBe(true)
  })

  it('aria-disabled keeps the tooltip and the focus, and swallows the click', () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" aria-disabled="true" title="Read-only: this Project lives on a Linked machine" onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('title')).toBe('Read-only: this Project lives on a Linked machine')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('disabled stays the native attribute', () => {
    render(
      <Button variant="secondary" disabled>
        Close
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true)
  })

  it('passes the ref, the test id and other attributes through', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(
      <Button ref={ref} data-testid="the-button" aria-haspopup="menu" className="extra">
        New session
      </Button>,
    )
    const button = screen.getByTestId('the-button')
    expect(ref.current).toBe(button)
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.classList.contains('extra')).toBe(true)
  })
})

describe('the scale of button heights (button.css)', () => {
  it('every step of the scale is built on --row-height of tokens.css', () => {
    const root = declarations(':root')
    const steps = [...root.matchAll(/(--button-height-[a-z]+):\s*([^;]+);/g)].map(([, name, value]) => ({ name, value: (value ?? '').trim() }))
    expect(steps.map((step) => step.name)).toEqual(['--button-height-s', '--button-height-m', '--button-height-l'])
    for (const step of steps) expect(step.value).toMatch(/var\(--row-height\)/)
  })

  it('a button takes its height only from --button-height', () => {
    expect(declarations('.w-button')).toMatch(/\bheight:\s*var\(--button-height\);/)
  })

  it.each([...VARIANTS, 'icon'])('the %s variant takes its height from the scale', (variant) => {
    expect(declarations(`.w-button--${variant}`)).toMatch(/--button-height:\s*var\(--button-height-[sml]\);/)
  })

  it('no other px height of a button in button.css', () => {
    expect(css).not.toMatch(/\bheight:\s*\d+px/)
  })
})

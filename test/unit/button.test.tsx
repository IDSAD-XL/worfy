import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeAction } from '../../src/renderer/projects/read-only'
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

const source = (path: string): string => readFileSync(join(__dirname, '../../src/renderer', path), 'utf8')

/** The rules of a stylesheet, comments dropped: each with its selectors (split on the top-level commas) and its body. */
function rules(text: string): { selectors: string[]; body: string }[] {
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, head = '', body = '']) => {
    const selectors: string[] = []
    let depth = 0
    let current = ''
    for (const char of head) {
      if (char === '(') depth++
      if (char === ')') depth--
      if (char === ',' && depth === 0) {
        selectors.push(current.trim())
        current = ''
      } else current += char
    }
    selectors.push(current.trim())
    return { selectors: selectors.map((each) => each.replace(/\s+/g, ' ')), body }
  })
}

/** The body of the first rule of button.css whose selector list holds `selector` and that sets `property`. */
function bodyFor(selector: string, property: string): string {
  const rule = rules(css).find((each) => each.selectors.includes(selector) && new RegExp(`(^|[;\\s])${property}:`).test(each.body))
  if (rule === undefined) throw new Error(`no rule of button.css sets ${property} for ${selector}`)
  return rule.body
}

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

  it('the steps are 20, 24 and 28 px on the 28 px row of tokens.css; the Node actions take 20 px (F-SPEC, "Button")', () => {
    const row = /--row-height:\s*(\d+)px;/.exec(source('theme/tokens.css'))?.[1]
    expect(row).toBe('28')
    const px = (value: string): number => {
      const step = /^(?:calc\()?var\(--row-height\)(?:\s*-\s*(\d+)px\))?$/.exec(value.trim())
      if (step === null) throw new Error(`not a step of the row height: ${value}`)
      return Number(row) - Number(step[1] ?? 0)
    }
    const root = declarations(':root')
    const value = (name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1] ?? ''
    expect([px(value('--button-height-s')), px(value('--button-height-m')), px(value('--button-height-l'))]).toEqual([20, 24, 28])
    expect(rules(source('canvas/actions/actions.css')).find((each) => each.selectors.includes('.w-action'))?.body).toMatch(/\bheight:\s*var\(--button-height-s\);/)
  })
})

describe('the area buttons not yet moved to Button take the colours of its variants', () => {
  it.each(['.w-action.w-action--primary', '.w-apstart__button.w-apstart__button--primary', '.w-qbtn.w-qbtn--primary', '.w-pr-inbox-button.w-pr-inbox-button--primary', '.w-composer__send:not(.w-composer__send--text)', '.w-primary'])('%s is coloured by the primary rule', (selector) => {
    const body = rules(css).find((each) => each.selectors.includes('.w-button--primary') && each.selectors.includes(selector) && /background:/.test(each.body))?.body ?? ''
    expect(body).toMatch(/background:\s*var\(--primary\);/)
    expect(body).toMatch(/color:\s*var\(--primary-text\);/)
  })

  it('the danger fill of F-SPEC ("Interrupt and start") colours the Button and .w-apstart__button--danger', () => {
    for (const selector of ['.w-button--danger', '.w-apstart__button.w-apstart__button--danger']) {
      const body = bodyFor(selector, 'background')
      expect(body).toMatch(/background:\s*var\(--danger\);/)
      expect(body).toMatch(/color:\s*var\(--danger-text\);/)
      expect(body).toMatch(/font-weight:\s*600;/)
    }
  })

  it('the quiet danger colours the quiet Button and .w-qbtn--danger: red text and ring, no fill', () => {
    for (const selector of ['.w-button--danger.w-button--quiet', '.w-qbtn.w-qbtn--danger']) {
      const body = bodyFor(selector, 'background')
      expect(body).toMatch(/background:\s*var\(--surface\);/)
      expect(body).toMatch(/color:\s*var\(--blocked-text\);/)
      expect(body).toMatch(/border-color:\s*var\(--blocked-ring\);/)
    }
  })

  it('the area files no longer colour those buttons themselves', () => {
    const copies: [string, string][] = [
      ['canvas/actions/actions.css', '.w-action--primary'],
      ['autopilot/autopilot-modal.css', '.w-apstart__button--primary'],
      ['autopilot/autopilot-modal.css', '.w-apstart__button--danger'],
      ['session/quote-comments.css', '.w-qbtn--primary'],
      ['session/quote-comments.css', '.w-qbtn--danger'],
      ['pr-inbox/pr-inbox.css', '.w-pr-inbox-button--primary'],
      ['theme/primitives.css', '.w-primary'],
    ]
    for (const [file, selector] of copies) {
      const colouring = rules(source(file)).filter((each) => each.selectors.includes(selector) && /(^|[;\s])background:/.test(each.body))
      expect(colouring, `${file} ${selector}`).toEqual([])
    }
  })
})

describe('an inactive Button (F-SPEC, "Read only": dimmed to 50 %)', () => {
  it('a read-only primary keeps the hint as its tooltip, takes no click and is dimmed', () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" {...writeAction('Mac mini gives this Machine read-only access', onClick)}>
        New session
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'New session' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('data-read-only')).toBe(true)
    expect(button.getAttribute('title')).toBe('Mac mini gives this Machine read-only access')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(bodyFor(".w-button[aria-disabled='true']", 'opacity')).toMatch(/opacity:\s*0\.5;/)
    expect(bodyFor('.w-button:disabled', 'opacity')).toMatch(/opacity:\s*0\.5;/)
  })

  it('no rule of button.css undoes the dimming of a read-only write action', () => {
    for (const rule of rules(css)) expect(rule.body, rule.selectors.join(', ')).not.toMatch(/opacity:\s*(1|1\.0+|100%)\s*;/)
  })

  it('quiet marks only a danger Button', () => {
    render(
      <>
        <Button variant="danger" quiet>
          Deny
        </Button>
        <Button variant="danger">Interrupt and start</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Deny' }).classList.contains('w-button--quiet')).toBe(true)
    expect(screen.getByRole('button', { name: 'Interrupt and start' }).classList.contains('w-button--quiet')).toBe(false)
  })
})

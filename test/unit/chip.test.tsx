import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Chip, type ChipVariant, type Status } from '../../src/renderer/theme/Chip'
import { StatusChip } from '../../src/renderer/theme/primitives'

// worfy-ui-kit ticket 16: one Chip of the `theme` module in the variants of the status roles
// (ready, working, blocked, done, stopped) and a neutral one; a status colour always with its icon
// and its label (F-SPEC: "Always pair status color with a text label or icon").

afterEach(cleanup)

const source = (path: string): string => readFileSync(join(__dirname, '../../src/renderer', path), 'utf8')
const css = source('theme/chip.css')

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

/** The value chip.css gives `property` for `selector`: the last rule whose selector list holds it and sets the property. */
function value(selector: string, property: string): string {
  const found = rules(css).filter((each) => each.selectors.includes(selector))
  for (const rule of found.reverse()) {
    const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(rule.body)
    if (match) return (match[1] ?? '').trim()
  }
  throw new Error(`no rule of chip.css sets ${property} for ${selector}`)
}

const STATUSES: readonly Status[] = ['ready', 'working', 'blocked', 'done', 'stopped']
const VARIANTS: readonly ChipVariant[] = [...STATUSES, 'neutral']

describe('Chip', () => {
  it.each(VARIANTS)('the %s variant has its icon and its label', (variant) => {
    render(<Chip variant={variant} label="gate green" data-testid="chip" />)
    const chip = screen.getByTestId('chip')
    expect(chip.textContent).toBe('gate green')
    expect(chip.classList.contains('w-chip')).toBe(true)
    // The colour class of its own variant, and of no other one.
    const colour = (each: ChipVariant): string => `w-chip--${each === 'neutral' ? 'open' : each}`
    expect([...chip.classList].filter((name) => VARIANTS.some((each) => colour(each) === name))).toEqual([colour(variant)])
    expect(chip.getAttribute('data-status')).toBe(variant === 'neutral' ? null : variant)
    const icon = chip.firstElementChild
    expect(icon === null ? null : icon.matches('svg, .w-chip__dot'), 'the first child is the icon').toBe(true)
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it.each(STATUSES)('a %s chip is never a colour without a word: an empty label shows the variant', (variant) => {
    render(<Chip variant={variant} label="" data-testid="chip" />)
    expect(screen.getByTestId('chip').textContent).toBe(variant)
    cleanup()
    render(<Chip variant={variant} label={null} icon={null} data-testid="chip" />)
    expect(screen.getByTestId('chip').textContent).toBe(variant)
  })

  it('the icon can be another glyph, or none where F-SPEC gives the chip a word alone; the label stays', () => {
    render(
      <>
        <Chip variant="neutral" icon={<svg data-testid="logo" aria-hidden="true" />} label="Claude Code" data-testid="vendor" />
        <Chip variant="ready" icon={null} label="OK" data-testid="ok" />
      </>,
    )
    expect(screen.getByTestId('vendor').firstElementChild).toBe(screen.getByTestId('logo'))
    expect(screen.getByTestId('ok').children).toHaveLength(0)
    expect(screen.getByTestId('ok').textContent).toBe('OK')
  })

  it('bordered, quiet and plain add their classes; attributes pass through', () => {
    render(<Chip variant="blocked" bordered quiet plain label="Failed" title="why" role="status" className="extra" data-testid="chip" data-value="red" />)
    const chip = screen.getByTestId('chip')
    for (const name of ['w-chip--blocked', 'w-chip--bordered', 'w-chip--quiet', 'w-chip--plain', 'extra']) expect(chip.classList.contains(name), name).toBe(true)
    expect(chip.getAttribute('title')).toBe('why')
    expect(chip.getAttribute('role')).toBe('status')
    expect(chip.getAttribute('data-value')).toBe('red')
  })

  it('the neutral variant keeps the class w-chip--open of the bare markup; a caller may name its state', () => {
    render(<Chip variant="neutral" label="open" data-status="open" data-testid="chip" />)
    const chip = screen.getByTestId('chip')
    expect(chip.classList.contains('w-chip--open')).toBe(true)
    expect(chip.getAttribute('data-status')).toBe('open')
  })

  it('StatusChip is the Chip of its status', () => {
    render(
      <>
        <StatusChip status="working" label="claimed" />
        <Chip variant="working" label="claimed" />
      </>,
    )
    const [ours, chip] = screen.getAllByText('claimed')
    expect(ours?.outerHTML).toBe(chip?.outerHTML)
  })
})

describe('the look of the variants (chip.css)', () => {
  it('the chip: 18 px, the radius of a chip, 12 px text (F-SPEC "Shape")', () => {
    expect(value('.w-chip', 'height')).toBe('18px')
    expect(value('.w-chip', 'border-radius')).toBe('var(--radius-chip)')
    expect(value('.w-chip', 'font-size')).toBe('var(--text-12)')
    expect(value('.w-chip', 'padding')).toBe('0 6px')
  })

  it.each([
    ['ready', '--ready-bg', '--ready-text'],
    ['working', '--working-bg', '--working-text'],
    ['blocked', '--blocked-bg', '--blocked-text'],
    ['done', '--done-bg', '--done-text'],
    ['stopped', '--done-bg', '--done-text'],
    ['open', '--surface-raised', '--text-secondary'],
  ])('.w-chip--%s: text in %s on %s, the tokens of F-SPEC', (variant, ground, text) => {
    expect(value(`.w-chip--${variant}`, 'background')).toBe(`var(${ground})`)
    expect(value(`.w-chip--${variant}`, 'color')).toBe(`var(${text})`)
  })

  it('the ready dot is the ready dot colour; a neutral dot is muted (F-SPEC, Modes "off")', () => {
    expect(value('.w-chip--ready .w-chip__dot', 'background')).toBe('var(--ready-dot)')
    expect(value('.w-chip--open .w-chip__dot', 'background')).toBe('var(--text-muted)')
  })

  it('a bordered chip has 1 px of the hairline, a blocked one the blocked ring, and a 16 px line inside it', () => {
    expect(value('.w-chip--bordered', 'border')).toBe('1px solid var(--border)')
    expect(value('.w-chip--bordered', 'line-height')).toBe('16px')
    expect(value('.w-chip--bordered.w-chip--blocked', 'border-color')).toBe('var(--blocked-ring)')
    expect(value('.w-chip--open', 'border')).toBe('1px solid var(--border)')
  })

  it('a bordered ready or working chip keeps its border unseen, so the chips of a First run row are one size', () => {
    expect(value('.w-chip--bordered.w-chip--ready', 'border-color')).toBe('transparent')
    expect(value('.w-chip--bordered.w-chip--working', 'border-color')).toBe('transparent')
  })

  it('a quiet chip keeps its text colour on surface raised with a border (First run "Warning")', () => {
    expect(value('.w-chip.w-chip--quiet', 'background')).toBe('var(--surface-raised)')
    expect(value('.w-chip.w-chip--quiet', 'border')).toBe('1px solid var(--border)')
    expect(rules(css).some((each) => each.selectors.includes('.w-chip.w-chip--quiet') && /(^|[;\s])color:/.test(each.body))).toBe(false)
  })

  it('a plain chip is status text: no ground, no border, no padding, its own line', () => {
    expect(value('.w-chip.w-chip--plain', 'background')).toBe('none')
    expect(value('.w-chip.w-chip--plain', 'border')).toBe('0')
    expect(value('.w-chip.w-chip--plain', 'padding')).toBe('0')
    expect(value('.w-chip.w-chip--plain', 'height')).toBe('auto')
  })

  it('no rule of chip.css sets an opacity: a read-only screen dims a chip as everything else (projects/read-only.css)', () => {
    for (const rule of rules(css)) expect(rule.body, rule.selectors.join(', ')).not.toMatch(/opacity\s*:/)
    expect(source('projects/read-only.css')).toMatch(/\[data-read-only\]\s*\{\s*opacity:\s*0\.5;/)
  })

  it('the chip rules live in chip.css only: primitives.css no longer styles .w-chip', () => {
    expect(rules(source('theme/primitives.css')).flatMap((each) => each.selectors).filter((each) => each.includes('w-chip'))).toEqual([])
  })

  it('the neutral rule colours old bare markup too: .w-chip--open is written by at least one area file', () => {
    expect(source('canvas/nodes/EpicFrameNode.tsx') + source('canvas/actions/AutopilotAction.tsx')).toMatch(/w-chip--open/)
  })
})

// The chips of the places moved onto Chip are rendered in their own tests: settings-health (First run),
// pr-inbox-view (the facts), connect-project (the steps), start-autopilot-modal (Modes),
// browser-frame-session («Claude is driving»), checks-badges and vendor-badge.

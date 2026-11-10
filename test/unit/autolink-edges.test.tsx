// A bare address in an agent's text becomes a link (remark-gfm's autolink literal), and its edges are
// right in Russian text too (src/renderer/markdown/autolink-edges.ts, worfy-polish ticket 101): the
// closing guillemet, quote or ellipsis after the address stays outside the link. Inside code nothing
// is a link; a scheme other than http(s) is never one.
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from '../../src/renderer/markdown/Markdown'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const asked: { channel: string; input: unknown }[] = []

beforeEach(() => {
  asked.length = 0
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      return Promise.resolve({ ok: true, value: {} })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** The links the text renders to: the address each opens and the text it shows. */
function links(text: string): { href: string | null; text: string | null }[] {
  const { container } = render(<Markdown text={text} breaks />)
  return [...container.querySelectorAll('a')].map((link) => ({ href: link.getAttribute('href'), text: link.textContent }))
}

describe('a bare address in prose', () => {
  it('becomes a link that opens in the browser', () => {
    const { container } = render(<Markdown text="The PR is https://github.com/IDSAD-XL/worfy/pull/1783 now" />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://github.com/IDSAD-XL/worfy/pull/1783')
    expect(link && fireEvent.click(link)).toBe(false)
    expect(asked).toEqual([{ channel: 'shell.openExternal', input: { url: 'https://github.com/IDSAD-XL/worfy/pull/1783' } }])
  })

  it('leaves the closing parenthesis and the full stop outside: https://x.y/a).', () => {
    const { container } = render(<Markdown text="(see https://x.y/a)." />)
    expect(links('(see https://x.y/a).')).toEqual([{ href: 'https://x.y/a', text: 'https://x.y/a' }])
    expect(container.textContent).toBe('(see https://x.y/a).')
  })

  it.each([
    ['«https://github.com/a/b»', 'https://github.com/a/b', '«https://github.com/a/b»'],
    ['«https://github.com/a/b».', 'https://github.com/a/b', '«https://github.com/a/b».'],
    ['«https://github.com/a/b.»', 'https://github.com/a/b', '«https://github.com/a/b.»'],
    ['“https://x.y/a”', 'https://x.y/a', '“https://x.y/a”'],
    ['see https://x.y/a…', 'https://x.y/a', 'see https://x.y/a…'],
    ['«www.example.com»', 'http://www.example.com', '«www.example.com»'],
  ])('keeps the closing quote outside: %s', (text, href, shown) => {
    const { container } = render(<Markdown text={text} />)
    const all = [...container.querySelectorAll('a')]
    expect(all.map((link) => link.getAttribute('href'))).toEqual([href])
    expect(container.textContent).toBe(shown)
  })

  it('keeps a guillemet that is part of the address, when the address opens one too', () => {
    expect(links('https://x.y/«a»')).toEqual([{ href: 'https://x.y/%C2%ABa%C2%BB', text: 'https://x.y/«a»' }])
  })

  it('leaves a link written as [text](url) alone, even when its address ends in a guillemet', () => {
    expect(links('[spec](https://x.y/a») and <https://x.y/b>')).toEqual([
      { href: 'https://x.y/a%C2%BB', text: 'spec' },
      { href: 'https://x.y/b', text: 'https://x.y/b' },
    ])
  })

  it('an http:// address and a www. one are links too', () => {
    expect(links('dev server at http://localhost:5173, docs at www.example.com')).toEqual([
      { href: 'http://localhost:5173', text: 'http://localhost:5173' },
      { href: 'http://www.example.com', text: 'www.example.com' },
    ])
  })
})

describe('code', () => {
  it('an address in a code span or a code block is not a link', () => {
    const { container } = render(<Markdown text={'Run `curl https://x.y/a` then:\n\n```\nopen https://x.y/b\n```'} breaks />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('curl https://x.y/a')
    expect(container.querySelector('pre code')?.textContent).toBe('open https://x.y/b\n')
  })
})

describe('unsafe schemes', () => {
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'mailto:a@b.c', 'ssh://host/x'])('[x](%s) is text and opens nothing', (href) => {
    const { container, getByText } = render(<Markdown text={`[x](${href})`} />)
    expect(container.querySelector('a')).toBeNull()
    fireEvent.click(getByText('x'))
    expect(asked).toEqual([])
  })
})

// The body of a PR comment (src/renderer/pr-inbox/CommentBody.tsx, worfy-polish 141): its markdown is drawn again only
// when its text or its repository changes, not on each render of the pane around it — a read of the drafts every few
// seconds, a key typed in a reply's field. The markdown renderer is the real one, counted through a wrapper; the texts
// are invented.
import { act, render, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

const drawn = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock('../../src/renderer/markdown/Markdown', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/markdown/Markdown')>()
  return {
    ...real,
    Markdown: (props: Parameters<typeof real.Markdown>[0]) => {
      drawn.texts.push(props.text)
      return createElement(real.Markdown, props)
    },
  }
})

const REPO = 'example-org/api'

describe('CommentBody', () => {
  it('draws its markdown once while the pane around it renders again with the same text, and again for another text or repository', async () => {
    const { CommentBody } = await import('../../src/renderer/pr-inbox/CommentBody')
    let typeKey: () => void = () => undefined
    function Pane({ body, repo }: { body: string; repo: string | null }) {
      // A field of the pane whose every key renders the pane, as the field of a draft reply does.
      const [typed, setTyped] = useState('')
      typeKey = () => setTyped((text) => `${text}x`)
      return (
        <div>
          <span data-testid="typed">{typed}</span>
          <CommentBody body={body} repo={repo} />
        </div>
      )
    }
    drawn.texts.length = 0
    const { rerender } = render(<Pane body="Why **three** tries?" repo={REPO} />)
    expect(screen.getByText('three').tagName).toBe('STRONG')
    expect(drawn.texts).toEqual(['Why **three** tries?'])

    // Keys typed, and a new read that brings the same text as a new string.
    for (let key = 0; key < 3; key += 1) act(() => typeKey())
    rerender(<Pane body={['Why **three**', 'tries?'].join(' ')} repo={REPO} />)
    expect(screen.getByTestId('typed').textContent).toBe('xxx')
    expect(drawn.texts).toHaveLength(1)

    rerender(<Pane body="Why **four** tries?" repo={REPO} />)
    expect(drawn.texts).toEqual(['Why **three** tries?', 'Why **four** tries?'])
    rerender(<Pane body="Why **four** tries?" repo="example-org/other" />)
    expect(drawn.texts).toHaveLength(3)
  })
})

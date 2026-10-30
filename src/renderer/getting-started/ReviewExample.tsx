import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * The fallback of step 5 of Getting started (worfy-onboarding ticket 09; spec, decision 11): the
 * review of the demo found nothing, so the rework round was not seen. The step says so, and "Show an
 * example" opens a recorded one — the reviewer's REJECTED with its finding, the implementer's fix on
 * the same branch, the reviewer's VERIFIED. Text, not a screenshot: it does not age with the UI. It
 * follows the demo's own todo CLI (src/main/getting-started/demo-template.ts) and the edge case its
 * full checks cover.
 */

/** The recorded example, word for word: three parts, each with who wrote it. */
const REVIEW_EXAMPLE = [
  {
    who: 'Reviewer',
    verdict: 'REJECTED',
    text: '1. `done 2` on a task that is already done exits 0 and says nothing. The full checks fail: `test/full/cli.test.js`, "done on a task that is already done prints a message and exits with 1".',
  },
  {
    who: 'Implementer',
    verdict: null,
    text: [
      '--- a/src/todo.js',
      '+++ b/src/todo.js',
      // Short lines: the diff does not wrap, and the sidebar shows about 26 characters of it.
      '@@ done(dir, n) @@',
      ' const task = tasks[n-1]',
      ' if (!task)',
      "  throw Error('No task')",
      '+if (task.done)',
      "+ throw Error('Not open')",
      ' task.done = true',
      ' save(dir, tasks)',
    ].join('\n'),
  },
  {
    who: 'Reviewer',
    verdict: 'VERIFIED',
    text: 'The full checks pass, the task that is already done included.',
  },
] as const

const NOTHING_FOUND = 'This time the review found nothing.'
const SHOW_EXAMPLE = 'Show an example'

const styles = {
  line: { margin: '1px 0 0', fontSize: 'var(--text-12)', lineHeight: '15px', color: 'var(--text-secondary)' },
  // A button that reads as a link, inside the line: the section shows every line without scrolling.
  link: {
    border: 0,
    padding: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--accent)',
    font: 'inherit',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  example: { margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 },
  part: { border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface)', padding: '4px 6px' },
  who: { display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 'var(--text-11)', lineHeight: '14px', color: 'var(--text-muted)' },
  rejected: { fontWeight: 600, color: 'var(--blocked-text)' },
  verified: { fontWeight: 600, color: 'var(--ready-text)' },
  text: { margin: '2px 0 0', fontSize: 'var(--text-12)', lineHeight: '15px', color: 'var(--text)', overflowWrap: 'anywhere' },
  code: { fontSize: 'var(--text-11)' },
  // The fix keeps its lines: a diff wrapped in a narrow sidebar does not read as one. It scrolls sideways instead.
  diff: { margin: '2px 0 0', fontSize: 'var(--text-11)', lineHeight: '14px', color: 'var(--text)', whiteSpace: 'pre', overflowX: 'auto' },
  added: { color: 'var(--ready-text)' },
} satisfies Record<string, CSSProperties>

/** A line of the fix: an added line in the colour of a passed check. */
function DiffLine({ line }: { line: string }) {
  return <span style={line.startsWith('+') && !line.startsWith('+++') ? styles.added : undefined}>{`${line}\n`}</span>
}

/** A verdict's text, with the parts between backticks as code. */
function Prose({ text }: { text: string }) {
  return (
    <p style={styles.text}>
      {text.split('`').map((piece, at) =>
        at % 2 === 1 ? (
          <code key={at} className="w-mono" style={styles.code}>
            {piece}
          </code>
        ) : (
          piece
        ),
      )}
    </p>
  )
}

/** "This time the review found nothing." and the button that opens the recorded example in place. */
export default function ReviewExample() {
  const [open, setOpen] = useState(false)
  const example = useRef<HTMLOListElement>(null)
  // The button goes away with the click: the focus goes to what it opened, not to the page.
  useEffect(() => {
    if (open) example.current?.focus()
  }, [open])
  return (
    <div data-testid="getting-started-review-example">
      <p style={styles.line}>
        {NOTHING_FOUND}
        {open ? null : (
          <>
            {' '}
            <button type="button" style={styles.link} onClick={() => setOpen(true)}>
              {SHOW_EXAMPLE}
            </button>
          </>
        )}
      </p>
      {open ? (
        <ol ref={example} tabIndex={-1} style={styles.example} aria-label="Example of a rework round">
          {REVIEW_EXAMPLE.map((part, index) => (
            <li key={index} style={styles.part}>
              <span style={styles.who}>
                {part.who}
                {part.verdict !== null ? <span style={part.verdict === 'REJECTED' ? styles.rejected : styles.verified}>{part.verdict}</span> : null}
              </span>
              {part.verdict === null ? (
                // Focusable, so the keyboard scrolls it too.
                <pre className="w-mono" style={styles.diff} tabIndex={0} aria-label="The implementer's fix">
                  {part.text.split('\n').map((line, at) => (
                    <DiffLine key={at} line={line} />
                  ))}
                </pre>
              ) : (
                <Prose text={part.text} />
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

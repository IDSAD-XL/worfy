import type { TranscriptRowProps } from './index'

// A slash command the user typed, as a transcript file records it (`/epic-wave demo-epic 1`):
// drawn like a prompt of the user. A live Session reports what the user typed as a prompt instead.
export const eventType = 'command'

export default function CommandRow({ event }: TranscriptRowProps) {
  if (event.type !== 'command') return null
  return (
    <div className="w-tr__row" data-testid="transcript-command">
      <div className="w-tr__who w-mono w-tr__who--user">you</div>
      <div className="w-tr__body">
        <div className="w-tr__prompt w-mono">{event.args === '' ? event.name : `${event.name} ${event.args}`}</div>
      </div>
    </div>
  )
}

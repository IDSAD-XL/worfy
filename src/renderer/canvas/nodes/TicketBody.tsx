import { Markdown } from '../../markdown/Markdown'
import { folderOf, type TicketText } from './ticket-text'

// The whole Ticket file, shown under the Ticket's header in a tile of focus mode (TicketNode.tsx,
// focus/focus-tile.ts). The text comes from useTicketText (ticket-text.ts); relative links of the
// file resolve against the folder it is in. The card on the Canvas never draws it.

export function TicketBody({ projectId, read }: { projectId: string; read: TicketText }) {
  return (
    <div className="w-ticket__body" data-testid="ticket-body" data-path={read.path}>
      {read.error !== undefined ? (
        <p className="w-ticket__body-message" data-testid="ticket-body-error">
          The Ticket file could not be read: {read.error}
        </p>
      ) : null}
      {read.text !== undefined ? <Markdown text={read.text} projectId={projectId} baseDir={read.path === undefined ? undefined : folderOf(read.path)} /> : null}
    </div>
  )
}

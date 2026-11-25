// The body of a comment of a pull request as GitHub shows it (worfy-polish ticket 104): the app's one markdown
// renderer with its GitHub reading on — mentions, `#N` of the PR's repository, suggestion blocks, an image as a link —
// and a single newline kept as a line break, as GitHub keeps it in a comment. Raw HTML stays text and nothing is
// fetched (Markdown.tsx). Used by the comments of the PR pane and by the draft replies (DraftThread.tsx).
// Memoised (worfy-polish 141): the pane renders again on every read of the drafts and every key typed in a reply, and
// parsing the markdown of every comment each time made typing lag; the same text and repository draw nothing new.
import { memo } from 'react'
import { Markdown } from '../markdown/Markdown'

export const CommentBody = memo(function CommentBody({ body, repo }: { body: string; repo: string | null }) {
  return (
    <div className="w-pr-inbox-comment__body" data-testid="pr-inbox-comment-body">
      <Markdown text={body} breaks github={{ repo }} />
    </div>
  )
})

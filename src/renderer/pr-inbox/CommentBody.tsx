// The body of a comment of a pull request as GitHub shows it (worfy-polish ticket 104): the app's one markdown
// renderer with its GitHub reading on — mentions, `#N` of the PR's repository, suggestion blocks, an image as a link —
// and a single newline kept as a line break, as GitHub keeps it in a comment. Raw HTML stays text and nothing is
// fetched (Markdown.tsx). Used by the comments of the PR pane and by the draft replies (DraftThread.tsx).
import { Markdown } from '../markdown/Markdown'

export function CommentBody({ body, repo }: { body: string; repo: string | null }) {
  return (
    <div className="w-pr-inbox-comment__body" data-testid="pr-inbox-comment-body">
      <Markdown text={body} breaks github={{ repo }} />
    </div>
  )
}

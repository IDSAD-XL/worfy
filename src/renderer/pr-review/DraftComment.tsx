// A comment of the review draft of a PR as Review mode shows it (worfy-pr-review ticket 10; review-comments.tsx places
// it): who wrote it last — «Pending» for the person, «Written by the agent» — its Markdown, and Edit, Move to line and
// Delete where the draft may be changed.
import type { ReviewComment } from '../../shared/ipc/pr-review'
import { CommentBody } from '../pr-inbox/CommentBody'

/** A comment of the draft with its place in `payload.comments` and who wrote it last. */
export interface PlacedComment {
  index: number
  comment: ReviewComment
  by: 'person' | 'agent'
}

/** A comment of the draft as Review mode shows it: the flag of who wrote it, its text, Edit, Move to line and Delete. */
export function DraftComment({
  placed,
  repo,
  where,
  onEdit,
  onDelete,
  onMove,
}: {
  placed: PlacedComment
  repo: string
  /** Its file and lines, where the comment does not stand under them. */
  where?: string
  onEdit: (() => void) | null
  onDelete: (() => void) | null
  onMove?: (() => void) | null
}) {
  const { comment, by, index } = placed
  return (
    <div className={`w-pr-review-comment${by === 'agent' ? ' is-agent' : ''}`} data-testid="pr-review-comment" data-index={index} data-by={by} data-path={comment.path} data-line={comment.line}>
      <div className="w-pr-review-comment__head">
        {by === 'agent' ? <span className="w-pr-review-flag w-pr-review-flag--agent">Written by the agent</span> : <span className="w-pr-review-flag">Pending</span>}
        {where !== undefined ? <span className="w-mono">{where}</span> : comment.start_line !== undefined ? <span className="w-mono w-changes__muted">lines {comment.start_line}–{comment.line}</span> : null}
        <span className="w-changes__spacer" />
        <span className="w-changes__muted">not on GitHub yet</span>
      </div>
      <CommentBody body={comment.body} repo={repo} />
      {onEdit !== null || onDelete !== null || (onMove ?? null) !== null ? (
        <div className="w-pr-review-comment__bar">
          {onEdit !== null ? (
            <button type="button" className="w-changes__link" data-testid="pr-review-comment-edit" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {onMove != null ? (
            <button type="button" className="w-changes__link" data-testid="pr-review-comment-move" title="Put the comment on a changed line: click its «+», or pick lines and press c" onClick={onMove}>
              Move to line
            </button>
          ) : null}
          {onDelete !== null ? (
            <button type="button" className="w-changes__link" data-testid="pr-review-comment-delete" onClick={onDelete}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

import { useContext, useLayoutEffect, useRef, useState } from 'react'
import type { MessageAttachment } from '../../shared/agent/attachments'
import { MessageAttachments } from './MessageAttachments'
import { squash, type ParsedMessage, type SentQuote } from './quote-comments'
import { SentQuotesContext } from './sent-quotes'
import './quote-comments.css'

// The user's message that carried comments on quotes (worfy-polish ticket 102), as its bubble draws
// it: a block per quote — the agent's message it came from, the quote with a bar at its left,
// folded to three lines with «Show all», the comment and its images — then the general text. The
// bubble reads all of it from the message's own text (quote-comments.ts, parseQuoted), so it draws the
// same after a restart. Where this window still keeps the sent quotes (quote-store.ts), a block shows
// the whole quote — the agent got a long one cut in the middle (owner, answer 4) — and its source
// line leads back to the quote's dim light in the agent's message.

/** The arrow of a source line: up, to the agent's message. */
function UpIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  )
}

function QuoteBlock({ number, quote, time, text, images, assistant, sent, onShow }: {
  number: number
  quote: string
  time: string | null
  text: string
  images: readonly MessageAttachment[]
  assistant: string
  sent: SentQuote | undefined
  onShow: ((id: string) => void) | undefined
}) {
  const quoteRef = useRef<HTMLQuoteElement>(null)
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)
  // «Show all» only when the three lines hide something.
  useLayoutEffect(() => {
    const element = quoteRef.current
    if (element === null || open) return
    setClamped(element.scrollHeight > element.clientHeight + 1)
  }, [quote, open])
  const source = `${assistant}${time === null ? '' : ` · ${time}`}`
  return (
    <div className="w-qprompt__block" data-testid="quoted-prompt-block" data-quote-number={number} data-quote-id={sent?.id} tabIndex={-1}>
      {sent !== undefined && onShow !== undefined ? (
        <button type="button" className="w-qprompt__source w-mono" data-testid="quoted-prompt-source" aria-label={`Show quote ${number} in the ${source} message`} onClick={() => onShow(sent.id)}>
          <span className="w-qprompt__number">{number}</span>
          <UpIcon />
          {source}
        </button>
      ) : (
        <span className="w-qprompt__source w-mono">
          <span className="w-qprompt__number">{number}</span>
          {source}
        </span>
      )}
      <blockquote ref={quoteRef} className={`w-qprompt__quote${open ? ' w-qprompt__quote--open' : ''}`} data-testid="quoted-prompt-quote">
        {squash(sent?.quote ?? quote)}
      </blockquote>
      {clamped || open ? (
        <button type="button" className="w-qprompt__more" aria-expanded={open} data-testid="quoted-prompt-more" onClick={() => setOpen((was) => !was)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      ) : null}
      {text !== '' ? (
        <div className="w-qprompt__comment" data-testid="quoted-prompt-comment">
          {text}
        </div>
      ) : null}
      {images.length > 0 ? <MessageAttachments attachments={images} /> : null}
    </div>
  )
}

/**
 * The bubble of a sent message with quote blocks. `attachments` are the message's, in the order they
 * went: the images its `[image N]` marks name stand under their comments, the rest under the bubble.
 */
export function QuotedPrompt({ text, parsed, attachments, assistant, find }: { text: string; parsed: ParsedMessage; attachments: readonly MessageAttachment[]; assistant: string; find: string }) {
  const context = useContext(SentQuotesContext)
  const sent = context?.sentIn(text)
  const images = attachments.filter((each) => each.kind === 'image')
  const blocks = parsed.quotes.map((quote) => ({ quote, images: quote.images.flatMap((number) => images.slice(number - 1, number)) }))
  // The images no mark names, and every other attachment, stand under the bubble.
  const named = new Set<MessageAttachment | undefined>(parsed.quotes.flatMap((quote) => quote.images.map((number) => images[number - 1])))
  const rest = attachments.filter((each) => !named.has(each))
  return (
    <>
      <div className="w-tr__prompt w-qprompt" data-testid="quoted-prompt" data-find={find}>
        {blocks.map(({ quote, images: shown }) => (
          <QuoteBlock
            key={quote.number}
            number={quote.number}
            quote={quote.quote}
            time={quote.time}
            text={quote.text}
            images={shown}
            assistant={assistant}
            sent={sent?.get(quote.number)}
            onShow={context?.showQuote}
          />
        ))}
        {parsed.general !== '' ? (
          <>
            <div className="w-qprompt__divider" aria-hidden="true" />
            <div className="w-qprompt__general" data-testid="quoted-prompt-general">
              {parsed.general}
            </div>
          </>
        ) : null}
      </div>
      {rest.length > 0 ? <MessageAttachments attachments={rest} /> : null}
    </>
  )
}

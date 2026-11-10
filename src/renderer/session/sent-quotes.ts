import { createContext } from 'react'
import type { SentQuote } from './quote-comments'

// What the Session view tells the bubbles of its sent messages about the quotes they carried
// (worfy-polish ticket 102; QuoteComments.tsx gives it, QuotedPrompt.tsx reads it). A view without
// comments — the read-only Session panel — gives none, and a bubble draws what its text holds.

export interface SentQuotes {
  /** The sent quotes of the message with this text, by their number. */
  sentIn: (message: string) => ReadonlyMap<number, SentQuote> | undefined
  /** Brings the quote's light in the agent's message into view and flashes it. */
  showQuote: (id: string) => void
}

export const SentQuotesContext = createContext<SentQuotes | null>(null)

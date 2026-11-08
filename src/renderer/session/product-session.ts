import { createContext } from 'react'

// What the Session view's parts share about a Product Session (worfy-product-session ticket 07), apart
// from its body (ProductSessionPanel.tsx): a file of components may export nothing else.

/** True inside a Product Session's chat: the input field locks the model there (Q10 of the spec). */
export const ProductSessionContext = createContext(false)

/** The tooltip of the locked model picker of a Product Session. */
export const PRODUCT_SESSION_MODEL_TOOLTIP = 'Product Session always runs on the strongest model'

/** The rail block a Product Session never shows: the Binding to a Ticket or an Epic. */
export const PRODUCT_SESSION_HIDDEN_BLOCKS: readonly string[] = ['BindingRail']

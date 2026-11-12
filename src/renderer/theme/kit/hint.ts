// The mark of an element whose tooltip HintTooltips shows (theme/kit/Tooltip.tsx, worfy-ui-kit
// ticket 13): for a place that can only spread props on an element it does not draw, as
// `writeAction` does (projects/read-only.ts). Kept apart from Tooltip.tsx, which exports components
// only, so a module that marks elements loads no Base UI.

/** The attribute that carries the text of a tooltip shown by HintTooltips. */
export const HINT_ATTRIBUTE = 'data-kit-hint'

/** The attributes of an element whose tooltip HintTooltips shows: the text, and the same text as its description. */
export interface HintProps {
  [HINT_ATTRIBUTE]: string
  'aria-description': string
}

/** Marks an element for HintTooltips: spread the result on the element. */
export function hintProps(text: string): HintProps {
  return { [HINT_ATTRIBUTE]: text, 'aria-description': text }
}

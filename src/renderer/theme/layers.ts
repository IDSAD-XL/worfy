/**
 * The scale of layers (z-index) for inline styles: the same values as the `--z-*` tokens of
 * tokens.css, where each is described (worfy-ui-kit ticket 02). test/unit/layers.test.tsx keeps the
 * two equal; change both together.
 */
export const LAYERS = {
  panel: 80,
  popover: 90,
  palette: 101,
  dialog: 110,
  toast: 120,
  canvasOverlay: 1000,
  dialogMenu: 3000,
  top: 4000,
} as const

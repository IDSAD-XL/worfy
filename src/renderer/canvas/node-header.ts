// The mark of a Node type's header row: `<div {...NODE_HEADER}>`. The toasts keep clear of a marked
// header shown in a focus tile (toast/ToastRegion.tsx, KEEP_OUT); test/unit/canvas-zoom.test.tsx
// lists the Node types that mark none, and checks the toasts against this mark.
export const NODE_HEADER = { 'data-node-header': '' } as const

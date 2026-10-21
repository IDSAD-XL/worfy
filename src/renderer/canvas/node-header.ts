// The mark of a Node type's header row: `<div {...NODE_HEADER}>`, a direct child of its
// `.w-node-surface`. The toasts keep clear of a marked header shown in a focus tile
// (toast/ToastRegion.tsx); test/unit/canvas-zoom.test.tsx lists the Node types that mark none.
export const NODE_HEADER = { 'data-node-header': '' } as const

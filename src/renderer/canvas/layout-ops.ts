// What the Canvas's gestures send their Layout operations through; useLayout.ts provides it to the
// Canvas. A module of its own, without React, so that code the Node test program checks
// (archive-list.ts, tsconfig.test.node.json) can name the type: useLayout.ts brings React's DOM
// types along, and they break the e2e specs' types there.
import type { LayoutOpInput } from '../../shared/layout/types'
import type { Group, RecordOptions } from './history'

/**
 * What the user's gestures on the Canvas use to change the Layout, the gestures on an Epic frame
 * too (its drag and its collapse button, sources/epics.ts). Every operation sent here is a step of
 * the user's undo history (history.ts); code that changes the Layout on its own (the Session Nodes
 * sync, the Subagent source) calls applyLayoutOp() instead.
 */
export interface LayoutOps {
  /**
   * Resolves once main has answered, whether it applied the operation or refused it. `group` makes
   * the operation part of one gesture's step (history.ts grouped()); `options` say how it is
   * recorded (a `patchData` is a step only with `data`).
   */
  apply(op: LayoutOpInput, group?: Group, options?: RecordOptions): Promise<void>
}

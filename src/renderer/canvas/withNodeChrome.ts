// Wraps a Node type's component in the chrome every Node gets (NodeChrome.tsx: tags, the pinned
// frame); Canvas.tsx registers every Node type through it (ticket 29). A file of its own, so the
// component file exports only components.
import { createElement, type ComponentType } from 'react'
import { NodeChrome } from './NodeChrome'
import type { CanvasNodeProps } from './nodes'

export function withNodeChrome(Component: ComponentType<CanvasNodeProps>): ComponentType<CanvasNodeProps> {
  return function Chromed(props: CanvasNodeProps) {
    return createElement(NodeChrome, { ...props, Component })
  }
}

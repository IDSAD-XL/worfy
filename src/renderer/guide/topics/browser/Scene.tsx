// The Topic Browser (worfy-guide ticket 14), from docs/features/browser.md: a Browser as a person sees
// it. On the Canvas, a Live Browser, the Session that drives it and an Asleep Browser; above it, under
// "NOT NODES", the Browser profile the page opens under, the Session's MCP server worfy-browser and
// the rules of sleep. The five steps walk a sign-in, browser_open, the tools, a takeover and sleep.
//
// The Canvas leads to its Topic and the Session to Sessions; the other blocks are this Topic.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { BROWSER_SCENE } from './spec'

export default function Scene(props: SceneProps) {
  return <LivingScene spec={BROWSER_SCENE} {...props} />
}

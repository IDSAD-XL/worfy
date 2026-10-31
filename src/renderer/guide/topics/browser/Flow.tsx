// The data flow of a Browser's page (worfy-guide ticket 14), the diagram of the Topic's Under the
// hood, from "Data flow" and "How it works" of docs/features/browser.md. The Browser layer of a window
// reports its screen, draws a <webview> for each Live Browser this window owns and hands the page to
// main, which makes a CdpPage of it. A Session's call comes from Claude Code through the MCP server
// worfy-browser, which holds the Browser in LiveBrowsers and sends CDP commands. Another screen
// watches the page's frames and sends its input. Labelled from the texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { BROWSER_FLOW } from './spec'

export default function Flow(props: SceneProps) {
  return <LivingScene spec={BROWSER_FLOW} {...props} />
}

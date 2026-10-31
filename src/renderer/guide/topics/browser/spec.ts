// The two diagrams of the Topic Browser (worfy-guide ticket 14), from docs/features/browser.md, apart
// from their components so the tests can read them: BROWSER_SCENE, a Browser as a person sees it
// (Scene.tsx), and BROWSER_FLOW, the data flow of its page in Under the hood (Flow.tsx). A thing
// drawn in both has the same group in both: the Session's side is `agents`, the Browser's page
// `tools`, and worfy's own code (the MCP server, the sleep rules, main's Browser state) `machine`.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

/**
 * Above, under "NOT NODES": the Browser profile, the Session's MCP server worfy-browser and the rules
 * of sleep. Below, on the Canvas: a Live Browser, the Session that drives it and an Asleep Browser.
 * The Session reaches the page only through its server, so no Edge joins it to the Browser.
 */
export const BROWSER_SCENE: SceneSpec = {
  width: 976,
  height: 420,
  regions: [{ label: 'notNodes', x: 184, y: 34 }],
  frames: [{ block: 'canvas', kind: 'canvas', x: 16, y: 176, width: 944, height: 236 }],
  blocks: [
    // Not Nodes.
    { id: 'profile', x: 184, y: 48, group: 'tools' },
    { id: 'server', x: 400, y: 48, group: 'machine' },
    { id: 'rules', x: 760, y: 48, group: 'machine' },
    // On the Canvas.
    { id: 'canvas', x: 32, y: 160, group: 'project', topic: 'canvas', page: page('canvas'), shape: 'tab', width: 92 },
    { id: 'browser', x: 220, y: 280, group: 'tools' },
    { id: 'session', x: 520, y: 280, group: 'agents', topic: 'sessions', page: page('sessions') },
    { id: 'asleep', x: 760, y: 280, group: 'tools' },
  ],
  edges: [
    // Into the Browser's top side, apart from the server's Edge.
    { from: 'profile', to: 'browser', label: 'signedIn', fromSide: 'bottom', toSide: 'top', toShift: -36 },
    { from: 'session', to: 'server', label: 'tools', fromSide: 'top', toSide: 'bottom', toShift: 30 },
    { from: 'server', to: 'browser', label: 'drives', fromSide: 'bottom', toSide: 'top', fromShift: -30, toShift: 36 },
    { from: 'rules', to: 'asleep', label: 'sleeps' },
  ],
  steps: [
    { caption: 'step1', blocks: ['profile', 'browser'] },
    { caption: 'step2', blocks: ['session', 'server', 'browser', 'profile'] },
    { caption: 'step3', blocks: ['session', 'server', 'browser'], edges: ['session->server', 'server->browser'] },
    { caption: 'step4', blocks: ['browser', 'session'] },
    { caption: 'step5', blocks: ['rules', 'asleep'] },
  ],
}

/**
 * Three columns: this window, the main process, Claude Code; below, the screens that show the page
 * as frames. The window draws the page and hands it to main; a Session's call reaches it over CDP;
 * another screen watches its frames and sends its input back.
 */
export const BROWSER_FLOW: SceneSpec = {
  width: 1040,
  height: 476,
  regions: [
    { label: 'window', x: 16, y: 24 },
    { label: 'main', x: 380, y: 24 },
    { label: 'claude', x: 864, y: 24 },
    { label: 'others', x: 16, y: 388 },
  ],
  blocks: [
    // This window.
    { id: 'page', x: 16, y: 40, group: 'tools' },
    { id: 'layer', x: 16, y: 220, group: 'machine' },
    // Another screen.
    { id: 'other', x: 16, y: 404, group: 'machine' },
    // The main process.
    { id: 'cdp', x: 380, y: 40, group: 'machine' },
    { id: 'lives', x: 380, y: 220, group: 'machine' },
    { id: 'screencast', x: 380, y: 404, group: 'machine' },
    { id: 'server', x: 620, y: 130, group: 'machine' },
    // Claude Code.
    { id: 'process', x: 864, y: 130, group: 'agents' },
  ],
  edges: [
    { from: 'layer', to: 'page', label: 'draws' },
    // Three Edges on the layer's right side and three on the left side of LiveBrowsers, each anchored
    // apart: browser.page.live highest, then browser.screen, browser.lives.changed, browser.input.
    { from: 'layer', to: 'lives', label: 'screen', fromShift: -10, toShift: -10 },
    { from: 'lives', to: 'layer', label: 'livesChanged', fromShift: 6, toShift: 6 },
    // Up from the top of the layer's right side into the lower half of the CdpPage's left side.
    { from: 'layer', to: 'cdp', label: 'pageLive', fromSide: 'right', toSide: 'left', fromShift: -24, toShift: 14 },
    { from: 'cdp', to: 'page', label: 'debugger', fromShift: -10, toShift: -10 },
    { from: 'process', to: 'server', label: 'call' },
    { from: 'server', to: 'cdp', label: 'commands', fromShift: -14 },
    { from: 'server', to: 'lives', label: 'holds', fromShift: 14 },
    { from: 'lives', to: 'screencast', label: 'newPage' },
    { from: 'other', to: 'screencast', label: 'watch', fromShift: -12, toShift: -12 },
    { from: 'screencast', to: 'other', label: 'frame', fromShift: 12, toShift: 12 },
    // Up from the top of the other screen into the lower part of the LiveBrowsers' left side.
    { from: 'other', to: 'lives', label: 'input', fromSide: 'top', toSide: 'left', fromShift: 40, toShift: 24 },
  ],
}

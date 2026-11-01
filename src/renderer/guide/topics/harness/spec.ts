// The two diagrams of the Topic Harness (worfy-guide ticket 18), apart from their components so the
// tests can read them: HARNESS_SCENE, the plugin and the Sessions it reaches (Scene.tsx), and
// HARNESS_FLOW, the data flow of an install and of a Session start in Under the hood (Flow.tsx).
// From docs/features/harness.md and docs/features/skills-agents-and-hooks.md. A thing drawn in both
// has the same group in both: the Harness and its folders are `harness`, worfy's own code is the
// neutral `machine`, Claude Code and its Sessions are `agents`.
import type { SceneSpec } from '../../scene/model'

const page = (name: string): string => `docs/features/${name}.md`

/**
 * Three columns, and the position says which area a block is in: worfy on the top left, the Harness
 * home below it (the installed plugin and the Profiles), the Sessions in the middle, and on the right,
 * under "PLUGIN worfy", the parts of the plugin. The columns stand 232 apart, so that a lit Edge's
 * label fits between them.
 */
export const HARNESS_SCENE: SceneSpec = {
  width: 976,
  height: 512,
  regions: [
    { label: 'harnessHome', x: 16, y: 172 },
    { label: 'sessions', x: 408, y: 24 },
    { label: 'plugin', x: 800, y: 24 },
  ],
  blocks: [
    // worfy and the Harness home.
    { id: 'app', x: 16, y: 40, group: 'machine' },
    { id: 'installed', x: 16, y: 188, group: 'harness' },
    { id: 'profile', x: 16, y: 304, group: 'harness' },
    // The Sessions.
    { id: 'orchestrator', x: 408, y: 40, group: 'harness', topic: 'sessions', page: page('sessions') },
    { id: 'subagent', x: 408, y: 304, group: 'agents', topic: 'sessions', page: page('sessions') },
    // The plugin.
    { id: 'skills', x: 800, y: 40, group: 'harness' },
    { id: 'hooks', x: 800, y: 140, group: 'harness' },
    { id: 'agents', x: 800, y: 240, group: 'harness' },
    { id: 'scripts', x: 800, y: 340, group: 'harness' },
    { id: 'qmd', x: 800, y: 440, group: 'harness' },
  ],
  edges: [
    // Down the right of the caption "HARNESS HOME", not through it.
    { from: 'app', to: 'installed', label: 'installs', fromShift: 50, toShift: 50 },
    { from: 'app', to: 'orchestrator', label: 'inline' },
    { from: 'orchestrator', to: 'subagent', label: 'starts' },
    { from: 'orchestrator', to: 'skills', label: 'runsSkill', fromShift: -10, toShift: -10 },
    { from: 'hooks', to: 'orchestrator', label: 'mainRules', toShift: 12 },
    // Four Edges meet the Subagent's right side, spread so that none crosses another.
    { from: 'hooks', to: 'subagent', label: 'commonRules', fromSide: 'left', toSide: 'right', toShift: -18 },
    { from: 'agents', to: 'subagent', label: 'role', toShift: -6 },
    { from: 'subagent', to: 'scripts', label: 'runsScripts', fromShift: 6 },
    { from: 'subagent', to: 'qmd', label: 'searches', fromShift: 18 },
    { from: 'subagent', to: 'profile', label: 'profileFirst' },
  ],
  steps: [
    { caption: 'step1', blocks: ['app', 'installed'] },
    { caption: 'step2', blocks: ['app', 'orchestrator', 'skills'] },
    { caption: 'step3', blocks: ['orchestrator', 'subagent', 'agents', 'profile'] },
    { caption: 'step4', blocks: ['hooks', 'orchestrator', 'subagent'] },
    { caption: 'step5', blocks: ['subagent', 'scripts', 'qmd'] },
  ],
}

/**
 * Three columns, 232 apart: the renderer with the plugin folder of the Harness home below it, the
 * main process, and Claude Code with its home. An install goes out on harness.install and comes back
 * on harness.changed; a Session gets the bundled copy inline; the scripts run from the plugin folder.
 */
export const HARNESS_FLOW: SceneSpec = {
  width: 976,
  height: 512,
  regions: [
    { label: 'renderer', x: 16, y: 24 },
    { label: 'home', x: 16, y: 184 },
    { label: 'main', x: 408, y: 24 },
    { label: 'claude', x: 800, y: 24 },
  ],
  blocks: [
    // The renderer, and the Harness home below it.
    { id: 'item', x: 16, y: 40, group: 'machine' },
    { id: 'pluginFolder', x: 16, y: 200, group: 'harness' },
    // The main process.
    { id: 'installer', x: 408, y: 40, group: 'machine' },
    { id: 'locate', x: 408, y: 200, group: 'machine' },
    { id: 'runner', x: 408, y: 320, group: 'machine' },
    { id: 'options', x: 408, y: 440, group: 'machine' },
    // Claude Code.
    { id: 'cli', x: 800, y: 40, group: 'agents' },
    { id: 'claudeHome', x: 800, y: 160, group: 'machine' },
    { id: 'session', x: 800, y: 440, group: 'agents' },
  ],
  edges: [
    // Two straight lines 22 apart, so that their labels do not touch.
    { from: 'item', to: 'installer', label: 'install', fromShift: -18, toShift: -18 },
    { from: 'installer', to: 'item', label: 'changed', fromShift: 4, toShift: 4 },
    { from: 'installer', to: 'cli', label: 'commands' },
    { from: 'cli', to: 'claudeHome', label: 'writes' },
    { from: 'installer', to: 'pluginFolder', label: 'swap', fromShift: 20, toShift: -14 },
    { from: 'pluginFolder', to: 'locate', label: 'found' },
    { from: 'runner', to: 'pluginFolder', label: 'runs', toShift: 14 },
    { from: 'locate', to: 'runner', label: 'binDir' },
    // Round the right of the Script runner, between the main process and Claude Code.
    { from: 'locate', to: 'options', label: 'kind', fromSide: 'right', toSide: 'right', toShift: -14 },
    { from: 'options', to: 'session', label: 'inline' },
  ],
}

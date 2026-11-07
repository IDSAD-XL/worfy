// Where the files of Product Session live (ADR-0101; Epic worfy-product-session, ticket 03). One
// function decides the folder, so the tools, the watcher and the screen agree on it:
//
//   Full mode    <Project root>/docs/product/   — goes into the repository by a docs PR
//   Silent mode  <Workflow folder>/product/     — outside git, as all workflow files of Silent mode
//
// Inside it: one folder per topic (`map.md`, `issues/`, `mind-map.json`, `drafts/`) and `critic/`
// with the critic's reviews. Shared by main and renderer, so it does not use node:path; a path keeps
// the separator its root is written with (src/shared/paths.ts).
import { isWindowsAbsolutePath } from '../paths'

/** The Product Session folder under the Project root in Full mode. */
export const PRODUCT_FULL_DIR = ['docs', 'product'] as const
/** The Product Session folder under the Workflow folder in Silent mode. */
export const PRODUCT_SILENT_DIR = 'product'
/** The critic's reviews, `critic/<epic>-<YYYY-MM-DD>.md`; never a topic. */
export const CRITIC_DIR = 'critic'
/** The advisor's Epic drafts of a topic, `drafts/<epic>.md`. */
export const DRAFTS_DIR = 'drafts'
export const MAP_FILE = 'map.md'
export const MAP_ISSUES_DIR = 'issues'
export const MIND_MAP_FILE = 'mind-map.json'

/** What decides the folder; src/main/workflow/folder.ts ProjectLayout has these fields. */
export interface ProductLayout {
  mode: 'full' | 'silent'
  /** The Project root. */
  root: string
  /** The Workflow folder: the Project root in Full mode, the folder outside the repository in Silent mode. */
  workflowFolder: string
}

/** `base` and `parts` joined with the separator `base` is written with: `\` for a Windows path spelled with it, else `/`. */
function joinPath(base: string, ...parts: string[]): string {
  const separator = isWindowsAbsolutePath(base) && base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

/** The Product Session folder of a Project: `docs/product` in Full mode, `<Workflow folder>/product` in Silent mode. */
export function productFolder(layout: ProductLayout): string {
  return layout.mode === 'silent' ? joinPath(layout.workflowFolder, PRODUCT_SILENT_DIR) : joinPath(layout.root, ...PRODUCT_FULL_DIR)
}

/**
 * A topic name is one folder name: letters of any script, digits, `.`, `_` and `-`, starting with a
 * letter or a digit, at most 80 characters, and not `critic`. No separator, no `..`, nothing hidden.
 */
export function isProductTopicName(name: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(name) && name !== CRITIC_DIR
}

/** The folder of one topic; a name that is not a topic name throws. */
export function productTopicFolder(productFolderPath: string, topic: string): string {
  if (!isProductTopicName(topic)) throw new Error(`not a Product Session topic name: ${JSON.stringify(topic)}`)
  return joinPath(productFolderPath, topic)
}

/** The folder of the critic's reviews. */
export function productCriticFolder(productFolderPath: string): string {
  return joinPath(productFolderPath, CRITIC_DIR)
}

/** The folder of a topic's Epic drafts. */
export function productDraftsFolder(topicFolder: string): string {
  return joinPath(topicFolder, DRAFTS_DIR)
}

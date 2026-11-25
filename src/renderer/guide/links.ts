// Where the GitHub links of the worfy Guide lead: the rules live in src/shared/guide/links.ts, where
// main builds the Assistant's links to the feature pages too (worfy-assistant ticket 17). They open in
// the system's browser (`shell.openExternal`), never in the window.
import { invoke } from '../ipc'

export { buildCommit, GUIDE_REPO_URL, githubFileUrl } from '../../shared/guide/links'

/** Opens `url` in the system's browser; the window stays where it is. */
export function openInBrowser(url: string): void {
  void invoke('shell.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('shell.openExternal failed:', result.error)
  })
}

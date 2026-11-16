// No test fetches from a remote that is not on the disk (worfy-polish ticket 118). worfy fetches the main branch of a
// Project a window shows (src/main/workflow/fetch.ts); a test that let it run against `https://github.com/...` would
// start the owner's credential helper (`gh auth git-credential`) and talk to GitHub. The fetch is no-op unless a test
// passes one (WorkflowHub's `fetch`); this guard covers the rest: a fetch to any other remote is refused before git
// runs, and the test that ran it fails here, in the hook after it, or at the end of its file when the fetch came later.
import { afterAll, afterEach } from 'vitest'
import { isLocalRemote, setFetchGuard } from '../src/main/workflow/fetch'

const refused: string[] = []

setFetchGuard((root, url) => {
  if (url === null || isLocalRemote(url)) return
  refused.push(`${url} (in ${root})`)
  throw new Error(`a test ran git fetch against ${url}, which is not on the disk (test/setup-no-remote-fetch.ts)`)
})

function check(): void {
  if (refused.length === 0) return
  const list = refused.splice(0)
  throw new Error(`git fetch to a remote that is not on the disk ran during the test: ${list.join(', ')}`)
}

afterEach(check)
afterAll(check)

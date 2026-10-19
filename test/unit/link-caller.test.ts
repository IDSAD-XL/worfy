// Who made a call and whether a path lies inside the Projects of this Machine
// (src/main/link/caller.ts, worfy-link ticket 08): a Linked machine works inside the listed
// Projects only, judged on real paths over a temporary folder with symbolic links.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { insideProjects, isRemoteCall, realInsideProjects } from '../../src/main/link/caller'
import { LinkSender } from '../../src/main/link/ipc-adapter'
import { removeTestTree } from '../remove'

// The native realpath, as the code under test uses: the temp folder may be spelled another way
// (an 8.3 short name, a `subst` drive), and the expected paths must be spelled as the disk does.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-link-caller-')))
const repo = join(root, 'Repo')
const sibling = join(root, 'Repo-evil')
const outside = join(root, 'outside')
mkdirSync(join(repo, 'src'), { recursive: true })
mkdirSync(sibling)
mkdirSync(outside)
writeFileSync(join(repo, 'src', 'a.ts'), 'a')
writeFileSync(join(outside, 'secret.txt'), 'secret')
symlinkSync(outside, join(repo, 'out-link'))
symlinkSync(join(repo, 'src'), join(outside, 'in-link'))
symlinkSync(join(root, 'not-there-yet'), join(repo, 'dangling'))
const projects = [{ path: repo }]
const windows = process.platform === 'win32'

afterAll(() => removeTestTree(root))

const linkSender = new LinkSender('3c1c6f43-6d4e-4c39-9d4c-7c2f0d7f2a11', 'project', () => undefined, () => ({ id: 'x', name: 'beta', protocol: 1, build: 'x' }))
const window = { id: 7, send: () => undefined }

describe('who made a call', () => {
  it('a window (a numeric id) is not remote; a link client, or a client with a string id, is', () => {
    expect(isRemoteCall({ sender: window })).toBe(false)
    expect(isRemoteCall({ sender: { send: () => undefined } })).toBe(false)
    expect(isRemoteCall({})).toBe(false)
    expect(isRemoteCall({ sender: linkSender })).toBe(true)
    expect(isRemoteCall({ sender: { id: 'link:machine-b/1' } })).toBe(true)
  })
})

describe('inside the Projects, by real paths', () => {
  it('the Project root and what lies under it are inside, as their real paths', () => {
    expect(realInsideProjects(repo, projects)).toBe(repo)
    expect(realInsideProjects(join(repo, 'src', 'a.ts'), projects)).toBe(join(repo, 'src', 'a.ts'))
    // A link from outside that leads in is inside: what counts is where it leads.
    expect(realInsideProjects(join(outside, 'in-link', 'a.ts'), projects)).toBe(join(repo, 'src', 'a.ts'))
  })

  // Paths with `..` are written out as strings: path.join would fold them before the check sees them.
  it('`..`, a symbolic link out of the Project and a sibling folder with the same prefix are outside', () => {
    expect(realInsideProjects(`${repo}/../outside/secret.txt`, projects)).toBeNull()
    expect(realInsideProjects(`${repo}/src/../../outside`, projects)).toBeNull()
    expect(realInsideProjects(`${repo}/src/../src/a.ts`, projects)).toBe(join(repo, 'src', 'a.ts'))
    // `..` after a link goes up from where the link leads, not from the link. Windows folds `..`
    // by the letters before it follows any link, so there it goes up from the link itself; the check
    // gets the same folded path the system opens, so a Linked machine still cannot get out.
    expect(realInsideProjects(`${repo}/out-link/../Repo/src`, projects)).toBe(windows ? join(repo, 'Repo', 'src') : join(repo, 'src'))
    // The secret is not reachable that way on Windows either: the system opens <repo>/outside/secret.txt.
    if (windows) {
      expect(existsSync(`${repo}/out-link/../outside/secret.txt`)).toBe(false)
      // And the check answers for that folded path, never for the file behind the link.
      const answer = realInsideProjects(`${repo}/out-link/../outside/secret.txt`, projects)
      expect(answer === null || answer.startsWith(`${repo}${sep}`), String(answer)).toBe(true)
    }
    expect(realInsideProjects(`${outside}/in-link/../../outside/secret.txt`, projects)).toBeNull()
    expect(realInsideProjects(join(repo, 'out-link', 'secret.txt'), projects)).toBeNull()
    expect(realInsideProjects(join(repo, 'out-link'), projects)).toBeNull()
    expect(realInsideProjects(sibling, projects)).toBeNull()
    expect(realInsideProjects('/', projects)).toBeNull()
    expect(realInsideProjects(root, projects)).toBeNull()
  })

  it('a path that does not exist yet is judged by its nearest folder; `..` after a missing name, or a link to nowhere, does not lead out', () => {
    expect(realInsideProjects(join(repo, 'new', 'file.ts'), projects)).toBe(join(repo, 'new', 'file.ts'))
    expect(realInsideProjects(join(outside, 'new'), projects)).toBeNull()
    expect(realInsideProjects(`${repo}/missing/../../outside/secret.txt`, projects)).toBeNull()
    expect(realInsideProjects(join(repo, 'dangling'), projects)).toBeNull()
    // Windows folds `dangling/..` away by the letters, so the path is <repo>/x, the one the system opens.
    expect(realInsideProjects(`${repo}/dangling/../x`, projects)).toBe(windows ? join(repo, 'x') : null)
    expect(realInsideProjects(join(repo, 'dangling', 'x'), projects)).toBeNull()
  })

  it('another spelling of the Project folder on a case-insensitive disk is the same folder', () => {
    // On a case-sensitive disk (Linux CI) REPO is another, missing folder: outside, the safe side.
    const caseInsensitive = (() => {
      try {
        return realpathSync(join(root, 'REPO')) !== ''
      } catch {
        return false
      }
    })()
    expect(realInsideProjects(join(root, 'REPO', 'src', 'a.ts'), projects)).toBe(caseInsensitive ? join(repo, 'src', 'a.ts') : null)
    // And a Project stored in another spelling still holds its own files.
    expect(realInsideProjects(join(repo, 'src'), [{ path: join(root, 'REPO') }])).toBe(caseInsensitive ? join(repo, 'src') : null)
  })

  it('no Projects, nothing inside', () => {
    expect(realInsideProjects(repo, [])).toBeNull()
  })
})

describe('the check of a call', () => {
  it('refuses a remote call outside the Projects naming the path; passes it inside with the real path', () => {
    expect(() => insideProjects({ sender: linkSender }, join(repo, 'out-link', 'secret.txt'), () => projects, 'the file')).toThrow(
      `the file ${join(repo, 'out-link', 'secret.txt')} is outside the Projects of this Machine`,
    )
    expect(insideProjects({ sender: linkSender }, join(outside, 'in-link', 'a.ts'), () => projects, 'the file')).toBe(join(repo, 'src', 'a.ts'))
  })

  it('a window\'s call passes untouched, wherever the path is, and the list is not even read', () => {
    let read = 0
    const list = () => {
      read += 1
      return projects
    }
    expect(insideProjects({ sender: window }, join(outside, 'secret.txt'), list, 'the file')).toBe(join(outside, 'secret.txt'))
    expect(insideProjects({ sender: window }, '/', list, 'the folder')).toBe('/')
    expect(read).toBe(0)
  })
})

// A Project local to this Machine (`localOnly`, the Demo project) does not exist for a Linked
// machine (src/main/link/caller.ts): its root is no Project root for a call over the link, and a
// call input or an event payload that names it is caught; a window's call goes on as before.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { insideProjects, localProjectIn, projectRootOf, setLocalProjects } from '../../src/main/link/caller'
import { LinkSender } from '../../src/main/link/ipc-adapter'
import { removeTestTree } from '../remove'

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-link-local-only-')))
const shop = join(root, 'shop')
const demo = join(root, 'demo')
mkdirSync(join(shop, 'src'), { recursive: true })
mkdirSync(join(demo, 'src'), { recursive: true })
const demoProject = { id: 'demo-0a1b2c3d', name: 'demo', path: demo, localOnly: true as const }
const shopProject = { id: 'shop-1a2b3c4d', name: 'shop', path: shop }
const projects = () => [shopProject, demoProject]
const noWorktrees = () => Promise.resolve([])

afterAll(() => removeTestTree(root))
afterEach(() => setLocalProjects(() => []))

const remote = { sender: new LinkSender('3c1c6f43-6d4e-4c39-9d4c-7c2f0d7f2a11', 'project', () => undefined, () => ({ id: 'x', name: 'beta', protocol: 1, build: 'x' })) }
const window = { sender: { id: 7, send: () => undefined } }

describe('insideProjects with a Project local to this Machine', () => {
  it('refuses a path inside it to a call over the link; a path inside an ordinary Project passes', () => {
    expect(() => insideProjects(remote, join(demo, 'src'), projects, 'the folder')).toThrow(`the folder ${join(demo, 'src')} is outside the Projects of this Machine`)
    expect(() => insideProjects(remote, demo, projects, 'the folder')).toThrow('is outside the Projects of this Machine')
    expect(insideProjects(remote, join(shop, 'src'), projects, 'the folder')).toBe(join(shop, 'src'))
  })

  it("gives a window's call the path as it came", () => {
    expect(insideProjects(window, join(demo, 'src'), projects, 'the folder')).toBe(join(demo, 'src'))
  })
})

describe('projectRootOf with a Project local to this Machine', () => {
  it('refuses its root to a call over the link; an ordinary root passes', async () => {
    await expect(projectRootOf(remote, demo, projects, noWorktrees, 'the Project root')).rejects.toThrow('is outside the Projects of this Machine')
    await expect(projectRootOf(remote, shop, projects, noWorktrees, 'the Project root')).resolves.toBe(shop)
  })

  it("gives a window's call the root as it came", async () => {
    await expect(projectRootOf(window, demo, projects, noWorktrees, 'the Project root')).resolves.toBe(demo)
  })
})

describe('localProjectIn: what names a Project local to this Machine', () => {
  it('names nothing before a source of local Projects is set', () => {
    expect(localProjectIn('layout.get', { projectId: demoProject.id })).toBeNull()
  })

  it('its projectId, its id in the projects domain, or a path inside its root', () => {
    setLocalProjects(() => [demoProject])
    expect(localProjectIn('layout.get', { projectId: demoProject.id })).toStrictEqual(demoProject)
    expect(localProjectIn('projects.remove', { id: demoProject.id })).toStrictEqual(demoProject)
    expect(localProjectIn('agent.start', { cwd: join(demo, 'src') })).toStrictEqual(demoProject)
    expect(localProjectIn('projects.add', { path: demo })).toStrictEqual(demoProject)
    expect(localProjectIn('workflow.changed', { root: demo, epics: [] })).toStrictEqual(demoProject)
  })

  it('anything else: another Project, an `id` outside the projects domain, a relative path, no object', () => {
    setLocalProjects(() => [demoProject])
    expect(localProjectIn('layout.get', { projectId: shopProject.id })).toBeNull()
    expect(localProjectIn('cards.read', { id: demoProject.id })).toBeNull()
    expect(localProjectIn('projects.add', { path: shop })).toBeNull()
    expect(localProjectIn('projects.add', { path: 'demo' })).toBeNull()
    expect(localProjectIn('terminal.input', { data: demo })).toBeNull()
    expect(localProjectIn('projects.list', undefined)).toBeNull()
  })
})

describe('the project client of a link connection', () => {
  it('does not pass on an event of a Project local to this Machine; another Project\'s event goes out', async () => {
    // The channel must be declared for the client to send it at all.
    await import('../../src/shared/ipc/layout')
    setLocalProjects(() => [demoProject])
    const pushed: { channel: string; payload: unknown }[] = []
    const client = new LinkSender('3c1c6f43-6d4e-4c39-9d4c-7c2f0d7f2a11', 'project', (channel, payload) => pushed.push({ channel, payload }), () => ({ id: 'x', name: 'beta', protocol: 1, build: 'x' }))
    client.send('worfy:layout.archived', { projectId: demoProject.id, batch: 'b', count: 1 })
    client.send('worfy:layout.archived', { projectId: shopProject.id, batch: 'b', count: 1 })
    expect(pushed.map((item) => (item.payload as { projectId: string }).projectId)).toEqual([shopProject.id])
  })
})

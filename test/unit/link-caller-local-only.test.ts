// A Project local to this Machine (`localOnly`, the Demo project) does not exist for a Linked
// machine (src/main/link/caller.ts): its root is no Project root for a call over the link, and a
// call input or an event payload that names it is caught; a window's call goes on as before.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { insideProjects, localProjectIn, localProjectOf, projectRootOf, setLocalProjects, setSessionFolders } from '../../src/main/link/caller'
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
afterEach(() => {
  setLocalProjects(() => [])
  setSessionFolders(() => null)
})

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

  it('its project label: `projectLabel` (cards.file), or the store `canvas.<project label>` on an images channel (images.file)', () => {
    setLocalProjects(() => [demoProject])
    expect(localProjectIn('cards.file', { projectLabel: '0a1b2c3d', cardId: 'c1', path: '/index.html' })).toStrictEqual(demoProject)
    expect(localProjectIn('images.file', { store: 'canvas.0a1b2c3d', name: 'x.png' })).toStrictEqual(demoProject)
    // Another Project's label, the store of sent images, and a `store` on another channel name nothing.
    expect(localProjectIn('cards.file', { projectLabel: '1a2b3c4d', cardId: 'c1', path: '/index.html' })).toBeNull()
    expect(localProjectIn('images.file', { store: 'attachments', name: 'x.png' })).toBeNull()
    expect(localProjectIn('images.file', { store: 'canvas.1a2b3c4d', name: 'x.png' })).toBeNull()
    expect(localProjectIn('browser.profiles.list', { store: 'canvas.0a1b2c3d' })).toBeNull()
  })

  it('a relative path is taken from main\'s working folder, as fs and `git -C` take it', () => {
    setLocalProjects(() => [demoProject])
    expect(localProjectIn('projects.add', { path: relative(process.cwd(), demo) })).toStrictEqual(demoProject)
    expect(localProjectIn('projects.connect.write', { root: relative(process.cwd(), join(demo, 'src')), draft: {} })).toStrictEqual(demoProject)
    expect(localProjectOf(relative(process.cwd(), join(demo, 'src')))).toStrictEqual(demoProject)
  })

  it('a `..` after a symbolic link is judged both as the kernel follows it and as resolve() reads it (pipeline.ts, checks.ts)', () => {
    // <root>/L -> <root>/a/b: <root>/L/../demo is <root>/a/demo for the kernel, <root>/demo for resolve().
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    symlinkSync(join(root, 'a', 'b'), join(root, 'L'))
    setLocalProjects(() => [demoProject])
    const through = join(root, 'L') + sep + '..' + sep + 'demo'
    expect(localProjectIn('pipeline.get', { root: through })).toStrictEqual(demoProject)
    expect(localProjectIn('checks.get', { root: through })).toStrictEqual(demoProject)
  })

  it('the Workflow folder of a connection: workflowFolder of connect.draft, draft.profile.workflow.folder of connect.write', () => {
    setLocalProjects(() => [demoProject])
    expect(localProjectIn('projects.connect.draft', { draftId: 'd', root: shop, mode: 'silent', workflowFolder: join(demo, 'src') })).toStrictEqual(demoProject)
    const draft = (folder: unknown) => ({ profile: { mode: 'silent', workflow: { folder } }, rules: '', gate: [] })
    expect(localProjectIn('projects.connect.write', { root: shop, draft: draft(demo) })).toStrictEqual(demoProject)
    expect(localProjectIn('projects.connect.write', { root: shop, draft: draft(join(shop, 'src')) })).toBeNull()
    expect(localProjectIn('projects.connect.write', { root: shop, draft: draft(null) })).toBeNull()
    expect(localProjectIn('projects.connect.write', { root: shop, draft: { profile: { workflow: 'x' } } })).toBeNull()
  })

  it('a sessionId of a Session whose folder lies in its root; an unknown Session or one elsewhere names nothing', () => {
    setLocalProjects(() => [demoProject])
    setSessionFolders((sessionId) => ({ 's-demo': join(demo, 'src'), 's-shop': shop })[sessionId] ?? null)
    expect(localProjectIn('agent.send', { sessionId: 's-demo', text: 'hi' })).toStrictEqual(demoProject)
    expect(localProjectIn('agent.event', { sessionId: 's-demo', event: { type: 'text' } })).toStrictEqual(demoProject)
    expect(localProjectIn('agent.send', { sessionId: 's-shop', text: 'hi' })).toBeNull()
    expect(localProjectIn('agent.send', { sessionId: 's-gone', text: 'hi' })).toBeNull()
  })

  it('anything else: another Project, an `id` outside the projects domain, a relative path to another Project, an empty path, no object', () => {
    setLocalProjects(() => [demoProject])
    expect(localProjectIn('layout.get', { projectId: shopProject.id })).toBeNull()
    expect(localProjectIn('cards.read', { id: demoProject.id })).toBeNull()
    expect(localProjectIn('projects.add', { path: shop })).toBeNull()
    expect(localProjectIn('projects.add', { path: relative(process.cwd(), shop) })).toBeNull()
    expect(localProjectIn('projects.add', { path: '' })).toBeNull()
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

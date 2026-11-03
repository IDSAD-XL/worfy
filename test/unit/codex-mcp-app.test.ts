// The app's side of worfy's MCP servers for Codex (worfy-multi-vendor ticket 33): the app's endpoint
// (appMcpHttpEndpoint, src/main/mcp/http-server.ts) — one per app, closed in `will-quit`, started again
// after a start that failed —, the app-server options that hand the Codex driver its servers
// (appServerOptions, src/main/vendors/codex/session.ts), and the environment that sends Codex's requests
// to the endpoint past the user's proxy (directToLoopback, src/main/vendors/codex/mcp.ts). Electron's
// `app` is a stand-in that records its listeners; `node:http` is the real one, except that a test can
// make the next listen fail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpHttpEndpoint } from '../../src/main/mcp/http-server'

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (() => void)[]>()
  return {
    listeners,
    /** The next read of `app` throws, as an import of Electron that fails would. */
    failNextApp: false,
    emit: (event: string): void => {
      for (const listener of listeners.get(event) ?? []) listener()
    },
    app: {
      isPackaged: false,
      getAppPath: () => '/Applications/worfy.app/Contents/Resources/app',
      getVersion: () => '1.2.3',
      on(event: string, listener: () => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return this
      },
    },
  }
})

vi.mock('electron', () => ({
  get app() {
    if (electron.failNextApp) {
      electron.failNextApp = false
      throw new Error('electron is not ready')
    }
    return electron.app
  },
}))

const http = vi.hoisted(() => ({ failNextListen: false, servers: [] as import('node:http').Server[] }))

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  const createServer = ((...args: Parameters<typeof actual.createServer>) => {
    const server = actual.createServer(...args)
    http.servers.push(server)
    if (http.failNextListen) {
      http.failNextListen = false
      server.listen = (() => {
        process.nextTick(() => server.emit('error', Object.assign(new Error('listen EADDRNOTAVAIL: address not available 127.0.0.1'), { code: 'EADDRNOTAVAIL' })))
        return server
      }) as typeof server.listen
    }
    return server
  }) as typeof actual.createServer
  return { ...actual, default: { ...actual, createServer }, createServer }
})

const started: McpHttpEndpoint[] = []

beforeEach(() => {
  // A fresh module each test: the app's endpoint lives in a variable of the module.
  vi.resetModules()
  electron.listeners.clear()
  electron.failNextApp = false
  http.failNextListen = false
  http.servers.length = 0
})

afterEach(async () => {
  for (const endpoint of started.splice(0)) await endpoint.close()
})

/** Whether the endpoint at `port` still answers. */
async function answers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/mcp/worfy-canvas`, { method: 'POST', body: '{}' })
    return true
  } catch {
    return false
  }
}

describe('the app\'s MCP endpoint', () => {
  it('starts once for every caller, and stops listening when the app quits', async () => {
    const { appMcpHttpEndpoint } = await import('../../src/main/mcp/http-server')
    const first = appMcpHttpEndpoint()
    expect(appMcpHttpEndpoint()).toBe(first)
    const endpoint = await first
    started.push(endpoint)
    expect(appMcpHttpEndpoint()).toBe(first)
    expect(await answers(endpoint.port)).toBe(true)
    expect(electron.listeners.get('will-quit')).toHaveLength(1)

    electron.emit('will-quit')
    const deadline = Date.now() + 2000
    while ((await answers(endpoint.port)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await answers(endpoint.port)).toBe(false)
  })

  it('a start that failed is tried again by the next call; a call during the failed start shares its failure', async () => {
    const { appMcpHttpEndpoint } = await import('../../src/main/mcp/http-server')
    http.failNextListen = true
    const failed = appMcpHttpEndpoint()
    expect(appMcpHttpEndpoint()).toBe(failed)
    await expect(failed).rejects.toThrow(/EADDRNOTAVAIL/)
    // The failed start registered nothing to close.
    expect(electron.listeners.get('will-quit')).toBeUndefined()

    const again = appMcpHttpEndpoint()
    expect(again).not.toBe(failed)
    const endpoint = await again
    started.push(endpoint)
    expect(await answers(endpoint.port)).toBe(true)
    expect(appMcpHttpEndpoint()).toBe(again)
    expect(electron.listeners.get('will-quit')).toHaveLength(1)
  })

  it('without Electron\'s app the start fails before anything listens: no endpoint is left open with nothing to close it', async () => {
    const { appMcpHttpEndpoint } = await import('../../src/main/mcp/http-server')
    electron.failNextApp = true
    await expect(appMcpHttpEndpoint()).rejects.toThrow(/electron is not ready/)
    expect(http.servers.filter((server) => server.listening)).toEqual([])
    const endpoint = await appMcpHttpEndpoint()
    started.push(endpoint)
    expect(electron.listeners.get('will-quit')).toHaveLength(1)
  })
})

describe('the app\'s Codex app-server options', () => {
  it('hand every Codex Session worfy\'s MCP servers', async () => {
    const { appServerOptions } = await import('../../src/main/vendors/codex/session')
    const { appCodexMcp } = await import('../../src/main/vendors/codex/mcp')
    const options = await appServerOptions()
    expect(options.mcp).toBe(appCodexMcp)
    expect(options).toMatchObject({ appPath: electron.app.getAppPath(), clientVersion: '1.2.3' })
  })
})

describe('the app-server\'s environment past a proxy', () => {
  it('adds 127.0.0.1 and localhost to NO_PROXY and no_proxy, keeping the user\'s entries and everything else', async () => {
    const { directToLoopback } = await import('../../src/main/vendors/codex/mcp')
    const { MCP_HTTP_HOST } = await import('../../src/main/mcp/http-server')
    const base = { PATH: '/usr/bin', HTTP_PROXY: 'http://proxy.example:3128' }
    const direct = directToLoopback(base)
    expect(direct).toEqual({ ...base, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' })
    // The host the endpoint's URLs name is on the list.
    expect(direct.NO_PROXY!.split(',')).toContain(MCP_HTTP_HOST)
    // The input is not changed.
    expect(base).toEqual({ PATH: '/usr/bin', HTTP_PROXY: 'http://proxy.example:3128' })
  })

  it('keeps each spelling\'s own list; one spelling alone gives its list to the other; an entry already there is not repeated', async () => {
    const { directToLoopback } = await import('../../src/main/vendors/codex/mcp')
    expect(directToLoopback({ NO_PROXY: 'corp.example, .internal' })).toEqual({ NO_PROXY: 'corp.example, .internal,127.0.0.1,localhost', no_proxy: 'corp.example, .internal,127.0.0.1,localhost' })
    expect(directToLoopback({ no_proxy: 'corp.example' })).toEqual({ NO_PROXY: 'corp.example,127.0.0.1,localhost', no_proxy: 'corp.example,127.0.0.1,localhost' })
    expect(directToLoopback({ NO_PROXY: 'a.example', no_proxy: 'b.example' })).toEqual({ NO_PROXY: 'a.example,127.0.0.1,localhost', no_proxy: 'b.example,127.0.0.1,localhost' })
    expect(directToLoopback({ NO_PROXY: 'LOCALHOST, 127.0.0.1' })).toEqual({ NO_PROXY: 'LOCALHOST, 127.0.0.1', no_proxy: 'LOCALHOST, 127.0.0.1' })
    expect(directToLoopback({ NO_PROXY: 'localhost' })).toEqual({ NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' })
    expect(directToLoopback({ NO_PROXY: '' })).toEqual({ NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' })
    // Windows reads a variable's name in any case: a third spelling gets the hosts too.
    expect(directToLoopback({ No_Proxy: 'corp.example' })).toEqual({ No_Proxy: 'corp.example,127.0.0.1,localhost', NO_PROXY: 'corp.example,127.0.0.1,localhost', no_proxy: 'corp.example,127.0.0.1,localhost' })
  })
})

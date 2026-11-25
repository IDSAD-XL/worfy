// A file system under Windows rules (path.win32) for the reads of Product Session files — the topics
// (src/main/product/topic.ts, readProductTopic of src/main/docs/watch.ts), the share of accepted
// advice (src/main/ipc/product.ts) and mind_map_read (src/main/mcp/mind-map-server.ts) — after
// test/unit/docs-remote-links.test.ts. On Windows a read through a symlink to `\\host\share\…`
// makes the system hand that host the user's credentials (worfy-windows tickets 18 and 19), so each
// test checks which paths were asked: every call is recorded in `calls`, and a link is never followed
// here, so a read of a path behind one would show up there.
import { win32 } from 'node:path'

export interface FakeTree {
  /** The files and their text, by full path. */
  files?: Record<string, string>
  /** Folders with nothing in them; any folder that holds a file is there anyway. */
  folders?: readonly string[]
  /** A link and its target as written. */
  links?: Record<string, string>
  /** What realpath answers for a path that is not itself; any other path there is its own real path. */
  reals?: Record<string, string>
  /** Paths lstat is refused for (EACCES): a link on the way that cannot be read. */
  denied?: readonly string[]
}

const key = (path: string): string => path.toLowerCase()
const failure = (code: string, path: string): Error => Object.assign(new Error(`${code}: ${path}`), { code })

/** The calls `options.fs` and `options.links` answer, under path.win32. */
export function fakeProductSystem(tree: FakeTree) {
  const calls: string[] = []
  const files = new Map(Object.entries(tree.files ?? {}).map(([path, text]) => [key(path), { path, text }]))
  const links = new Map(Object.entries(tree.links ?? {}).map(([path, target]) => [key(path), { path, target }]))
  const every = [...files.values(), ...links.values()].map((each) => each.path)
  const all = [...every, ...(tree.folders ?? [])]
  const isFolder = (path: string): boolean => (tree.folders ?? []).some((folder) => key(folder) === key(path)) || all.some((each) => key(each).startsWith(`${key(path)}\\`))
  const there = (path: string): boolean => files.has(key(path)) || links.has(key(path)) || isFolder(path)

  return {
    calls,
    options: {
      paths: win32,
      fs: {
        realpath: async (path: string): Promise<string> => {
          calls.push(`realpath ${path}`)
          const real = Object.entries(tree.reals ?? {}).find(([from]) => key(from) === key(path))
          if (real !== undefined) return real[1]
          if (!there(path)) throw failure('ENOENT', path)
          return path
        },
        isFolder: async (path: string): Promise<boolean> => {
          calls.push(`isFolder ${path}`)
          return isFolder(path)
        },
        readdir: async (dir: string): Promise<{ name: string; isDirectory: () => boolean }[]> => {
          calls.push(`readdir ${dir}`)
          if (!isFolder(dir)) throw failure(there(dir) ? 'ENOTDIR' : 'ENOENT', dir)
          const names = new Map<string, boolean>()
          for (const path of all) {
            if (!key(path).startsWith(`${key(dir)}\\`)) continue
            const [name, ...rest] = path.slice(dir.length + 1).split('\\')
            const child = win32.join(dir, name!)
            names.set(name!, rest.length > 0 || (isFolder(child) && !links.has(key(child))))
          }
          return [...names].map(([name, folder]) => ({ name, isDirectory: () => folder }))
        },
        readFile: async (path: string): Promise<string> => {
          calls.push(`readFile ${path}`)
          if (isFolder(path)) throw failure('EISDIR', path)
          const file = files.get(key(path))
          if (file === undefined) throw failure('ENOENT', path)
          return file.text
        },
      },
      links: {
        isLink: async (path: string): Promise<boolean | null> => {
          calls.push(`lstat ${path}`)
          if ((tree.denied ?? []).some((each) => key(each) === key(path))) throw failure('EACCES', path)
          return links.has(key(path)) ? true : there(path) ? false : null
        },
        readlink: async (path: string): Promise<string> => {
          calls.push(`readlink ${path}`)
          const link = links.get(key(path))
          if (link === undefined) throw failure('EINVAL', path)
          return link.target
        },
      },
    },
  }
}

/** The calls that read a file or a folder: what must never reach a path behind a link to another host. */
export const reads = (calls: readonly string[]): string[] => calls.filter((call) => /^(readFile|readdir|realpath|isFolder) /u.test(call))

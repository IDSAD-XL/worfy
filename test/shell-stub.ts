import { rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The one stand-in file every shell stub of the tests is: it runs the body next to its link. */
export const SHELL_STUB = join(import.meta.dirname, 'fixtures', 'shell-stub', 'stub')

/**
 * Puts a /bin/sh stand-in at `path` whose body is `lines` (without the `#!` line): `<path>.sh` gets
 * the body, and `path` becomes a link to test/fixtures/shell-stub/stub, which reads that body.
 * Whatever was at `path` is replaced. Started through another link to `path`, the stub follows the
 * links back to `path` and its body.
 *
 * macOS checks every new executable before its first start (XprotectService, one file at a time for
 * the whole machine): 130–400 ms per file without load, seconds under a loaded gate. A stand-in
 * written anew in each test waited in that queue each time; a link to the one stub file does not.
 * On Windows, where a link to a file needs a privilege and no such check is made, `path` is the
 * script itself, `#!/bin/sh` and the body, as the tests wrote it before.
 */
export function shellStub(path: string, lines: string[]): void {
  const body = `${lines.join('\n')}\n`
  rmSync(path, { force: true })
  if (process.platform === 'win32') {
    writeFileSync(path, `#!/bin/sh\n${body}`, { mode: 0o755 })
    return
  }
  writeFileSync(`${path}.sh`, body)
  symlinkSync(SHELL_STUB, path)
}

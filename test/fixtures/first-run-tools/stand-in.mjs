// What the Node stand-ins of this folder share (README.md): the call log and the answer to a call
// they do not know.
import { appendFileSync } from 'node:fs'
import process from 'node:process'

/** Appends `<tool> <arguments>` to $FIRST_RUN_TOOLS_LOG when it is set, as the shell stand-ins' `printf '%s %s\n' "$*"`. */
export function log(tool, args) {
  const file = process.env.FIRST_RUN_TOOLS_LOG
  if (file) appendFileSync(file, `${tool} ${args.join(' ')}\n`)
}

/** Prints that the call is not supported and exits 2. */
export function unsupported(tool, args) {
  process.stderr.write(`${tool} stand-in: unsupported: ${args.join(' ')}\n`)
  process.exit(2)
}

// gate-failures machine — the computer the failure records of this Harness home name.
//
//   gate-failures machine [--json]            show it; machine.json is created on the first call
//   gate-failures machine --name <name>       give it another name; the id stays
//
// <Harness home>/gate/machine.json holds { id, name }: 8 random hex digits made once, and "mac",
// "windows" or "linux" until a name is given. The host name and the user name never go there: a name
// that is one of them, or holds other personal data, is refused.
// Exit codes: 0; 2 — wrong arguments or a refused name.

import os from "node:os"
import { harnessHome } from "../../hooks/gate-paths.mjs"
import { checkComputerName, ensureComputer, machineFile, setComputerName } from "../../hooks/gate-failures.mjs"

export const summary = "show the computer of the records, or rename it (--name <name>, --json)"

const USAGE = "usage: gate-failures machine [--json] [--name <name>]\n"

function userName() {
    try {
        return os.userInfo().username
    } catch {
        return undefined
    }
}

function parseArgs(argv) {
    const args = { json: false, name: undefined, help: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--json") args.json = true
        else if (a === "--help" || a === "-h") args.help = true
        else if (a === "--name") {
            if (i + 1 >= argv.length) return { error: "--name takes a name" }
            args.name = argv[++i]
        } else return { error: `unknown argument ${JSON.stringify(a)}` }
    }
    return args
}

export function run(argv, io) {
    const args = parseArgs(argv)
    if (args.error) {
        io.stderr.write(`gate-failures machine: ${args.error}\n${USAGE}`)
        return 2
    }
    if (args.help) {
        io.stdout.write(USAGE)
        return 0
    }
    const home = harnessHome(io.env, io.cwd)
    let computer
    if (args.name !== undefined) {
        const reason = checkComputerName(args.name, { host: os.hostname(), user: userName() })
        if (reason) {
            io.stderr.write(`gate-failures machine: ${reason}\n`)
            return 2
        }
        computer = setComputerName(home, args.name)
    } else computer = ensureComputer(home)
    if (args.json) io.stdout.write(`${JSON.stringify({ ...computer, file: machineFile(home) }, null, 2)}\n`)
    else io.stdout.write(`${computer.name}  id ${computer.id}  ${computer.platform}  (${machineFile(home)})\n`)
    return 0
}

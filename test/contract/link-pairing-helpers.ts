// Helpers shared by the pairing tests (link-pairing.test.ts and link-pairing-failures.test.ts): the
// rejection of a call, remembered for the bench's leak check, and the files of a machine's link folder.
import type { BenchMachine, LinkBench } from './link-bench'

export interface LinkPairingHelpers {
  /** Error texts a test met; the leak check after each test looks for secrets in them. */
  readonly errors: string[]
  /** The rejection of `promise`, remembered for the leak check. */
  rejection(promise: Promise<unknown>): Promise<Error>
  /** A file of the machine's link folder, parsed. */
  linkFile<T>(machine: BenchMachine, name: string): T
  certificateOf(machine: BenchMachine): string
  secretsOf(machine: BenchMachine): Record<string, string>
  /** The token `owner` presents to `to`. */
  outgoingToken(owner: BenchMachine, to: BenchMachine): string
}

/** The helpers over the bench `benchOf` returns: a test file keeps its own bench, and a test may replace it. */
export function linkPairingHelpers(benchOf: () => LinkBench): LinkPairingHelpers {
  const errors: string[] = []

  async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise
    } catch (error) {
      const caught = error instanceof Error ? error : new Error(String(error))
      errors.push(caught.message)
      return caught
    }
    throw new Error('expected a rejection')
  }

  function linkFile<T>(machine: BenchMachine, name: string): T {
    const file = benchOf().files(machine).find((entry) => entry.path.endsWith(name))
    if (file === undefined) throw new Error(`${machine.label} has no ${name}`)
    return JSON.parse(file.bytes.toString('utf8')) as T
  }

  const certificateOf = (machine: BenchMachine): string => linkFile<{ certificate: string }>(machine, 'machine.json').certificate
  const secretsOf = (machine: BenchMachine): Record<string, string> => linkFile<{ secrets: Record<string, string> }>(machine, 'secrets.json').secrets

  function outgoingToken(owner: BenchMachine, to: BenchMachine): string {
    const token = secretsOf(owner)[`outgoing:${to.service.machine.id}`]
    if (token === undefined) throw new Error(`${owner.label} has no token for ${to.label}`)
    return token
  }

  return { errors, rejection, linkFile, certificateOf, secretsOf, outgoingToken }
}

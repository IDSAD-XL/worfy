// The build of a Linked machine for an item of the Acceptance view (worfy-acceptance ticket 07; spec, "Linked
// machine" and "Platform, copy and commit of the line"). A Machine says its build and platform in the `hello` of each
// connection (src/main/link/messages.ts); main keeps them while the connection is open and gives them to the windows
// with what it knows of each Linked machine (`linked.state`, src/shared/ipc/linked.ts). From that:
// - the line of an item whose `needs:` names another platform than this Machine's — "PC build: <build> (<name>)" while
//   a Linked machine of that platform is online, "PC not connected" otherwise, and "Update worfy on <name>" when the
//   window's Machine is of a build before this ticket and says no platform;
// - the commit a decision names when it was checked on a Linked machine: the commit of that Machine's build;
// - what the view says when the Linked machine's worfy has no channel of the Acceptance view yet.
import type { OwnerCheckPlatform } from '../projects/action-templates'

/** A Linked machine as this function reads it: what main knows of it (linked.state) with its name (link.state). */
export interface BuildMachine {
  id: string
  name: string
  online: boolean
  /** Its build version, `<semver>+<SHA>[.dirty]`, from its last `hello`; absent while offline. */
  build?: string | undefined
  /** Its platform from its last `hello`; absent while offline and from a build before ticket 07. */
  platform?: OwnerCheckPlatform | undefined
}

export interface LinkedBuildLine {
  /** `online` — a Machine of the platform runs `text`'s build; `not-connected` — none is online; `old` — the window's Machine says no platform. */
  state: 'online' | 'not-connected' | 'old'
  text: string
  /** The Machine the line names; null when none. */
  machineId: string | null
}

const LABELS: Record<OwnerCheckPlatform, string> = { windows: 'PC', mac: 'Mac', linux: 'Linux machine' }

const isPlatform = (value: string): value is OwnerCheckPlatform => Object.hasOwn(LABELS, value)

/** How the line names a Machine of `platform`: PC, Mac or Linux machine. */
export function platformLabel(platform: OwnerCheckPlatform): string {
  return LABELS[platform]
}

/** The commit of a build version `<semver>+<SHA>`; null for a `.dirty` build (it is not its commit) or another text. */
export function buildCommit(build: string): string | null {
  return /^\d+\.\d+\.\d+\+([0-9a-f]{7,40})$/.exec(build)?.[1] ?? null
}

/**
 * The online Machine of `platform` the view means: the window's Machine when it is of that platform, else the first
 * online one of the list that is. undefined when none is.
 */
function machineOf(platform: OwnerCheckPlatform, windowMachine: string | null, machines: readonly BuildMachine[]): BuildMachine | undefined {
  const online = machines.filter((machine) => machine.online && machine.platform === platform && machine.build !== undefined)
  return online.find((machine) => machine.id === windowMachine) ?? online[0]
}

/**
 * The line of an item whose `needs:` names `needsPlatform`, in a window of `windowMachine` (null — this Machine, whose
 * platform is `here`). null when the item is checked on this Machine itself (its Stable copy line says enough) or the
 * platform is not one the owner-check line knows.
 */
export function linkedBuildLine(needsPlatform: string, here: OwnerCheckPlatform, windowMachine: string | null, machines: readonly BuildMachine[]): LinkedBuildLine | null {
  if (!isPlatform(needsPlatform)) return null
  const shown = machines.find((machine) => machine.id === windowMachine)
  if (needsPlatform === here && shown?.platform !== needsPlatform) return null
  const machine = machineOf(needsPlatform, windowMachine, machines)
  if (machine !== undefined) return { state: 'online', text: `${platformLabel(needsPlatform)} build: ${machine.build} (${machine.name})`, machineId: machine.id }
  // A worfy before ticket 07: its `hello` came (the build is known) without a platform. Only the window's Machine could be
  // the one meant — its queue holds the item; any other such Machine may as well be a Mac, and a Machine whose `hello`
  // has not come yet says nothing.
  const old = shown !== undefined && shown.online && shown.build !== undefined && shown.platform === undefined ? shown : undefined
  if (old !== undefined) return { state: 'old', text: `Update worfy on ${old.name}: it does not say its platform`, machineId: old.id }
  return { state: 'not-connected', text: `${platformLabel(needsPlatform)} not connected`, machineId: null }
}

/**
 * The build a decision checked on `platform` names, and its commit: the build of the online Linked machine of that
 * platform — the window's Machine first. null when the platform is this Machine's own (`here`) and the window is not on
 * a Linked machine of it, or no online Linked machine is of it; `sha` is `-` for a build without its commit.
 */
export function linkedCommit(platform: OwnerCheckPlatform, here: OwnerCheckPlatform, windowMachine: string | null, machines: readonly BuildMachine[]): { sha: string; build: string } | null {
  const shown = machines.find((machine) => machine.id === windowMachine)
  if (platform === here && shown?.platform !== platform) return null
  const machine = machineOf(platform, windowMachine, machines)
  if (machine?.build === undefined) return null
  return { sha: buildCommit(machine.build) ?? '-', build: machine.build }
}

/** What a Linked machine answers for a channel its worfy does not have (src/main/link/ipc-adapter.ts, notOpenRefusal). */
const notOpen = (channel: string): string => `${channel}: not open to Linked machines`

const OLDER: Record<string, string> = {
  'acceptance.get': 'its worfy has no Acceptance view yet',
  'actions.ownerCheck': 'its worfy cannot record an owner check yet',
}

/**
 * What the view says when the Linked machine `machineName` answered `channel` with `error` because its worfy is older
 * than the channel: "Update worfy on <name>: …". null for any other answer.
 */
export function olderWorfyText(channel: string, error: string, machineName: string): string | null {
  const why = OLDER[channel]
  if (why === undefined || !error.endsWith(notOpen(channel))) return null
  return `Update worfy on ${machineName}: ${why}`
}

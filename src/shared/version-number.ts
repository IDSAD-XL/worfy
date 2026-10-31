// The app version as the user sees it (worfy-update ticket 14): `<major>.<minor>.<N>`, where N is
// the build number, the count of commits from the start of the history to the built commit
// (scripts/build-version.ts, buildNumber). It grows with every commit of `main`, so a newer build
// reads as a bigger number; the build version `<semver>+<short SHA>[.dirty]` stays what the build
// writes and what Update, the Harness lag and Link parse. Only the screen changes: without a number
// (a shallow clone, no git, a version the user never built) the build version is shown as before.

/** A build version with its number, when the number is known. */
export interface NumberedBuild {
  version: string
  number?: number | undefined
}

const BUILD = /^(\d+)\.(\d+)\.\d+\+[0-9a-f]{7,}(\.dirty)?$/u

/**
 * `<major>.<minor>.<number>` for a build version, with `.dirty` kept at the end: such a build has
 * uncommitted changes and does not match its commit. The build version itself when there is no
 * number, or the version is not a build version.
 */
export function numberedVersion(version: string, number: number | null | undefined): string {
  const match = BUILD.exec(version)
  if (match === null || number === null || number === undefined || !Number.isSafeInteger(number) || number < 1) return version
  return `${match[1]}.${match[2]}.${number}${match[3] ?? ''}`
}

/** Whether a build version carries `.dirty`. */
export function isDirtyBuild(version: string): boolean {
  return BUILD.exec(version)?.[3] !== undefined
}

/**
 * The tooltip of a numbered version: the full build version with its commit. undefined when the
 * version shows unnumbered, so the screen stays as it was without a number.
 */
export function buildVersionTooltip(version: string, number: number | null | undefined): string | undefined {
  if (numberedVersion(version, number) === version) return undefined
  return isDirtyBuild(version) ? `worfy ${version}: built with uncommitted changes, not the same as its commit` : `worfy ${version}`
}

/** The number of `version` among the builds whose number is known; undefined when none has it. */
export function numberOf(version: string, known: ReadonlyArray<NumberedBuild | null | undefined>): number | undefined {
  return known.find((build) => build?.version === version && build.number !== undefined)?.number
}

/** `version` as the screen shows it, numbered when one of `known` gives its number. */
export function versionLabel(version: string, known: ReadonlyArray<NumberedBuild | null | undefined>): string {
  return numberedVersion(version, numberOf(version, known))
}

/** The parts of an Update snapshot whose builds may carry a number. */
export interface UpdateBuilds {
  current?: NumberedBuild | undefined
  running: NumberedBuild | null
  previous: NumberedBuild | null
  available: (NumberedBuild & { sha: string }) | null
  build: { version?: string | undefined; sha?: string | undefined }
}

/**
 * The builds of an Update snapshot with a known number: this run, the copy the last check saw run,
 * the previous copy (its number as restart.json kept it, src/main/update/restart.ts), the Available
 * update (the running number plus GitHub's `ahead_by`, src/main/update/check.ts) and the build of
 * that same commit in worfy's clone.
 */
export function numberedBuilds({ current, running, previous, available, build }: UpdateBuilds): NumberedBuild[] {
  const builds: NumberedBuild[] = []
  if (current !== undefined) builds.push(current)
  if (running !== null) builds.push(running)
  if (previous !== null) builds.push(previous)
  if (available !== null) {
    builds.push(available)
    if (build.version !== undefined && build.sha !== undefined && build.sha === available.sha) builds.push({ version: build.version, number: available.number })
  }
  return builds
}

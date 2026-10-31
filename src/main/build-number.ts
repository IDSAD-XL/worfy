// The build number of this build (worfy-update ticket 14): the commits from the start of the history
// to the built commit, counted by the build (scripts/build-version.ts, buildNumber) and written into
// the bundle of main as __WORFY_BUILD_NUMBER__ (electron.vite.config.ts, `define`). The screen shows
// it as `v<major>.<minor>.<N>` (src/shared/version-number.ts); the build version stays as it is.

// Replaced by the build: a number, or null for a build without one (a shallow clone, no git). Not
// defined at all where main runs unbuilt (unit tests).
declare const __WORFY_BUILD_NUMBER__: number | null | undefined

/** The build number, or undefined for a build without one and outside a build. */
export function appBuildNumber(): number | undefined {
  const number = typeof __WORFY_BUILD_NUMBER__ === 'number' ? __WORFY_BUILD_NUMBER__ : undefined
  return number !== undefined && Number.isSafeInteger(number) && number > 0 ? number : undefined
}

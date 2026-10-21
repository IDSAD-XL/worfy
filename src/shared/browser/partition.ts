// The partitions of the Browsers' pages (ADR-0078 items 3 and 5), shared by main, which lets a
// <webview> attach only on the partition of a Browser profile of a Project of this Machine and
// denies its pages every permission (src/main/window.ts, src/main/browser/profiles.ts), and the
// Browser layer, which puts the partition of each Browser's profile on its <webview>
// (src/renderer/canvas/overlays/BrowserLayer.tsx).

/**
 * The hash that ends every Project id (`<folder name>-<sha256(path)[0:8]>`, projectId in
 * src/main/projects/store.ts). Unlike the folder name it is lowercase ASCII, so it fits a partition
 * name, which Electron turns into a folder under userData/Partitions.
 */
const PROJECT_HASH = /-([0-9a-f]{8})$/

/**
 * The id of the first Browser profile of a Project. The Browsers opened before Browser profiles
 * existed (worfy-browser ticket 10) were on the partition `…-default`, so the logins made there
 * stay with this profile.
 */
export const DEFAULT_BROWSER_PROFILE = 'default'

/**
 * A Browser profile id: lowercase ASCII letters, digits and single dashes, at most 40 characters.
 * Electron makes a folder of the partition name, so the id has no separators, dots or spaces.
 */
export const BROWSER_PROFILE_ID = /^(?=.{1,40}$)[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * The partition of the Browsers of Project `projectId` under Browser profile `profileId`, or null
 * when the Project id does not end with the hash or the profile id is not one. It is `persist:`:
 * cookies, logins and site storage are kept on disk, in Electron's userData (the worfy data folder,
 * WORFY_DATA_DIR), and survive a restart. One per Browser profile, shared by all its Browsers
 * (ADR-0078 item 5); named by the profile's id, never by its name, so a renamed profile keeps them.
 */
export function browserPartition(projectId: string, profileId: string = DEFAULT_BROWSER_PROFILE): string | null {
  const hash = PROJECT_HASH.exec(projectId)?.[1]
  if (hash === undefined || !BROWSER_PROFILE_ID.test(profileId)) return null
  return `persist:worfy-browser-${hash}-${profileId}`
}

/**
 * The partitions a <webview> may attach on: those of the Browser profiles `profileIdsOf` names for
 * each of the Projects `projectIds`, once each. Without `profileIdsOf`, each Project's `default`.
 */
export function browserPartitions(projectIds: readonly string[], profileIdsOf: (projectId: string) => readonly string[] = () => [DEFAULT_BROWSER_PROFILE]): string[] {
  const partitions = new Set<string>()
  for (const id of projectIds) {
    for (const profileId of profileIdsOf(id)) {
      const partition = browserPartition(id, profileId)
      if (partition !== null) partitions.add(partition)
    }
  }
  return [...partitions]
}

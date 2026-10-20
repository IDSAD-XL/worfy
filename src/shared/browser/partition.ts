// The partitions of the Browsers' pages (ADR-0078 item 3), shared by main, which lets a <webview>
// attach only on the partition of a Project of this Machine and denies its pages every permission
// (src/main/window.ts), and the Browser layer, which puts the partition of the Canvas's Project on
// every <webview> (src/renderer/canvas/overlays/BrowserLayer.tsx).

/**
 * The hash that ends every Project id (`<folder name>-<sha256(path)[0:8]>`, projectId in
 * src/main/projects/store.ts). Unlike the folder name it is lowercase ASCII, so it fits a partition
 * name, which Electron turns into a folder under userData/Partitions.
 */
const PROJECT_HASH = /-([0-9a-f]{8})$/

/**
 * The partition of the Browsers of Project `projectId`, or null when the id does not end with the
 * hash. It is `persist:`: cookies, logins and site storage are kept on disk, in Electron's userData
 * (the worfy data folder, WORFY_DATA_DIR), and survive a restart. One per Project, shared by all
 * its Browsers. Until Browser profiles exist (worfy-browser ticket 03) it is the Project's one
 * "default" profile; ticket 03 names a profile's partition the same way, with the profile's id in
 * place of `default`, so the logins made here stay with the first profile.
 */
export function browserPartition(projectId: string): string | null {
  const hash = PROJECT_HASH.exec(projectId)?.[1]
  return hash === undefined ? null : `persist:worfy-browser-${hash}-default`
}

/** The partitions a <webview> may attach on: those of the Projects `projectIds`, once each. */
export function browserPartitions(projectIds: readonly string[]): string[] {
  const partitions = new Set<string>()
  for (const id of projectIds) {
    const partition = browserPartition(id)
    if (partition !== null) partitions.add(partition)
  }
  return [...partitions]
}

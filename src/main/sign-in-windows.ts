/**
 * The OAuth sign-in windows of Integrations (src/main/integrations/auth/oauth.ts, worfy-integrations ticket 05): a
 * service's page on a partition of its own, not a worfy window. Their navigation is let through (window.ts), and the
 * checks for an open app window — the Dock icon, a second start, a notification's click — pass them by.
 */

/** The web contents of the open sign-in windows. */
const signInContents = new WeakSet<object>()

/** Marks `contents` as the web contents of an Integration's sign-in window. */
export function markSignInWindow(contents: object): void {
  signInContents.add(contents)
}

/** Whether `contents` are a sign-in window's. */
export function isSignInContents(contents: object): boolean {
  return signInContents.has(contents)
}

/** The windows among `windows` that are worfy's own: all but the sign-in windows. */
export function appWindows<W extends { webContents: object }>(windows: readonly W[]): W[] {
  return windows.filter((each) => !isSignInContents(each.webContents))
}

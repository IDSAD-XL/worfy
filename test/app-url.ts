// The renderer location of the tests that pass the frame check (worfy-windows ticket 14). The app
// trusts a frame whose URL is pathToFileURL(<index.html>).href (appUrlMatcher in
// src/main/ipc/index.ts). On Windows that URL holds the drive of the working directory:
// file:///C:/Applications/…, not file:///Applications/…. A test that wrote the URL by hand, as
// `file://${path}`, did not get past the check there: "call rejected, it came from an untrusted
// frame". So a test takes the path and the URL from here, and the URL is built as the app builds it.
//
// It lies in test/, not in test/unit or test/contract: both import it.
import { pathToFileURL } from 'node:url'

/** The path of the bundled index.html, as a test gives it to the code (appUrlMatcher, rendererEntry). */
export const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

/**
 * The URL of the frame that loaded INDEX_HTML. On macOS and Linux it is
 * file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html.
 */
export const APP_URL = pathToFileURL(INDEX_HTML).href

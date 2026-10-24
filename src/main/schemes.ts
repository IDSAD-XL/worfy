// The app's own URL schemes and their privileges: worfy-card:// for Cards (src/main/cards/protocol.ts)
// and worfy-image:// for the images worfy keeps (src/main/images/protocol.ts). Electron takes the
// privileged schemes in one call, before the app is ready: a second call of
// registerSchemesAsPrivileged replaces the list of the first, so every scheme is named here.
import { protocol } from 'electron'
import { CARD_SCHEME_PRIVILEGES } from './cards/protocol'
import { IMAGE_SCHEME_PRIVILEGES } from './images/protocol'

/** Must run before the app is ready: a scheme gets its privileges only then. */
export function registerAppSchemes(): void {
  protocol.registerSchemesAsPrivileged([CARD_SCHEME_PRIVILEGES, IMAGE_SCHEME_PRIVILEGES])
}

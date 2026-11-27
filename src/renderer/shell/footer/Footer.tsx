import { VersionChip } from './VersionChip'

// The footer (worfy-layout ticket 03; spec, «Footer»; owner's decision Q7): a strip of --footer-height
// (theme/tokens.css, 28 px) across the whole window under the sidebar and the main area. The View buttons
// of the Footer zone go on its left (ticket 04), its middle stays empty, and the version chip with its
// popover stands on its right (VersionChip.tsx); an empty footer shows the chip alone.
// It is no area to drag the window by (no -webkit-app-region), and the toasts keep clear of it
// (`data-toast-keep-out`, toast/ToastRegion.tsx), so a toast at the right edge never covers the chip.
// Focus mode draws its layer inside the main area (AppShell.tsx): the footer lies outside that layer,
// stays on screen, and the chip keeps working.

export function Footer() {
  return (
    <footer className="w-footer" aria-label="Footer" data-toast-keep-out="" data-testid="footer">
      <div className="w-footer__buttons" />
      <div className="w-footer__spacer" />
      <VersionChip />
    </footer>
  )
}

// "Link a machine" and Tailscale on a built worfy (worfy-link ticket 29; ADR-0070, point 5): the
// window marks this Machine's Tailscale addresses, lists them first while "Link through Tailscale"
// is on, and says under the address field where the port comes from and that a MagicDNS name goes
// there. The machine's interfaces are given by WORFY_LINK_INTERFACES: the run needs no tailnet, and
// the server still listens on 127.0.0.1 only (launchApp).
import { expect, test, type Page } from '@playwright/test'
import { launchApp, openLinkDialog, shownCode } from './helpers'
import { snapshotThemes } from './snapshots'

test.setTimeout(120_000)

const INTERFACES = { en0: ['192.168.1.20'], utun4: ['100.101.102.103', 'fd7a:115c:a1e0::1'] }

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

/** Switches "Link through Tailscale" through the window's own main, as Settings → Machines does. */
async function setTailscale(window: Page, tailscale: boolean): Promise<void> {
  const result = await window.evaluate((input) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke('link.setTailscale', input), { tailscale })
  if (!result.ok) throw new Error(`link.setTailscale: ${result.error ?? 'failed'}`)
}

/** The own addresses "Link a machine" shows, each with whether it carries the Tailscale mark. */
const shownAddresses = (window: Page): Promise<string[]> =>
  window
    .getByTestId('link-own-address-entry')
    .evaluateAll((entries) =>
      entries.map((entry) => {
        const element = entry as unknown as { querySelector(selector: string): { textContent: string | null } | null }
        return `${element.querySelector('[data-testid="link-own-address"]')?.textContent ?? ''}${element.querySelector('[data-testid="link-tailscale-mark"]') === null ? '' : ' Tailscale'}`
      }),
    )

test('"Link a machine" marks the Tailscale address, lists it first with "Link through Tailscale" on, and tells where the port comes from', async () => {
  const launched = await launchApp({ env: { WORFY_LINK_INTERFACES: JSON.stringify(INTERFACES) } })
  try {
    const { window } = launched
    await openLinkDialog(window)
    await shownCode(window)
    const first = (await window.getByTestId('link-own-address').first().textContent()) ?? ''
    const port = /:(\d+)$/.exec(first)?.[1] ?? ''
    expect(port).toMatch(/^\d+$/)

    // Off (a fresh Machine): the interfaces' order, the Tailscale addresses marked all the same.
    await expect.poll(() => shownAddresses(window)).toEqual([`192.168.1.20:${port}`, `100.101.102.103:${port} Tailscale`, `[fd7a:115c:a1e0::1]:${port} Tailscale`])
    await expect(window.getByTestId('link-tailscale-mark').first()).toBeVisible()
    await expect(window.getByTestId('link-address-hint')).toHaveText('The address and its port are under the code in Link a machine on the other worfy.')

    await setTailscale(window, true)
    await expect.poll(() => shownAddresses(window)).toEqual([`100.101.102.103:${port} Tailscale`, `[fd7a:115c:a1e0::1]:${port} Tailscale`, `192.168.1.20:${port}`])
    await expect(window.getByTestId('link-address-hint')).toHaveText(
      'The address and its port are under the code in Link a machine on the other worfy. Through Tailscale, type its MagicDNS name or Tailscale address with that port, like pc:52000.',
    )
    await window.getByTestId('link-address-input').fill(`pc:${port}`)
    await snapshotThemes(window, '29-link-a-machine-tailscale')

    // A MagicDNS name with the port goes on to the code, as an address does.
    await window.getByRole('button', { name: 'Next' }).click()
    await expect(window.getByRole('heading', { name: `Link with pc:${port}` })).toBeVisible()
    await expect(window.getByTestId('link-code-input')).toBeVisible()
    await window.getByRole('button', { name: 'Back' }).click()

    await setTailscale(window, false)
    await expect.poll(() => shownAddresses(window)).toEqual([`192.168.1.20:${port}`, `100.101.102.103:${port} Tailscale`, `[fd7a:115c:a1e0::1]:${port} Tailscale`])
    await snapshotThemes(window, '29-link-a-machine-tailscale-off')
  } finally {
    await launched.close()
  }
})

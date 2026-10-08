// The Machine (ADR-0052, point 1): this worfy as the link sees it — an id, a name and a key with a
// self-signed certificate. A Machine belongs to a data folder, not to a computer: the dev build, the
// stable copy and every e2e run have folders of their own and so are different Machines, even on
// one Mac. Made on the first start over a folder and kept: link/machine.json holds the id, the
// name, the certificate (public) and the port the server last listened on; the private key lives
// in the secret store (secrets.ts).
//
// The certificate is made by `selfsigned` (pure JS over WebCrypto, no `openssl` binary, so the same
// code runs on Windows) with an ECDSA P-256 key: TLS 1.3 in Electron's BoringSSL accepts it, which
// test/contract/link-server.test.ts shows by connecting through it.
import { randomUUID, createPrivateKey, X509Certificate } from 'node:crypto'
import { join } from 'node:path'
import { generate } from 'selfsigned'
import { z } from 'zod'
import type { BuildKind } from '../storage/paths'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import type { SecretStore } from './secrets'

/** The secret-store key of this Machine's private key (PEM, PKCS#8). */
export const MACHINE_KEY = 'machine-key'

const machineFileSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  name: z.string().min(1),
  certificate: z.string().min(1),
  port: z.number().int().min(1).max(65535).nullable(),
})

export interface MachineIdentity {
  id: string
  name: string
  /** PEM of the self-signed certificate. */
  certificate: string
  /** SHA-256 of the certificate, as Node prints it (`AB:CD:…`). */
  fingerprint: string
  /** The port the server last listened on; null before the first listen. */
  port: number | null
}

export const machineFile = (linkDir: string): string => join(linkDir, 'machine.json')

/** SHA-256 fingerprint of a PEM certificate, in the form TLSSocket.getPeerCertificate() gives. */
export function fingerprintOf(certificate: string): string {
  return new X509Certificate(certificate).fingerprint256
}

/**
 * The Machine's name: the computer's name without its domain (`Alexeys-MacBook-Pro.local` →
 * `Alexeys-MacBook-Pro`); a dev run adds ` (dev)`, or the dev build and the stable copy on one Mac
 * would show up under one name.
 */
export function machineName(hostname: string, buildKind: BuildKind): string {
  const base = hostname.trim().split('.')[0] || 'worfy'
  return buildKind === 'dev' ? `${base} (dev)` : base
}

/** A fresh ECDSA P-256 key and a self-signed certificate for it, valid for 20 years. */
export async function generateCertificate(machineId: string): Promise<{ key: string; certificate: string }> {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const pems = await generate([{ name: 'commonName', value: `worfy machine ${machineId}` }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    // A day back, so a Linked machine whose clock runs behind still takes the certificate as valid.
    notBeforeDate: new Date(now - day),
    notAfterDate: new Date(now + 20 * 365 * day),
  } as Parameters<typeof generate>[1])
  return { key: pems.private, certificate: pems.cert }
}

function keyMatches(key: string | undefined, certificate: string): boolean {
  if (key === undefined) return false
  try {
    return new X509Certificate(certificate).checkPrivateKey(createPrivateKey(key))
  } catch {
    return false
  }
}

export interface LoadIdentityOptions {
  /** <data folder>/link */
  linkDir: string
  secrets: SecretStore
  hostname: string
  buildKind: BuildKind
  /** Warnings for the worfy log; never carries a secret. */
  warn: (message: string) => void
}

/**
 * This Machine over the data folder: read from link/machine.json, made on the first start. A
 * key that is missing or does not fit the certificate gets a new key and certificate under the
 * same id; the Linked machines then see "certificate changed" and link again.
 */
export async function loadIdentity({ linkDir, secrets, hostname, buildKind, warn }: LoadIdentityOptions): Promise<MachineIdentity> {
  const file = machineFile(linkDir)
  const stored = readJsonFile(file, machineFileSchema)
  if (stored !== undefined && keyMatches(secrets.get(MACHINE_KEY), stored.certificate)) {
    return { id: stored.id, name: stored.name, certificate: stored.certificate, fingerprint: fingerprintOf(stored.certificate), port: stored.port }
  }
  if (stored !== undefined) warn(`[link] the key of Machine ${stored.id} (${stored.name}) is missing or does not fit its certificate; a new certificate is made`)

  const id = stored?.id ?? randomUUID()
  const name = stored?.name ?? machineName(hostname, buildKind)
  const { key, certificate } = await generateCertificate(id)
  // The key first: a machine.json whose key is missing would be replaced on the next start anyway.
  secrets.set(MACHINE_KEY, key)
  const identity: MachineIdentity = { id, name, certificate, fingerprint: fingerprintOf(certificate), port: stored?.port ?? null }
  saveIdentity(linkDir, identity)
  return identity
}

/** Writes link/machine.json (the port changes when the stored one was taken). */
export function saveIdentity(linkDir: string, identity: MachineIdentity): void {
  writeJsonFile(machineFile(linkDir), machineFileSchema, {
    version: 1,
    id: identity.id,
    name: identity.name,
    certificate: identity.certificate,
    port: identity.port,
  })
}

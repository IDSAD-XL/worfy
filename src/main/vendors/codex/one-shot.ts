// The oneShot part of the Codex driver (ADR-0094 item 2): the first release runs one-off requests on
// Claude Code only (spec of worfy-multi-vendor, "Decided without the owner", item 6), so Codex
// answers each with an error.
import { PartNotWired } from '../driver'
import type { OneShot } from '../one-shot'

export const codexOneShot: OneShot = () => Promise.reject(new PartNotWired('codex', 'oneShot', 'not in the first release of worfy-multi-vendor'))

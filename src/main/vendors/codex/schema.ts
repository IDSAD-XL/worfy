// The checker of Codex app-server messages against the JSON Schema of the pinned version
// (src/main/vendors/codex/protocol/json/, made by scripts/codex-protocol.mjs; worfy-multi-vendor
// ticket 17). The app-server client (ticket 19), the fake app-server (ticket 18) and the compatibility
// suite (ticket 30) check messages with an instance of this.
import { Ajv } from 'ajv'

/** The bundle with every message of the protocol, v1 and v2, under `definitions`. */
export const CODEX_SCHEMA_BUNDLE = 'codex_app_server_protocol.schemas.json'

/** A whole number, at least `min` and at most `max`. */
const integer = (min: number, max: number) => (value: number) => Number.isInteger(value) && value >= min && value <= max

/**
 * The number formats of the Codex schemas (the Rust types they come from). Strict ajv refuses a schema
 * with a format it does not know. A 64-bit number past 2^53 loses its precision in JavaScript anyway:
 * the 64-bit formats check only that the number is whole and, unsigned, not negative.
 */
const NUMBER_FORMATS: Readonly<Record<string, (value: number) => boolean>> = {
  int32: integer(-(2 ** 31), 2 ** 31 - 1),
  int64: integer(-Infinity, Infinity),
  uint: integer(0, Infinity),
  uint16: integer(0, 2 ** 16 - 1),
  uint32: integer(0, 2 ** 32 - 1),
  uint64: integer(0, Infinity),
  double: (value) => Number.isFinite(value),
}

/** A strict ajv with every error of a message and the number formats of the Codex schemas. */
export function codexAjv(): Ajv {
  const ajv = new Ajv({ strict: true, strictTypes: false, allowUnionTypes: true, allErrors: true })
  for (const [name, validate] of Object.entries(NUMBER_FORMATS)) ajv.addFormat(name, { type: 'number', validate })
  return ajv
}

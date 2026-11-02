// The oneShot part of a Vendor driver (ADR-0094 item 2): a single request that is not a Session —
// the draft of a Project profile, with read-only tools and a structured answer, or a request without
// tools.

export interface OneShotOptions {
  /** The folder the request runs in. */
  cwd: string
  /** The tools the request may use, all of them read-only; none when absent. */
  readOnlyTools?: readonly string[] | undefined
  /** The JSON Schema of a structured answer; a text answer when absent. */
  outputSchema?: Readonly<Record<string, unknown>> | undefined
  /** Stops the request. */
  signal?: AbortSignal | undefined
}

export interface OneShotAnswer {
  text: string
  /** The answer in the shape of `outputSchema`; undefined without one. */
  structured?: unknown
}

export type OneShot = (prompt: string, opts: OneShotOptions) => Promise<OneShotAnswer>

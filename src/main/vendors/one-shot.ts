// The oneShot part of a Vendor driver (ADR-0094 item 2): a single request that is not a Session —
// the draft of a Project profile, with read-only tools and a structured answer, or a request without
// tools.

export interface OneShotOptions {
  /** The folder the request runs in. */
  cwd: string
  /**
   * Folders the read-only tools may read besides `cwd` (a Code story: the Project's checkout, while the
   * request itself runs outside every Project); none when absent.
   */
  readFolders?: readonly string[] | undefined
  /**
   * The Vendor keeps no transcript of the request: for a request whose text (a diff, a PR, review verdicts)
   * must not stay on disk after the answer. False or absent: as the Vendor does by default.
   */
  ephemeral?: boolean | undefined
  /** The tools the request may use, all of them read-only; none when absent. */
  readOnlyTools?: readonly string[] | undefined
  /** The JSON Schema of a structured answer; a text answer when absent. */
  outputSchema?: Readonly<Record<string, unknown>> | undefined
  /** Told each line of what the request is doing, while it runs (the draft's progress). */
  onActivity?: ((text: string) => void) | undefined
  /** Stops the request. */
  signal?: AbortSignal | undefined
}

export interface OneShotAnswer {
  text: string
  /** The answer in the shape of `outputSchema`; undefined without one. */
  structured?: unknown
}

export type OneShot = (prompt: string, opts: OneShotOptions) => Promise<OneShotAnswer>

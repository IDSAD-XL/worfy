// The oneShot part of a Vendor driver (ADR-0094 item 2): a single request that is not a Session —
// the draft of a Project profile or a Code story, with read-only tools and a structured answer, or a
// request without tools. A request that names `readFolders` reads only inside them and its cwd.

export interface OneShotOptions {
  /** The folder the request runs in. */
  cwd: string
  /**
   * Folders the read-only tools may read besides `cwd` (a Code story: the Project's checkout, while the
   * request itself runs outside every Project); none when absent. When given, a read outside them and
   * `cwd` is refused.
   */
  readFolders?: readonly string[] | undefined
  /**
   * The request loads worfy's Harness (its skills and hooks) as a Session does: the profile draft, which
   * runs /worfy:connect-project. Absent or false: every request runs without them — worfy's copy is not
   * passed and the copy the user installed is turned off for the request (the Claude driver,
   * src/main/vendors/claude/one-shot.ts) — the Code story and any other caller that does not ask.
   */
  harness?: boolean | undefined
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

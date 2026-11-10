// Types of verdict.mjs: the verdict of a reviewer's answer. See that file for the rule.

export interface FoundVerdict {
  verdict: 'VERIFIED' | 'REJECTED'
  /** The verdict line starts with `NARROW:`: the narrow round's verdict. */
  narrow: boolean
  /** The answer from the verdict line on, the lead-in before it dropped. */
  text: string
  /** The verdict line itself, without its line end. */
  line: string
}

export declare function findVerdict(answer: string | null | undefined): FoundVerdict | null

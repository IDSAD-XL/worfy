// Types of verdict.mjs: the verdict of a reviewer's answer. See that file for the rule.

export interface FoundVerdict {
  verdict: 'VERIFIED' | 'REJECTED'
  /** The verdict line has `NARROW:` before the word: the narrow round's verdict. */
  narrow: boolean
  /** The verdict line and the rest of the answer after it: the lead-in before it and the markup in front of the word dropped. */
  text: string
  /** The verdict line from the word on, its markup dropped, without its line end. */
  line: string
}

export declare function findVerdict(answer: string | null | undefined): FoundVerdict | null

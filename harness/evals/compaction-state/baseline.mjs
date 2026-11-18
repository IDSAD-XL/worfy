#!/usr/bin/env node
// node harness/evals/compaction-state/baseline.mjs — makes the variant of the case compaction-state without
// the hook and without the instructions of compaction: a copy of harness/ in a new temporary folder, in which
//   - hooks/hooks.json has no PreCompact hook (inject-rules.mjs compaction: the summary instructions of
//     hooks/rules/compaction.md) and no SessionStart hook with the matcher "compact" (after-compact.mjs);
//   - hooks/rules/common.md has no item "After a compaction …" (re-read the ticket and git status).
// Everything else stays as it is: the rules of every session, the skills, the agents, the case itself.
// Prints the path of the copy; the run of the variant is
//   HARNESS_DIR=<that path> node scripts/eval-harness.mjs --case compaction-state …
// and its results go to <that path>/evals/results/. The copy is not removed: remove it after the run.
//
// Exit 1, with the reason on stderr and the copy removed, when one of the three parts is not where this
// script looks for it: a Harness that moved them would give a "baseline" that still has them.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RESULTS = join(HARNESS, 'evals', 'results')
// The item of common.md that the variant drops: from its first words to the line before the next item.
const FALLBACK = /^- After a compaction \(the conversation replaced by its summary\)[^\n]*\n(?: {2}[^\n]*\n)*/m

const copy = join(mkdtempSync(join(tmpdir(), 'compaction-state-baseline-')), 'harness')
const fail = (message) => {
  rmSync(dirname(copy), { recursive: true, force: true })
  process.stderr.write(`baseline: ${message}\n`)
  process.exit(1)
}

// The reports of earlier runs stay out of the copy: they are not the Harness.
cpSync(HARNESS, copy, { recursive: true, filter: (source) => source !== RESULTS && !source.startsWith(RESULTS + sep) })

const hooksFile = join(copy, 'hooks', 'hooks.json')
const hooks = JSON.parse(readFileSync(hooksFile, 'utf8'))
if (!Array.isArray(hooks.hooks?.PreCompact)) fail(`${relative(copy, hooksFile)} has no PreCompact hook`)
delete hooks.hooks.PreCompact
const starts = hooks.hooks.SessionStart ?? []
const kept = starts.filter((entry) => entry?.matcher !== 'compact')
if (kept.length !== starts.length - 1) fail(`${relative(copy, hooksFile)} has ${starts.length - kept.length} SessionStart hooks with the matcher compact, not one`)
hooks.hooks.SessionStart = kept
writeFileSync(hooksFile, `${JSON.stringify(hooks, null, 2)}\n`)

const commonFile = join(copy, 'hooks', 'rules', 'common.md')
const common = readFileSync(commonFile, 'utf8')
if (!FALLBACK.test(common)) fail(`${relative(copy, commonFile)} has no item "After a compaction"`)
writeFileSync(commonFile, common.replace(FALLBACK, ''))

process.stdout.write(`${copy}\n`)

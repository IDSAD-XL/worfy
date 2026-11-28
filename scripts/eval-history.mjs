// The record of a full run of `pnpm eval:harness` (scripts/eval-harness.mjs; epic worfy-harness-eval,
// ticket 03): one JSON file and one short Markdown summary per run in evals-history/ at the root of the
// repository of the Harness under test. The record keeps what the run measured — the date, the commit
// of the Harness, the Claude Code version, the agent and judge models, and for each case k passed runs
// of n, the mean score, the 95 % Wilson interval of k of n and the cost — so that the next run has
// something to be compared with. The summary names the cases whose k of n fell against the latest
// earlier record of the same two models; a record of other models (one from before the baseline run of
// ticket 05, say) is never compared.
// Pure functions over the aggregate-result.json reports, plus the read and the write of the folder.
// Kept out of eval-harness.mjs, which starts a run as soon as it is imported.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wilson } from './eval-outcome-stats.mjs'

/** The version of the record's shape; a record of another version is not read as an earlier one. */
export const HISTORY_SCHEMA = 1
/** The folder of the records, at the root of the repository of the Harness under test. */
export const HISTORY_FOLDER = 'evals-history'

const sum = (values) => values.filter((value) => typeof value === 'number').reduce((total, value) => total + value, 0)
const object = (value) => (typeof value === 'object' && value !== null ? value : {})

/**
 * The rows of the cases a call chose, from its aggregate-result.json: k passed runs of n, the mean
 * score of the report, the Wilson interval of k of n and the cost of the runs. A chosen case the
 * report does not hold has no row (the run is partial then); a case the call did not choose is left out.
 */
export function caseRows(report, tag, chosen) {
  const cases = Array.isArray(report?.cases) ? report.cases : []
  const rows = []
  for (const name of chosen) {
    const entry = cases.find((one) => one?.name === name)
    if (!entry) continue
    // `--ablation none`: every run is in the arm `with`.
    const runs = Array.isArray(entry.arms?.with) ? entry.arms.with.map(object) : []
    const n = runs.length
    const k = runs.filter((run) => run.passed === true).length
    const { low, high } = wilson(k, n)
    const score = object(entry.aggregates).score
    rows.push({
      name,
      tag,
      k,
      n,
      score: typeof score === 'number' ? score : null,
      wilson: { low, high },
      costUsd: sum(runs.map((run) => run.costUsd)),
      judgeCostUsd: sum(runs.map((run) => run.judgeCostUsd)),
    })
  }
  return rows
}

/**
 * The record of a full run. `calls`: every call the run planned, `{ tag, cases, report }`, with the
 * parsed aggregate-result.json as `report` (null when the call did not start or wrote none).
 * `fallbackModels`: the pinned models, for a report that does not name its own. The record is
 * partial when a call did not start, wrote no report, or wrote a partial one.
 */
export function historyRecord({ startedAt, commit, harnessDirty, claudeVersion, fallbackModels, threshold, calls }) {
  const reports = calls.map((call) => call.report).filter((report) => typeof report === 'object' && report !== null)
  const suite = object(reports[0]?.suite)
  const cases = calls
    .flatMap((call) => (call.report ? caseRows(call.report, call.tag, call.cases) : []))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return {
    schema: HISTORY_SCHEMA,
    startedAt,
    commit,
    harnessDirty,
    claudeVersion: reports.find((report) => typeof report.claudeVersion === 'string')?.claudeVersion ?? claudeVersion,
    models: {
      agent: typeof suite.modelOverride === 'string' ? suite.modelOverride : fallbackModels.agent,
      judge: typeof suite.judgeModel === 'string' ? suite.judgeModel : fallbackModels.judge,
    },
    threshold,
    partial: calls.some((call) => !call.report || call.report.partial === true),
    costUsd: sum(reports.map((report) => report.costUsd)),
    casesPassed: cases.filter((row) => row.score !== null && row.score >= threshold).length,
    cases,
  }
}

/** The earlier records in `dir`: every `*.json` of the current schema, with its file name. */
export function readHistory(dir) {
  if (!existsSync(dir)) return []
  const records = []
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    try {
      const record = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (record?.schema === HISTORY_SCHEMA && typeof record.startedAt === 'string' && Array.isArray(record.cases)) records.push({ file, record })
    } catch {
      // Not JSON: not a record.
    }
  }
  return records
}

/**
 * The comparison of `record` with the latest earlier record of the same agent and judge models:
 * `with` names its file (null when there is none), `fell` the cases of both whose k of n is lower now.
 */
export function compareWithEarlier(record, earlier) {
  const same = earlier
    .filter(({ record: other }) => other.models?.agent === record.models.agent && other.models?.judge === record.models.judge && other.startedAt < record.startedAt)
    .sort((a, b) => (a.record.startedAt < b.record.startedAt ? -1 : 1))
  const previous = same.at(-1)
  if (!previous) return { with: null, fell: [] }
  const fell = []
  for (const now of record.cases) {
    const before = previous.record.cases.find((one) => one?.name === now.name)
    if (!before || !(before.n > 0) || !(now.n > 0)) continue
    // k/n < kb/nb, without division.
    if (now.k * before.n < before.k * now.n) fell.push({ name: now.name, before: { k: before.k, n: before.n }, now: { k: now.k, n: now.n } })
  }
  return { with: previous.file, fell }
}

const money = (value) => value.toFixed(2)
const share = (value) => (value === null ? '—' : value.toFixed(2))

/** The short summary of a record for a person, in Markdown. */
export function summaryMarkdown(record) {
  const { comparison } = record
  const lines = [
    `# Eval run ${record.startedAt}`,
    '',
    `- Harness commit: ${record.commit ?? 'unknown'}${record.harnessDirty ? ' (with uncommitted changes in harness/)' : ''}`,
    `- Claude Code: ${record.claudeVersion ?? 'unknown'}`,
    `- Models: agent ${record.models.agent}, judge ${record.models.judge}`,
    `- Cases at or above ${record.threshold}: ${record.casesPassed} of ${record.cases.length}`,
    `- Cost: ${money(record.costUsd)} USD`,
    `- Partial: ${record.partial ? 'yes — a call hit the cost ceiling, did not start or wrote no report' : 'no'}`,
    '',
    '| Case | Tag | k of n | Wilson 95 % | Score | Cost USD |',
    '| --- | --- | --- | --- | --- | --- |',
    ...record.cases.map(
      (row) => `| ${row.name} | ${row.tag} | ${row.k} of ${row.n} | ${share(row.wilson.low)}–${share(row.wilson.high)} | ${share(row.score)} | ${money(row.costUsd + row.judgeCostUsd)} |`,
    ),
    '',
    '## Against the earlier record',
    '',
  ]
  if (comparison.with === null) {
    lines.push(
      `No earlier record of agent ${record.models.agent} and judge ${record.models.judge}: nothing to compare. ` +
        'Records of other models, those from before the baseline run among them, are not compared.',
    )
  } else if (comparison.fell.length === 0) {
    lines.push(`Compared with ${comparison.with}: no case has a lower k of n.`)
  } else {
    lines.push(`Compared with ${comparison.with}, k of n fell in ${comparison.fell.length} case(s):`, '')
    for (const { name, before, now } of comparison.fell) lines.push(`- ${name}: ${before.k} of ${before.n} → ${now.k} of ${now.n}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Writes `record`, compared with the earlier records of `dir`, as `<time>-<commit>.json` and `.md`
 * into `dir`; a second record of the same second and commit gets `-2`, `-3`… Returns both paths.
 */
export function writeHistory(dir, record) {
  const compared = { ...record, comparison: compareWithEarlier(record, readHistory(dir)) }
  mkdirSync(dir, { recursive: true })
  const base = `${record.startedAt.slice(0, 19).replace(/:/g, '-')}Z-${(record.commit ?? 'no-commit').slice(0, 12)}`
  let name = base
  for (let i = 2; existsSync(join(dir, `${name}.json`)); i++) name = `${base}-${i}`
  const json = join(dir, `${name}.json`)
  const markdown = join(dir, `${name}.md`)
  writeFileSync(json, `${JSON.stringify(compared, null, 2)}\n`)
  writeFileSync(markdown, summaryMarkdown(compared))
  return { json, markdown, record: compared }
}

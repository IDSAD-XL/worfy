# Code story — worfy-auth-check 03: Модель Health check: статус `unknown`, уровень строки, строки Project-а, сообщения фич о сбоях

Kind: pr · Epic: worfy-auth-check · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

У строки Health check был только статус `ok | warn | fail`: ни уровня (critical или нет), ни Project-а, ни статуса
«проверить не удалось». Фичи сообщали о сбое входа только в log, общего места для «у меня сбой» и «снова работает» не
было. First run при старте открывался на любой новой строке в `fail`, и сетевая строка задержала бы старт.

- Требование: [Что происходит](../issues/03-модель-health-check.md#что-происходит)

## 2. Таблица уровней и худший уровень

Code: `src/shared/health/severity.ts:59-79` · key lines: 60, 63, 75, 77

```ts
export function severityOf(row: { id: CheckId; status: CheckStatus }, facts: SeverityFacts): Severity {
  if (row.status === 'unknown') return 'non-critical'
  if (row.id === 'github-access' && facts.environmentTokenOnly === true) return 'non-critical'
  const level = LEVELS[row.id]
  if (level === 'github') return facts.githubProject ? 'critical' : 'non-critical'
  return level
}

/**
 * The colour of the Health check icon (Q3): `critical` — a critical row is not `ok`; `non-critical` —
 * only non-critical rows are not `ok`; `ok` — every row is; `pending` — no report yet, or "Check
 * again" runs. An `unknown` row never makes it critical, whatever its `severity` says.
 */
export type HealthLevel = 'critical' | 'non-critical' | 'ok' | 'pending'

export function worstLevel(report: { readonly checks: readonly Pick<Check, 'status' | 'severity'>[] } | null, checking = false): HealthLevel {
  if (report === null || checking) return 'pending'
  const open = report.checks.filter((check) => check.status !== 'ok')
  if (open.some((check) => check.status !== 'unknown' && check.severity === 'critical')) return 'critical'
  return open.length > 0 ? 'non-critical' : 'ok'
}
```

- Что делает: `severityOf` берёт уровень строки из одной таблицы `LEVELS` со всеми ids Epic-а; `unknown` всегда
  non-critical; `gh` и `gh-auth` critical только при Project-е с origin на GitHub; GitHub access non-critical, когда
  держится на токене окружения. `worstLevel` даёт цвет иконки: `pending` до первого отчёта и во время «Check again».
- Почему здесь: Ticket называет новый файл `src/shared/health/severity.ts` и требует одну функцию, которую Ticket-ы 05,
  06 и 08 не правят; почему уровень зависит от статуса `unknown` — решение владельца Q2.
- Без него: Ticket 04 красил бы иконку по своему правилу, и строка «нет сети» могла бы стать красной.
- Требование: [Что делаем, п. 2](../issues/03-модель-health-check.md#что-делаем)
- Риски и пробелы test-ов: флаг `environmentTokenOnly` ставит Ticket 05; здесь он проверен только unit test-ом.
  Строка `warn` у critical-строки (например, Harness другой версии) тоже красит иконку в красный — так написано в spec
  («critical не в `ok`»).

## 3. Сообщение фичи о сбое

Code: `src/main/first-run/health-reports.ts:95-105` · key lines: 97, 98, 102

```ts
  reportFailure(id: ReportedCheckId, project: CheckProject | undefined, reason: string, step: string): void {
    const at = this.now()
    this.messages.set(keyOf(id, project), { id, project, reason: redactSecrets(reason), step: redactSecrets(step), at })
    this.changed()
    const recheck = this.rechecks.get(id)
    const budget = budgetOf(project)
    const last = this.lastRecheck.get(budget)
    if (recheck === undefined || (last !== undefined && at - last < RECHECK_AFTER_FAILURE_MS)) return
    this.lastRecheck.set(budget, at)
    void this.recheck(id, project, recheck)
  }
```

- Что делает: запоминает последнее сообщение на пару (id, Project), сразу шлёт изменённый отчёт слушателям без запроса в
  сеть, затем запускает одну повторную проверку строки — не чаще раза в минуту на Project. `reason` и `step` проходят
  через `redactSecrets` и в log не попадают.
- Почему здесь: Ticket называет новый файл `src/main/first-run/health-reports.ts`; повторную проверку регистрирует Ticket
  строки (`registerRecheck`), здесь её нет ни для одной строки.
- Без него: Ticket-ы 07 и 08 не имели бы куда сообщать о сбое, иконка не менялась бы до следующей проверки.
- Требование: [Что делаем, п. 3](../issues/03-модель-health-check.md#что-делаем)
- Риски и пробелы test-ов: повторная проверка, которая отвечает позже следующего сообщения, всё равно заменит его, если
  началась после него; порядок проверен только с часами test-а. Пока проверка строки идёт, вторую не запускает ни
  фокус, ни новое сообщение; строку, которую сделала только повторная проверка, «Check again» не теряет.

## 4. Строка из сообщения не открывает First run

Code: `src/main/first-run/health-reports.ts:252-257` · key lines: 254, 256

```ts
function fromMessage(message: Message, checked: Check | undefined): Check {
  const base = checked ?? { id: message.id, ...REPORTED_ROWS[message.id], command: null, actions: [], ...(message.project === undefined ? {} : { project: message.project }) }
  // A feature that reports a GitHub failure works with GitHub: gh counts as needed.
  const severity = checked !== undefined && checked.status !== 'unknown' ? checked.severity : severityOf({ id: message.id, status: 'fail' }, { githubProject: true })
  return { ...base, status: 'fail', severity, detail: message.reason, hint: message.step, opensFirstRun: false }
}
```

- Что делает: строит строку из сообщения поверх проверенной строки того же id и Project-а (её название и кнопки
  остаются) или из `REPORTED_ROWS`; ставит `fail` и всегда `opensFirstRun: false`.
- Почему здесь: решение владельца Q7 — First run для первой настройки Machine, о поломке позже говорит иконка.
- Без него: сбой PR inbox на старте открыл бы окно First run.
- Требование: [Что делаем, п. 5](../issues/03-модель-health-check.md#что-делаем)
- Риски и пробелы test-ов: уровень строки из сообщения считается с `githubProject: true` — не записано в spec, решено
  здесь: фича, которая сообщает о сбое GitHub, работает с GitHub.

## 5. Решение о старте — только по локальным строкам

Code: `src/main/ipc/first-run.ts:258-268` · key lines: 263, 265, 266

```ts
    // a cause fixed outside worfy does not open the screen. "worfy version" and the Harness behind
    // this build (opensFirstRun: false) do not either: their signal at the start is a toast
    // (worfy-update spec R9). Nor do the rows of a Project and of a feature's message (Q7); the
    // rows checked over the network are not even here: they are added after, and the start does
    // not wait for the network.
    const { local, merged } = await localReport()
    const report = remember(merged)
    const fresh = local.checks.some((check) => opensAtStart(check) && !mark.failing.includes(check.id))
    void health.checkNetwork()
    return { show: fresh, firstTime: false, report }
  }),
```

- Что делает: старт решает по отчёту локальных проверок (`local`), без строк Project-а (`opensAtStart`), а сетевые строки
  запускает после ответа (`void health.checkNetwork()`); renderer получает их событием `firstRun.reportChanged`.
- Почему здесь: Ticket называет `src/main/ipc/first-run.ts` (`:206-216`) местом решения о старте; почему старт не ждёт
  сети — spec, «Решения по реализации», 1.
- Без него: старт ждал бы `gh api` на каждый repo.
- Требование: [Что делаем, п. 5](../issues/03-модель-health-check.md#что-делаем)
- Риски и пробелы test-ов: сетевых строк пока нет — их регистрирует Ticket 05; test проверяет механизм на источнике
  test-а.

## 6. Что сознательно не меняли

- Вид строк в renderer: `FirstRunChecks.tsx` получил только метку чипа `unknown`, подписи кнопок Epic-а и пропуск этих
  кнопок до их Ticket-ов — чтобы прошёл typecheck. Группы `Projects`, `Codex`, `Linked machines` экран покажет с
  Ticket-ом 04.
- При фокусе окна проверяются заново только строки, у которых есть своя проверка (`registerRecheck`); строки Machine
  проверяют «Check again» и Settings → Health. Полный прогон проверок на фокусе запускал бы процесс Claude Code.

## 7. Как проверено

- `pnpm test` 10 файлов модуля (health-severity, health-reports, first-run-checks, first-run-dialog, first-run-concepts,
  first-run-windows, settings-health, link-access, getting-started-state, getting-started-progress) — exit 0.
- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0, gate fast — exit 0.
- 21 мутант на таблице уровней, худшем уровне, `opensFirstRun`, ожидании сети, частоте повторной проверки, фокусе,
  `redactSecrets`, log причины, сохранении перепроверенных строк, повторной проверке в полёте и `checkState` — все
  краснят test-ы.

## Проверить себя

1. Почему строка `unknown` с `severity: 'critical'` не красит иконку в красный, даже если кто-то так её построил?
   Ответ: `worstLevel` считает critical только строки не в `ok` и не `unknown`; `severityOf` сам даёт `unknown`
   уровень non-critical.
   Lines: `src/shared/health/severity.ts:59-79`
2. Фича сообщила о сбое GitHub access Project-а alpha дважды за 30 секунд. Сколько повторных проверок пойдёт и почему?
   Ответ: одна: вторая попадает в ту же минуту бюджета Project-а alpha (`lastRecheck`).
   Lines: `src/main/first-run/health-reports.ts:95-105`
3. Почему сетевая строка в `fail` без пометки `opensFirstRun` не откроет First run при старте?
   Ответ: решение о старте берёт только `local.checks`, а сетевые строки запускаются после ответа.
   Lines: `src/main/ipc/first-run.ts:258-268`

## 8. Что нашёл review и что осталось

> VERIFIED
> Round 1 findings: lint red from check-personal (personal-data check) — fixed: field renamed to `checked` (src/main/first-run/health-reports.ts:63), test tokens built by join (test/contract/health-reports.test.ts:324-325). Rechecked rows dropped by checkNetwork() — fixed: health-reports.ts:157, tests health-reports.test.ts:270-302. Redaction test blind to redacted logs — fixed: health-reports.test.ts:340-343 asserts reasonmarker/stepmarker in no console output and output.length > 0. Focus started duplicate rechecks (low) — fixed: health-reports.ts:183-184,193, test :241-258.
> Rebase: range-diff shows commits 1-2 identical (`=`), three new commits touch only health-reports.ts, its test, ticket 03 and its Code story; nothing else came in.
> Point 2 (the "unless a source answers for that row now" rule) holds. A source answering `ok` replaces the stored fail row: line 154 writes it and line 157 skips it (mutant M4 killed). A recheck row that no source covers is not stuck: focus() rechecks every non-ok row older than 5 min (health-reports.ts:165-170), and a null answer deletes it (:198-200).
> Point 4 rated low, no merge block: health-reports has no timeout of its own, so a Recheck promise that never settles keeps its key in inFlight until restart. Ticket 05's re-check goes through gh, whose runner times out at 30 s by default (src/main/github/prs.ts:133), and ticket 05 maps a timeout to `unknown`. Not a hang today; it becomes one only if a later ticket registers a re-check without a timeout.
> Consider: health-reports.ts:34 — the `Recheck` type does not say it must settle; state it in the doc comment, or put a timeout around `recheck(project)` at :188 (low).
> Consider: health-reports.ts:103-104 — a failure message that arrives while the same row's re-check is running still spends that Project's one-minute budget, and starts nothing. The in-flight answer is older than the message, so it does not clear it (:212). The row can wait up to a minute for its next re-check (low).
> Consider: health-reports.ts:157 — a kept recheck row is not dropped when local checks now carry the same key; rows() (:223) would then list it twice. No local check produces github-access, codex-login, browser-profile or linked-machine today, so this cannot happen yet (low).
> Mutants (own worktree /tmp/v2018r2-wt at 084af085d; baseline 17/17, exit 0; worktree removed, no processes left): M1 kept rows dropped (:157) exit 1 killed; M2 console.warn of redacted reason+step in reportFailure exit 1 killed; M3 inFlight guard removed (:183) exit 1 killed; M4 recheck row kept over a source answer exit 1 killed; M5 `from` always 'recheck' (:204) exit 1 killed; M6 inFlight never cleared (:193) exit 1 killed. 6/6 killed.
> Checks (PR worktree auth-03, head 084af085d): node scripts/check-personal.mjs exit 0 ("no findings in 7229 files"); env -u GIT_CONFIG_PARAMETERS TMPDIR=/tmp/v2018r2 pnpm typecheck exit 0; pnpm lint exit 0; pnpm test (health-reports, health-severity, first-run-checks) exit 0, 142/142.
> CI on 084af085d (gh pr checks 2018): lint-typecheck pass, changes pass, linux-tests 3/4 and 4/4 pass; linux-tests 1/4 and 2/4, macOS e2e and Windows jobs still pending, ci-ok not final yet.
> Could not verify: the final ci-ok, still pending at review time; no Electron/e2e run (brief).

Code: `src/main/first-run/health-reports.ts:63-63` · key lines: 63

```ts
  private checked: Stored[] | null = null
```

Code: `test/contract/health-reports.test.ts:324-325` · key lines: 324

```ts
    const TOKEN = ['ghp', '0123456789abcdefABCDEF0123456789abcd'].join('_')
    const PAT = ['github', 'pat', '11ABCDEFG0123456789', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV'].join('_')
```

Code: `src/main/github/prs.ts:133-133` · key lines: 133

```ts
        { cwd, env: { ...env, ...extra, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', ...start.env }, encoding: 'utf8', timeout: options.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024 },
```

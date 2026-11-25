# Code story — worfy-polish 142: Аудит повторного review: гонки test-ов и docs

Kind: pr · Epic: worfy-polish · Ticket: 142 · PR: - · Language: ru

## 1. Что было не так

Повторный review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13`) нашёл два flaky test-а с гонкой и пять мест,
где подсказка или страница `docs/features/` расходится с кодом. Все семь были на main 3c9c06e8c.

- Contract test-ы ожидания Limits ждали строку `waiting-until` в journal и сразу читали state Autopilot. В
  `run.ts` (`waitForLimits`) строка пишется первой, а ожидание (`wait.wait`), от которого зависят `status: 'waiting'`
  и `resumesAt`, ставится после `await` записи.
- Shell test heartbeat-а e2e lock-а читал счётчик пауз heartbeat-а до того, как переписать `holder.json` чужим
  владельцем.
- Подсказка MCP popover-а звала вписать имя connector-а claude.ai в список Project-а, а Claude Code такое имя
  отбрасывает.

- Требование: [Что происходит](../issues/142-аудит-повторного-review-гонки-test-ов-и-docs.md#что-происходит)

## 2. Test-ы Limits ждут state, а не строку journal

Code: `test/contract/autopilot-retry.test.ts:626-630` · key lines: 627, 628

```ts
    // The state, not the journal: `waiting-until` is written before the wait is set (run.ts waitForLimits).
    await until(() => h.state().status === 'waiting' && h.state().waitingFor === 'limits', 'the wait for the Limits')
    expect(await h.kinds()).toContain('waiting-until')
    expect(timer.cancelled).toBe(true)
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'limits' })
```

- Что делает: ждёт само условие, которое test потом проверяет, — state `waiting` по Limits. Строку journal
  проверяет после: journal пишется раньше state, поэтому к этому моменту она уже есть. Тот же приём в
  `test/contract/codex-orchestrator.test.ts:868-871`: ждёт `resumesAt` второго ожидания, затем считает две строки
  `waiting-until`.
- Почему здесь: Ticket называет оба файла; finding 49 советует ждать state, а не строку.
- Без него: test читает state между записью строки и `wait.wait` и падает изредка, под нагрузкой.
- Требование: [Что делаем, п. 1](../issues/142-аудит-повторного-review-гонки-test-ов-и-docs.md#что-делаем)
- Риски и пробелы test-ов: гонка показана временной паузой 300 ms в `run.ts` между записью и `wait.wait`, не в
  commit-е: старые test-ы — 2 красных, новые — 56/56. Постоянного test-а на порядок записи нет.

## 3. Счётчик пауз heartbeat-а читается после записи `holder.json`

Code: `harness/bin/tests/wave-gate-heartbeat.test.sh:230-232` · key lines: 230

```sh
        printf '{"prs":[9],"what":"gate-full","pid":1,"since":"x"}\n' >"$L/holder.json"; n="$(sleeps_of)"
        until_ok 10 step_done "$n" "$hb"; touch -t 202001010000 "$L"
        m0="$(mtime_of "$L")"; sleep 1; m1="$(mtime_of "$L")"
```

- Что делает: `step_done "$n"` ждёт паузу heartbeat-а, начатую после счёта. Раньше счёт шёл до записи, и пауза,
  начатая между ними, кончалась проверкой старого (своего) `holder.json`; её `touch` мог прийти после `touch -t` test-а,
  и mtime менялся. Теперь любая такая пауза начата после записи, и её проверка читает уже чужой файл. Тот же порядок —
  в случае kill -9 на строке 186.
- Почему здесь: Ticket называет строки 184 и 227 (до правки); finding 116 — «считать после записи».
- Без него: test иногда красный, когда shell test-а задержится между счётом и записью.
- Требование: [Что делаем, п. 2](../issues/142-аудит-повторного-review-гонки-test-ов-и-docs.md#что-делаем)
- Риски и пробелы test-ов: гонка показана временной копией test-а с медленным `touch` heartbeat-а: старый порядок —
  2 FAIL (bash и zsh), новый — 25/25. Копия удалена, в commit не входит.

## 4. Подсказка про connector говорит, что работает

Code: `src/renderer/session/McpChip.tsx:96-100` · key lines: 100

```tsx
/**
 * Under the servers not allowed (worfy-mcp-live ticket 05; worfy-polish 142): Claude Code drops a name with a dot or a space
 * from its list (mcp-addresses.ts), so a connector's name on it does nothing; the inventory runs each time the popover opens.
 */
export const CONNECTOR_HINT = 'A claude.ai connector missing here cannot be allowed by its name: connect it on claude.ai, then open this list again.'
```

- Что делает: подсказка больше не зовёт вписывать имя connector-а. `allowedMcpEntries` кладёт в список Session
  connector только по адресу из инвентаря, а имя `claude.ai <name>` Claude Code отбрасывает
  (`src/main/vendors/claude/mcp-addresses.ts`). Инвентарь запускается при каждом открытии popover-а
  (`src/main/vendors/claude/session.ts`, `readMcp` с `pickUp`), поэтому подключённый connector появляется в группе с
  Allow.
- Почему здесь: Ticket называет `McpChip.tsx:100` и `docs/features/mcp-servers.md`; finding 39 — убрать обещание.
- Без него: человек вписывает имя, и ничего не происходит.
- Требование: [Что делаем, п. 3](../issues/142-аудит-повторного-review-гонки-test-ов-и-docs.md#что-делаем)
- Риски и пробелы test-ов: `test/unit/mcp-chip.test.tsx` проверяет текст подсказки (до правки красный). Что
  connector после подключения на claude.ai действительно появляется в группе, проверено только чтением кода, не живым
  connector-ом.

## 5. Страница gate: пауза `land` при красном main

Code: `docs/features/gate-and-github.md:203-212` · key lines: 204, 205, 208, 209

```md
**A red main branch holds the merge.** The Harness script `land`, which merges the Orchestrator's ready PRs one by one,
reads the CI push runs of the main branch before it merges a PR. While the newest run with a verdict is red, a PR with code
waits, with a reason that names the red commit, the PR that broke the branch, when the run finished and the deadline of a
fix forward: one hour, then revert that PR (when none of the newest 50 push runs is green, the reason names
no PR and no deadline: the culprit is older, found by hand). A run still queued or in progress, a cancelled run and the run of a commit that
changed documents only are passed over; a red run whose failed jobs were rerun and passed counts as green, and while the
newest run is being rerun code PRs wait for its verdict. Two kinds of PR merge while the branch is red: the fix or the
revert, marked `main_fix`, and a PR with documents only. When `gh` cannot read the runs, the PR waits as not verified.
`land` reruns and reverts nothing: the pause ends at the first pass that finds the newest verdict green, and the next PR
merges then. Each reading keeps the `main-red-<key>.json` marker above.
```

- Что делает: описывает условие паузы и её снятие по `harness/bin/land` (заголовок `:31-45`, `mainGreen`,
  `mainAllows`). Рядом, в абзаце о marker-е, «no screen or Autopilot step acts on it yet» заменено: Autopilot его
  читает (`src/main/ipc/autopilot.ts:248`). Остальные страницы: общее слово в host name не секрет
  (`harness/lib/privacy.cjs`, `hostNeedles`) — `gate-and-github.md` и `evidence.md`; Stop hook под Codex не запускает
  gate в main checkout (`harness/hooks/stop.mjs:189`) — `vendors.md`; Session Node рисует ответ в `<pre>`
  (`src/renderer/canvas/nodes/SessionNode.tsx:517-519`) — `projects.md`. Перевод в `docs/features/ru/` — с тем же
  смыслом.
- Почему здесь: Ticket называет абзацы; findings 119, 120, 127, 192. Перевод правится по брифу Orchestrator-а.
- Без него: страницы обещают поведение, которого нет.
- Требование: [Что делаем, п. 4–8](../issues/142-аудит-повторного-review-гонки-test-ов-и-docs.md#что-делаем)
- Риски и пробелы test-ов: docs проверяет только `node scripts/check-feature-docs.mjs` (пути и заголовки), не смысл.

## 6. Что сознательно не меняли

- `src/main/autopilot/run.ts`: порядок «journal, затем state» оставлен — чинился test, не код (бриф).
- Timeout-ы test-ов не менялись.
- Markdown на Session Node не добавлен: finding 192 решён правкой страницы, как советует triage.

## 7. Как проверено

- `node scripts/vitest-electron.mjs test/contract/autopilot-retry.test.ts test/contract/codex-orchestrator.test.ts` ×10 —
  10/10 exit 0.
- `bash harness/bin/tests/wave-gate-heartbeat.test.sh` ×10 — 10/10 exit 0.
- `node scripts/vitest-electron.mjs test/unit/mcp-chip.test.tsx` — exit 0 (42), до правки exit 1.
- `node scripts/check-feature-docs.mjs` — exit 0.

## Проверить себя

1. Почему test Limits нельзя чинить ожиданием строки `waiting-until` подольше?
   Ответ: строка пишется до `wait.wait`; сколько ни жди строку, state может ещё не обновиться. Ждать надо само
   условие — state.
   Строки: `test/contract/autopilot-retry.test.ts:626-628`
2. Почему чтение счётчика после записи `holder.json` убирает поздний `touch`?
   Ответ: `step_done` ждёт паузу, начатую после счёта, значит после записи; проверка после такой паузы читает уже чужой
   файл и не трогает lock, а `touch` предыдущего шага случился до начала паузы.
   Строки: `harness/bin/tests/wave-gate-heartbeat.test.sh:230-231`

## 8. Что нашёл review и что осталось

> VERIFIED — worfy-polish 142 (audit findings 49 and 116: two test races; 39, 119, 120, 127, 192: the MCP chip hint and five feature pages that said what the code does not do), head d7c939b571d0020af4dccbc759a8fd451eb0a8cf
>
> Gate (depth medium, one round): reviewer (lens: correctness) — MERGE with one low; the Orchestrator fixed it (d7c939b57 with the Code story).
>
> - What the user sees: the MCP chip no longer tells the user to type a connector's name into the Project's MCP list (Claude Code drops such a name); it says to connect the connector on claude.ai and open the list again, which re-reads the inventory and offers Allow. The feature pages (en and ru) now say: land pauses code PRs on a red main and how the pause ends; a common word in a host name is not taken for a secret; Stop in the main checkout does not run the gate, a Subagent's stop does; a Session Node shows an answer as plain text, markdown is drawn in the Session view.
> - Test races removed, not hidden: the autopilot-retry and codex-orchestrator contract tests wait for the run state, not for the journal line written before the wait starts (with a forced 300 ms pause the old tests fail 2 of 56, the new pass); the heartbeat shell test reads its counter after holder.json is written. No timeout raised; the old journal assertions stay.
> - Fixed by the Orchestrator: the land paragraph also covers a red main with no green run among the newest 50 (the reason names no PR and no deadline), en and ru.
> - Evidence: reviewer re-read every doc sentence against harness/bin/land, harness/lib/privacy.cjs, harness/hooks/stop.mjs, mcp-addresses.ts, session.ts, mcp-inventory.ts, SessionNode.tsx, Transcript.tsx; contract tests + mcp-chip 98 passed EXIT=0; heartbeat test 25/25 EXIT=0; implementer ×10 runs of both 10/10; gate fast green on 44e637d58; story-check ok on d7c939b57.
> - Not verified: a live claude.ai connector appearing after the list is reopened (code read only).

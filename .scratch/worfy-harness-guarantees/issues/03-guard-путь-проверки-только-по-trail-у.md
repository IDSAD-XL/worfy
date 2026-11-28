# 03: guard: путь проверки — только по trail-у

Type: task
Status: claimed 2026-11-28T13:58Z
PR: #2386
Blocked by: 01, 02, 04
Source: [spec.md](../spec.md), «Ticket-ы», 03; «Решение», 1; «Набросок функции» (шаги 2–4, схема решения guard-а);
«Решения по реализации» («guard: путь проверки — только по trail-у», «Один helper отказа»); «Решения по test-ам»,
Seams (guard), «Сначала падающий test», 03, «Mutation testing» и «Windows»; «Риски» («Silent mode слабее», «Ticket
только на ветке»); «Волны», Wave 3; [critic 2026-11-28](../../../docs/product/critic/worfy-harness-guarantees-2026-11-28.md),
возражение 2 и «Alternative»

Кто: агент. Глубина ревью — `high`; reviewer делает mutation testing: убирает каждое правило deny в отдельной копии
репозитория, хотя бы один test краснеет.

Платформенный PR (ADR-0056, пункт 2): hook Harness, разбор путей на win32 и в Git Bash; до merge нужен Windows verdict.

## Что происходит

- Implementer правит только файлы trail-а своего Ticket-а (`harness/agents/implementer.md:87-90`) — это текст. guard
  проверяет только Bash: `if (payload?.tool_name !== "Bash") ok()` (`harness/hooks/guard.mjs:77`); `apply_patch` на
  Codex он отказывает только reviewer-у и scout-у (`guard.mjs:69-76`). Matcher hook-а — `Bash|apply_patch`
  (`harness/hooks/hooks.json:187`): Edit и Write не проверяет никто.
- Implementer может править workflow CI, Quarantine или настройку test-ов в своём PR, и `ci-ok` станет зелёным по
  изменённым правилам.
- `land` (Ticket 04) уже ловит такой PR при merge; guard останавливает правку раньше и говорит следующий шаг.

## Что строить

- Matcher PreToolUse в `hooks.json:187` — `Bash|apply_patch|Edit|Write|MultiEdit|NotebookEdit`.
- Путь записи:
  - Edit, Write, MultiEdit — `tool_input.file_path`; NotebookEdit — `notebook_path`;
  - `apply_patch` — заголовки `*** Add File:`, `*** Update File:`, `*** Delete File:` и `*** Move to:`;
  - Bash — цели записи, которые уже находят лексер (`lex`, `guard.mjs:427`) и разбор путей (`expandPath`,
    `guard.mjs:849-861`: `~`, `$HOME`, переменные команды, Git Bash на Windows).
- Путь сверяется со списком `harness/lib/verification-paths.cjs` (Ticket 02).
- Subagent узнаётся по полю, которое назвал spike 01 (`agent_type` или `agent_id`): `worfy:implementer` на Claude Code,
  `worfy-implementer` на Codex (`harness/hooks/codex-input.mjs:8-9`, `:23-33`). Главная Session не отказывается:
  Orchestrator пишет Quarantine сам, а его PR проходят `land`.
- Ticket — по ветке worktree и шаблону `tickets.branch` (`<epic>/<NN>`); trail — helper-ом Ticket-а 04 (тот же код, что
  у `land`): `git show <worktree.base>:<путь>`, раздел `tickets.trail_section`, на вершине base branch. `git fetch`
  guard не делает: `origin/main` свежий после preflight каждой Wave (`src/main/autopilot/harness-drift.ts:15-17`).
  Subagent без Ticket-а (ветка не по шаблону) путь проверки не правит.
- Отказ: «<путь> is a verification path, and the trail of <epic> <NN> does not name it. Write the need into your
  report; the Orchestrator adds the path to the trail».
- Silent mode: Ticket-ы лежат вне репозитория, и `git show` их не видит. guard читает trail из файла Ticket-а в Workflow
  folder и отказывает Subagent-у правку раздела trail-а. Это слабее; риск записан в spec-е.
- Тот же раздел отказывает:
  - Subagent-у — `ticket mark` (`harness/bin/ticket:41-48`);
  - любой Session агента — `profile-set` полей, от которых зависят условия: `verification.*`, `workflow.ci_check`,
    `workflow.pipeline`, `workflow.merge` (`harness/bin/profile-set`). Их меняет владелец — формой Edit profile или в
    терминале.
- Один helper отказа `deny()` в `guard.mjs`: причина и следующий шаг по-английски (ADR-0074). Если в окружении есть
  `WORFY_GUARD_LOG` (имя — предложение), он дописывает туда строку JSON: время, id правила, агент, Ticket, сокращённая
  команда. Без переменной — например, в терминале — guard ничего не пишет. Формат строки записан в шапке `guard.mjs`:
  его читает Ticket 10 (Journal и Run history).
- Тексты о шаге после отказа:
  - `harness/agents/implementer.md` (`:87-94`): отказ guard-а — не ошибка; нужда пишется в отчёт, правки обходом нет;
  - skill `epic-wave`: Orchestrator дописывает путь в trail documents PR-ом, после merge implementer продолжает.

## Где в коде

- `harness/hooks/hooks.json` — matcher PreToolUse `:185-196`
- `harness/hooks/guard.mjs` — шапка `:1-26`, вход `:61-77`, новый раздел путей проверок, `deny()`, `lex` `:427`,
  `expandPath` `:849-861`
- `harness/hooks/codex-input.mjs` — `codexAgent` `:23-33`
- `harness/lib/verification-paths.cjs` (Ticket 02) и helper trail-а (Ticket 04) — только вызов
- `harness/agents/implementer.md` — `:87-94`
- `harness/skills/epic-wave/SKILL.md` — шаг Orchestrator-а после отказа (раздел 2 «Dispatch» `:367` или раздел 3 `:547`)
- `harness/hooks/tests/guard-verification.test.sh` (новый, имя — предложение)
- `test/contract/harness-codex-hooks.test.ts` — вход Codex `apply_patch` от `worfy-implementer`
- Только читать: `harness/bin/ticket`, `harness/bin/profile-set`, `harness/hooks/tests/rules-hooks.test.sh`,
  `harness/hooks/tests/guard-silent.test.sh` (как подавать JSON PreToolUse на stdin)

## Test-ы

- Shell test-ы подают JSON PreToolUse на stdin и читают решение, как `rules-hooks.test.sh` и `guard-silent.test.sh`:
  - Edit, Write, MultiEdit, NotebookEdit, `apply_patch` и Bash (`echo x > .github/workflows/ci.yml`) от implementer-а в
    путь проверки вне trail-а — deny с путём и следующим шагом;
  - тот же путь, когда trail на base branch его называет, — allow;
  - главная Session — allow; Subagent без Ticket-а — deny;
  - Silent mode: trail из Workflow folder; правка раздела trail-а Subagent-ом — deny;
  - `ticket mark` из Subagent-а и `profile-set --field workflow.merge` любой Session агента — deny;
  - с `WORFY_GUARD_LOG` — строка JSON с id правила; без переменной — файл не пишется.
- Contract test Codex (`harness-codex-hooks.test.ts`): `apply_patch` от `worfy-implementer` в путь проверки — deny.
- Сначала падающий test: Edit от `worfy:implementer` в `.github/workflows/ci.yml` сегодня проходит (`guard.mjs:77`);
  test ждёт deny.
- Windows: пути с `\` и регистром, Git Bash — тот же shell test на ПК в CI.
- Без моделей и без сети.

## Готово, когда

- [ ] Subagent на Claude Code (Edit, Write, MultiEdit, NotebookEdit, Bash) и на Codex (`apply_patch`, Bash) не правит путь
      проверки вне trail-а своего Ticket-а на base branch в любом permission mode; отказ называет путь и следующий шаг
      (shell test-ы и contract test Codex, красный на старом коде).
  - evidence: test-run pass · `bash harness/hooks/tests/guard-verification.test.sh` exit 0; `pnpm test -- test/contract/harness-codex-hooks.test.ts` exit 0 · mac - · a6ed5f8b87967019ffe7062a1cdd5ed0d19a2e8e
- [ ] Путь, который trail называет, проходит; главная Session проходит; Subagent без Ticket-а отказан.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-verification.test.sh` exit 0 · mac - · a6ed5f8b87967019ffe7062a1cdd5ed0d19a2e8e
- [ ] Silent mode: trail читается из Workflow folder, правка раздела trail-а Subagent-ом отказана.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-verification.test.sh` exit 0 (silent cases) · mac - · a6ed5f8b87967019ffe7062a1cdd5ed0d19a2e8e
- [ ] `ticket mark` из Subagent-а и `profile-set` полей `verification.*`, `workflow.ci_check`, `workflow.pipeline`,
      `workflow.merge` любой Session агента отказаны.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-verification.test.sh` exit 0 (ticket mark and profile-set cases) · mac - · a6ed5f8b87967019ffe7062a1cdd5ed0d19a2e8e
- [ ] `deny()` пишет строку JSON в `WORFY_GUARD_LOG`, когда переменная задана; формат записан в шапке `guard.mjs`.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-verification.test.sh` exit 0 (refusal log cases) · mac - · a6ed5f8b87967019ffe7062a1cdd5ed0d19a2e8e
- [ ] Тексты implementer-а и skill `epic-wave` называют шаг после отказа.
  - evidence: commit pass · worfy-harness-guarantees/03: the guard refuses a subagent edit of a verification path outside its trail · - - · a6ed5f8b87967019ffe7062a1cdd5ed0d19a2e8e
- [ ] Mutation testing reviewer-а: снятие каждого нового правила deny краснит хотя бы один test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.

## Итог

- Сначала падающий test: `harness/hooks/tests/guard-verification.test.sh` (commit `1823d98bb`) на старом guard-е —
  57 из 85 case-ов красные, первый — «Edit of a verification path outside the trail»: Edit от `worfy:implementer` в
  `.github/workflows/…` проходил (`if (payload?.tool_name !== "Bash") ok()`). Contract test Codex тоже красный на старом
  коде: `apply_patch` от `worfy-implementer` проходил.
- Matcher PreToolUse — `Bash|apply_patch|Edit|Write|MultiEdit|NotebookEdit` (`harness/hooks/hooks.json`); файловые
  tool-ы доходят только до нового раздела 4 `guard.mjs`, Bash — до всех разделов.
- Раздел 4 берёт путь записи из `file_path` (Edit, Write, MultiEdit), `notebook_path` (NotebookEdit), заголовков
  `apply_patch` и целей записи shell-команды: перенаправления `>`, `>>`, `&>` (лексер `lex` теперь отдельно помнит их в
  `writes`), `tee`, `cp`, `mv`, `install`, `ln`, `rm`, `rmdir`, `unlink`, `touch`, `truncate`, `dd of=`, `sed -i`,
  `perl -i`; `cd`, `~`, `$HOME` и переменные команды — через `expandPath`. Путь идёт через realpath ближайшей
  существующей папки (native на обеих сторонах — короткие имена Windows), корень — `git rev-parse --show-toplevel` той
  папки: worktree в `.claude/worktrees/` — свой репозиторий, а не `.claude/**` главного checkout-а.
- Решение — правило `land`: список `verificationPaths` профиля, `readTrail` ветки дерева файла на вершине
  `worktree.base` (`refs/remotes/origin/main`) или в папке Ticket-ов, `namedByTrail`; символическая ссылка (`ln -s`)
  считается путём проверки где угодно, как в `land`, удаление папки над путём проверки (`rm -rf .github`) — тоже.
  Отказ: «<путь> is a verification path, and the trail of <epic> <NN> does not name it. Write the need into your
  report; the Orchestrator adds the path to the trail».
- Subagent — по `agent_id` (spike 01: `agent_type` есть и у главного потока Session с `--agent`); на Codex — `agent_type`
  или `agent_id`. Главная Session не отказывается. Отказ: ветка без Ticket-а, Ticket только на ветке («cannot be read at
  origin/main»), профиль, который не читается (только для путей проверок). Папка без профиля (exit 3) — раздел молчит,
  как раздел 3. Чтение, не ответившее за общий бюджет раздела 8 s, и упавший hook пропускают — путь закрывает `land`.
- Silent mode (и папка Ticket-ов вне репозитория): trail — из файла Ticket-а в папке; правка Subagent-ом, которая меняет
  пути trail-а (как их читает `trailPaths`), отказана; правка других разделов проходит; shell-запись в такой Ticket и
  patch, чьи hunk-и не сходятся, отказаны («may change»).
- Тот же раздел: `ticket mark` из Subagent-а отказан (`--contexts` проходит); `profile-set --set|--reset` полей
  `verification`, `verification.*`, `workflow`, `workflow.ci_check`, `workflow.pipeline`, `workflow.merge` (и запись
  Pipeline без `--field`) отказан любой Session агента; `--read` и `--check` проходят.
- Один `deny(reason, rule)`: у каждого правила свой id (`verification-path`, `verification-path-no-ticket`,
  `verification-path-profile`, `ticket-trail-edit`, `ticket-mark-subagent`, `profile-set-merge-fields` и старые
  `read-only-agent`, `interactive-shell`, `uncommitted-work`, `pipe-exit-code`, `workflow-traces`). С `WORFY_GUARD_LOG`
  — строка JSON `{time, rule, agent, agent_id, ticket, tool, command (≤200), session, cwd}`; формат — в шапке
  `guard.mjs`. Файл, который не пишется, отказ не отменяет.
- Тексты: `harness/agents/implementer.md` (отказ — не ошибка, нужда — первой строкой `not_verified`), skill `epic-wave`,
  раздел 2 «Dispatch» (documents PR с путём в trail, затем `SendMessage` тому же implementer-у; rebase не нужен).
  Feature docs: `docs/features/skills-agents-and-hooks.md`, `harness.md`, `gate-and-github.md` (английские).
- Вне trail-а, по необходимости: `harness/hooks/tests/rules-hooks.test.sh` (в trail-е «только читать») закрепляет
  matcher hooks.json — строка обновлена; `harness/evals/lib/coverage.json` — `hooks/guard.mjs` назван загрузчиком
  `lib/ticket-trail.cjs` и `lib/verification-paths.cjs` (иначе `harness-evals-run.test.ts` красный).
- Mutation testing (своя проверка до reviewer-а): копия Harness, где `deny()` пропускает одно правило, — для каждого из
  шести новых id test краснеет (verification-path — 40 case-ов, no-ticket — 2, profile — 1, ticket-trail-edit — 4,
  ticket-mark-subagent — 2, profile-set-merge-fields — 7).
- Не проверено здесь: Windows и Git Bash — только CI (case-ы с `\`, регистром и `/c/…` в том же shell test-е); живой
  Codex не запускался (fixture-входы).

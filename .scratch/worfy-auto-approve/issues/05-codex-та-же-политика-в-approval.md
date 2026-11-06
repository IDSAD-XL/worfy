# 05 — Codex: та же политика в approval

Type: task
Status: claimed 2026-11-06T00:00Z
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает», п. 8; Q7

Глубина ревью: high.

## Что происходит

- Unattended approval Codex — `decline` сразу и `refused` (`src/main/vendors/codex/session.ts:586-590`); запрос в
  терминах worfy — `approvalAsk` (`src/main/vendors/codex/approvals.ts:59`).
- Unattended Codex идёт в `full-access` (`approvalPolicy: 'never'`, `src/main/vendors/codex/capabilities.ts:43-44`,
  `:59`): в Autopilot запросов сейчас нет. Ветка нужна для любого другого preset-а и для Q7 (б).
- Есть ли у `decline` способ передать модели текст подсказки — не проверено.

## Что делаем

1. Ветка `if (this.opts.unattended)` зовёт `this.opts.approval` (Ticket 04): `off` — как сегодня; `shadow` — решение
   пишется, ответ `decline`; `on` — allow → `accept`, deny / hard-deny → `decline`, park → как у attended
   (`permissions.ask`, Ticket 07).
2. Вход политики: команда (`input.command`, `cwd`) — через разбор Ticket-а 02; `fileChange` — пути изменений и
   `grantRoot`. `acceptForSession` политика не отвечает никогда: каждое решение — на один запрос.
3. Подсказка при `decline`: выяснить по протоколу app-server-а (`src/main/vendors/codex/protocol/`), можно ли
   передать текст; если нет — подсказка остаётся только в Journal; записать в «Итог».

## Готово, когда

- [ ] Contract test на fake Codex (`WORFY_CODEX=fake`, временный `CODEX_HOME`): `off` — ответы как сегодня; `shadow`
      — `decline` и строка `would-allow`; `on` — `accept` внутри worktree, `decline` вне корня и на hard deny.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-codex.test.ts` exit 0 · mac - · 12d15f59620d8ea8367c65a6869ea24887eae5e6
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/auto-approve test/contract/codex- test/unit/codex- test/unit/auto-approve` exit 0 · mac - · ed459f539
- [ ] Contract test: `fileChange` с путём вне корней — `decline`; с `grantRoot` вне корней — `decline`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/auto-approve-codex.test.ts` exit 0 · mac - · 12d15f59620d8ea8367c65a6869ea24887eae5e6
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/auto-approve test/contract/codex- test/unit/codex- test/unit/auto-approve` exit 0 · mac - · ed459f539
- [ ] Ответ про текст подсказки Codex — в «Итог», со ссылкой на файл схемы протокола.
  - evidence: commit pass · Codex: judge unattended approvals by the Auto-approval policy · - - · 12d15f59620d8ea8367c65a6869ea24887eae5e6
  - evidence: commit pass · Codex Auto-approval: a parked approval waits for the owner on the Session gate · - - · ed459f539
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 12d15f59620d8ea8367c65a6869ea24887eae5e6
  - evidence: gate pass · `gate fast` exit 0 · mac - · ed459f539

## Тесты

- Contract `test/contract/auto-approve-codex.test.ts` (новый). Настоящий Codex не запускается.
- Прогнать `test/contract/codex-*.test.ts`, `test/unit/codex-*.test.ts`.

## Где в коде

- `src/main/vendors/codex/session.ts`
- `src/main/vendors/codex/approvals.ts`
- `test/contract/auto-approve-codex.test.ts` (новый)
- `src/main/autopilot/run.ts`, `test/contract/auto-approve-claude.test.ts`, `docs/features/autopilot.md` — добавлены
  при работе (см. «Итог»)

## Итог

Approval-запрос unattended Session-и Codex при Auto-approval Shadow и On судит политика Ticket-а 03 — та же, что
у Claude Code (`src/main/vendors/codex/session.ts`, `judged`). Режим читается при каждом запросе; если прочитать
нельзя — Off. Off — как до Ticket-а: `decline` сразу, `refused`, политика не спрашивается, процесс app-server-а
получает прежнее окружение. Shadow — `decline`, как Off, и решение (`would-*`, hard deny как `hard-deny`) уходит
событием `auto_approval`; `refused` не зовётся. On — allow → `accept`, deny и hard deny → `decline`; park ждёт владельца
на gate Session-и, как у Claude (Ticket 07, см. «После rebase на #1467»). `acceptForSession` политика не отвечает
никогда.

**Что судится** (`policyRequestOf`, `src/main/vendors/codex/approvals.ts`):
- команда — `commandExecution` с `command` и `cwd` из запроса (или из `item/started`); папка запроса — та, что назвал
  Codex; без неё — deny `no-cwd` (Ticket 04);
- ввод в уже идущую команду (`kind: writeStdin`) и запрос сетевого доступа (`networkApprovalContext`) — не команда,
  которую политика может прочитать: они идут под именами `writeStdin` и `networkAccess`, политика паркует их как
  `unknown-tool`;
- `fileChange` — каждый путь изменения, каждый `move_path` (переименование пишет и туда) и `grantRoot`; папка — папка
  Session-и. Путь не абсолютный — deny `not-judged`, как для Claude.
- **`grantRoot` не одобряется никогда** (`withGrantRoot`): по схеме это запрос на запись под папкой «до конца
  Session-и» (`FileChangeRequestApprovalParams.ts`: «unclear if this is honored today»), а политика решает по одному
  запросу. Вне корней — `decline` по решению политики; внутри — park с правилом `grant-root`; сам корень worktree —
  deny `whole-root` политики.

**Окружение.** Процесс app-server-а получает `SessionStart.environment` (TMPDIR и git-окружение Run-а) поверх своего —
только в Shadow и On; в Off `environment` нет, окружение прежнее. Каждый запрос судится во всём окружении, с которым
процесс запущен: драйвер берёт `env` из опций `spawn` (то, что реально ушло процессу, с GH_TOKEN и переменными MCP).
Shell-ы Codex наследуют окружение app-server-а; `shell_environment_policy` Codex может убрать из shell-а переменные с
`KEY`/`SECRET`/`TOKEN` в имени — политика тогда судит по надмножеству, это не ослабляет её.

**Подсказка при `decline`.** Передать модели текст нельзя: ответ на оба запроса — только `{ decision }`
(`src/main/vendors/codex/protocol/ts/v2/CommandExecutionRequestApprovalResponse.ts`,
`src/main/vendors/codex/protocol/ts/v2/FileChangeRequestApprovalResponse.ts`; Codex 0.166.0). Подсказка правила
остаётся только в Journal (строка `auto-approval`, поле `rule`); модель видит лишь статус `declined` у item-а.

**Запрос, закрытый во время суда.** Пока политика судит, запрос открыт: Interrupt и закрытие отвечают `cancel`, Codex
может снять его сам (`serverRequest/resolved`); тогда решение не отправляется и не попадает в Journal.

**Вне следа тикета.** `src/main/autopilot/run.ts` закрывал политику Run-а на Codex Orchestrator-е и писал
`autoApproval: off` («worfy-auto-approve ticket 05 brings Codex»). Без снятия этой проверки ветка не исполнилась бы в
Autopilot никогда, а с правкой драйвера процесс Codex получал бы `TMPDIR` папки, которую Run тут же удаляет. Проверка
снята; test Ticket-а 04 «Run на Codex пишет off» переписан: теперь `run-started` с `autoApproval: on` и строки
`auto-approval`. Страница `docs/features/autopilot.md` (английская) обновлена.

**Q7 (а) в силе:** unattended Codex идёт в `full-access` (`approvalPolicy: never`), в Autopilot запросов нет; ветка
работает для другого preset-а.

Test-ы: `test/contract/auto-approve-codex.test.ts` (новый, fake app-server, временный `CODEX_HOME`, настоящий Codex не
запускается).

Mutation testing изменённых строк `approvals.ts` и `session.ts` (19 mutant-ов, ручные замены, прогон
`auto-approve-codex.test.ts`): 18 убиты. Выжил один — проверка `judged.tool === 'fileChange'` перед `command`: у входа
file change нет `command`, проверка была лишней; убрана.

### Раунд 2 (review high PR #1469: 2 medium, 3 low)

1. **Окружение суда было шире окружения команды** (medium). Политика судила во всём окружении app-server-а, с GH_TOKEN
   и токеном MCP; `shell_environment_policy` Codex может убрать их из shell-а команды. `rm -rf "$GH_TOKEN"<путь>`
   судился внутри worktree, а исполнялся бы вне его; значение токена попадало в `targets` Journal. Теперь
   (`judgedEnvironment`, `approvals.ts`) из окружения суда убраны все имена по `/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i`:
   ссылка на них — неизвестная переменная, команда не одобряется (`not-judged`). Test: обе команды → `decline`, ни в
   одном решении нет значения токена.
2. **В On не проходила ни одна настоящая команда Codex** (medium). Codex 0.166 шлёт команду строкой
   `/bin/zsh -lc '<script>'` (`test/fixtures/codex-messages/turn.jsonl`, `approval-declined.jsonl`); `/bin/zsh` политика
   не знала — всё уходило в park. Теперь (`codexScript`) ровно эта форма — zsh, bash или sh по имени или из `/bin`,
   `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`; `-lc` или `-c`; скрипт одним словом в кавычках — судится как
   `<shell> -c '<script>'` по правилам `-c` грамматики (`shell.ts`), с отказом при ZDOTDIR / BASH_ENV / ENV. `-l`
   читает login profile владельца; агент писать его не может (вне корней), поэтому `-lc` судится как `-c`. Любая
   другая обёртка (другая папка, `-ilc`, `-l -c`, второе слово, скрипт без кавычек) не разворачивается и не
   одобряется. Скрипт в двойных кавычках с неэкранированным `$` или обратной кавычкой тоже не разворачивается:
   грамматика раскрыла бы его во внешнем слове, а Codex передаёт скрипт как есть. Contract test теперь шлёт команды
   в записанной форме Codex: `accept` внутри worktree, `decline` вне корней, park `git-hooks` при hook-е в репозитории.
3. (low) Команда с `networkApprovalContext: null` — обычная команда, `accept` (новый случай в test-е).
4. (low) Запрос, снятый Codex или отменённый Interrupt-ом во время суда, строки Journal не получает; у Claude Code
   каждый судимый запрос её получает (`canUseTool` не снимается). Разница названа на странице
   `docs/features/autopilot.md` и в комментарии `judged`.
5. (low) `SHADOW_OUTCOME` и чтение режима — в одном helper-е `src/main/agent/auto-approve/mode.ts`
   (`reportedOutcome`, `approvalMode`); оба драйвера его импортируют.

Mutation testing изменённых строк раунда 2 (`approvals.ts`, `session.ts`, `mode.ts`; 28 mutant-ов: части regex обёртки,
проверка `$` в двойных кавычках, каждое имя секрета, окружение суда, `networkApprovalContext: null`, helper режима):
28 убиты, выживших нет.

### После rebase на #1467 (Ticket 07, park)

Rebase на `origin/main` с #1467 (`8ec31f601`). Конфликты: `docs/features/autopilot.md` — текст park из #1467 оставлен,
абзац про Codex добавлен после него; `src/main/vendors/claude/session.ts` — код park из #1467 оставлен, исход строки
теперь через `reportedOutcome` (`mode.ts`) вместо локального `SHADOW_OUTCOME`. `src/main/autopilot/run.ts` слился без
конфликта: правки #1467 на месте, снятие политики для Codex-Run-а убрано, как в раунде 1.

Ticket 07 пишет: «Codex park не делает — это Ticket 05». Поэтому п. 1 «park → как у attended» сделан здесь
(`judged`, `src/main/vendors/codex/session.ts`). В On запрос, который политика паркует, открывается на gate Session-и
через `createParker` (`park.ts`), как у Claude: карточка с правилом и путями, варианты Accept, Decline и «Decline and
stop the turn», без «Accept for this Session». В Journal — `park`, потом `park-answered` (с `allow` / `deny`) или
`park-expired`. Ответ Codex — выбор владельца (`accept`, `decline` или `cancel`); park без ответа (60 мин, остановка
Run-а, `parks()` = false, отказ gate-а, запрос снят) — `decline`. Запрос, снятый до решения политики, не паркуется и
строки не получает. `grantRoot` политика не принимает никогда; владелец на карточке может принять — путь `grantRoot`
есть в `targets` карточки.

Contract test-ы park (`auto-approve-codex.test.ts`, describe «a parked request waits for the owner»): владелец
принимает → `accept`, на карточке нет `acceptForSession`; «Decline and stop the turn» → `cancel`; Run останавливается
→ `decline` и `park-expired`; Session закрыта во время ожидания → один `cancel` и `park-expired`; запрос снят до решения
→ не паркуется. Test On: владелец отклоняет все 8 parked запросов, у каждой строки `park` — своя карточка с тем же
правилом и путями. Mutation testing новых строк `judged` (16 mutant-ов: условие On, проверка снятого запроса, каждое
поле запроса к gate-у, ответ владельца, ответ без владельца, строки Journal, отказ gate-а): 16 убиты.

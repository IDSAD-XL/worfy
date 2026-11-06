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
- [ ] Contract test: `fileChange` с путём вне корней — `decline`; с `grantRoot` вне корней — `decline`.
- [ ] Ответ про текст подсказки Codex — в «Итог», со ссылкой на файл схемы протокола.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

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
событием `auto_approval`; `refused` не зовётся. On — allow → `accept`, deny и hard deny → `decline`; park → `decline`,
пока Ticket 07 не влит (как заготовка Ticket-а 04 у Claude). `acceptForSession` политика не отвечает никогда.

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

# 01 — Действия PR в main: action templates, `{sha}`, причины кнопок, канал `actions.prFollow`, маршрут и отказы

Type: task
Status: done 2026-11-18T16:23Z
PR: #2005
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Решение» → «Куда идёт щелчок по действию»; «Решения по реализации», 1 и 4;
«Вопросы владельцу», Q7 (решено без владельца, подтвердить); «Решено без владельца», 3 и 5;
[critic 2026-11-14](../../../docs/product/critic/worfy-pr-follow-2026-11-14.md), возражения 1 и 3

Кто: агент.

Не платформенный Ticket (чистые модули `src/shared` и main process, без веток по платформе). Глубина ревью — `medium`.

## Что происходит

- Действия Project-а — `ACTIONS` (`src/shared/projects/action-templates.ts:22`): Ship ticket, Run wave, Process gate
  queue, Draft replies; подписи — `:26-31`. Плейсхолдеры — `PLACEHOLDERS` (`:8`), их описания — `:11-20`; `{sha}` нет.
- Draft replies запускает новую Session Node на Claude Code и шлёт ей шаблон (`src/main/actions/launch.ts:247-254`);
  Binding-а у неё нет. Ship ticket привязывает Session к Ticket-у через `bindWhenKnown` (`:222`, `:410`).
- Main уже умеет продолжить законченную Session Node и послать ей текст: `NodeSessions.started`
  (`src/main/agent/node-sessions.ts:322-327`) продолжает её по транскрипту и отдаёт живую Session; `Session.send`
  (`src/main/agent/session.ts:461-475`) шлёт сразу или в очередь; `Session.notice` (`:349-351`) — строка, которую модель
  не видит. Этим путём продолжение после перезапуска шлёт своё сообщение (`src/main/agent/continuity.ts:23-25`;
  ADR-0108, пункт 5).
- Время последней записи транскрипта Session автоархив читает как `lastAt` (`src/main/layout/archive.ts:125-128`);
  Binding-и Session — `sessionBindings` (`:605`).
- В строке PR inbox есть `headRefOid`, `ci`, `mergeStateStatus`, `author` (`src/shared/ipc/pr-inbox.ts:55-89`), но нет
  `isCrossRepository`: `PULL_FIELDS` (`src/main/github/inbox.ts:69-77`) его не читает.
- Свежее чтение одного PR — `PrInbox.refresh(repo, number)` (`src/main/github/inbox.ts:355`), его строка — в
  `snapshot` (`:386`).

## Что делаем

1. `src/shared/projects/action-templates.ts`: в `ACTIONS` — `fixChecks`, `resolveConflicts`, `addressComments`;
   подписи «Fix checks», «Resolve conflicts», «Address comments». Шаблоны старого Harness (`:47-55`) — пустые. Шаблоны
   плагина (`:64-69`): `/worfy:pr-fix checks {repo}#{pr} {sha}`, `/worfy:pr-fix conflicts {repo}#{pr} {sha}`,
   `/worfy:pr-fix comments {repo}#{pr} {sha}`. Известные шаблоны по умолчанию (`:94-100`), схема (`:136-141`),
   `savedProjectSettingsSchema` (`:224`), `projectSettingsAnswerSchema` (`:244`), `projectSettingsInputSchema` (`:259`)
   и `src/main/projects/settings.ts:39-67` — как у `gateQueue` и `prReply`: файл без новых полей читается с шаблонами
   по умолчанию, Linked machine старой сборки — с пустыми.
2. Плейсхолдер `sha` в `PLACEHOLDERS` и описаниях: ровно 40 hex-символов, иначе render отказывает (текст уходит в
   Session с `bypassPermissions`, как `{repo}` — `src/shared/ipc/actions.ts:79-84`). Комментарий-список
   `src/shared/actions/render-template.ts:7-15` и `prFollowState` рядом с `prReplyState` (`:148-157`).
3. Новый `src/shared/actions/pr-follow.ts` — чистая функция причин и порядка: `DIRTY` → `resolveConflicts`,
   `ci: 'failing'` → `fixChecks`, `CHANGES_REQUESTED` или нити, ждущие ответа (`waitingThreads`,
   `src/renderer/canvas/badges/review-threads.ts:16`), → `addressComments`. Отказ с причиной: PR не пользователя, из fork, закрыт; шаблон пуст (tooltip
   говорит, где его задать — «Project settings…»); экран read-only. Её читают Ticket-ы 04 и 05 и main.
4. Перенос в `src/shared` (обязательно): `waitingThreads` (`src/renderer/canvas/badges/review-threads.ts:16`) и
   `ticketOfRow` (`src/renderer/pr-inbox/usePrInbox.ts:180`) — в новый модуль `src/shared` (например
   `src/shared/pr-inbox/rows.ts`). `src/shared` не импортирует `src/renderer` (`eslint.config.js:24`), а main не может
   взять `usePrInbox.ts`: он тянет react, zustand и ipc renderer-а, и `tsconfig.node.json` не включает `src/renderer`.
   Оба renderer-файла импортируют функции из нового модуля; поведение Ticket Node и Pull requests не меняется.
5. Hook состояния кнопки `usePrFollowState(projectId, row, action)` в `src/renderer/canvas/actions/gates.ts` рядом с
   `useShipTicketState` (`:43-48`): шаблон из `useActionTemplates`, строка PR, экран read-only → `ActionState`.
   Ticket-ы 04 и 05 берут его и своей копии не пишут.
6. `isCrossRepository` в `PULL_FIELDS`, разборе и строке PR inbox (`src/main/github/inbox.ts:69-77`, `:137`, `:172`;
   `src/shared/ipc/pr-inbox.ts:55-89`); старый snapshot без поля читается как `false`.
7. Канал `actions.prFollow` в `src/shared/ipc/actions.ts` рядом с `actionsPrReply` (`:86-103`):
   `{ projectId, repo, pr, action, near? }` → `{ nodeId, sessionId, text, delivery: 'sent' | 'queued' | 'new' }`,
   `project`, `write`. Обработчик — `src/main/ipc/actions.ts:22-29`; зависимости launcher-а (PrInbox, NodeSessions,
   Binding-и) — в `LaunchDeps` (`src/main/actions/launch.ts:68`) и `sharedLauncher` (`src/main/ipc/actions.ts:41-55`).
8. `prFollow()` в `src/main/actions/launch.ts`:
   - свежее чтение: `PrInbox.refresh`, затем строка из `snapshot`; причина из функции 3 по свежей строке; её нет —
     отказ «CI is no longer failing on <sha>» и так далее; `{sha}` — текущий `headRefOid`. `refresh` пропускает аккаунт на паузе rate limit
     (`src/main/github/inbox.ts:368`, `:373-374`): строка тогда старая, и это принято — skill сам сверяет head (Ticket
     02, шаг 1);
   - отказы: пустой шаблон; идёт Autopilot (`AUTOPILOT_RUNNING_HINT`, как `runWave` — `:264`); Orchestrator с
     Binding-ом на Epic этого Ticket-а `busy` (его Wave сама чинит свои PR, `harness/skills/epic-wave/SKILL.md:520`);
     PR не пользователя, из fork или закрыт;
   - маршрут, шаг 1: Session Node Project-а с Binding-ом manual или launch на Ticket этого PR (Ticket — по строкам
     `PR:` или ветке, как `ticketOfRow`, `src/renderer/pr-inbox/usePrInbox.ts:180`), Vendor Claude Code, не в архиве,
     `lastAt` моложе 24 часов (Q7). `NodeSessions.started`, затем `Session.send` (`sent` или `queued`) и
     `Session.notice` «worfy: <Action> for owner/web#118 sent to this Session». Свой путь продолжения не писать;
   - маршрут, шаг 2: иначе новая Session Node на Claude Code (`PR_REPLY_VENDOR`,
     `src/shared/projects/action-templates.ts:156`) с `near`, текст — первое сообщение, Binding launch на Ticket PR-а,
     если он есть (`bindWhenKnown`); `delivery: 'new'`.
9. Английская страница `docs/features/projects.md` (шаблоны и плейсхолдеры, `:334-338`): три шаблона, `{sha}`,
   маршрут и отказы. Перевод — Ticket 06.

## Готово, когда

- [ ] Unit test (`test/unit/action-templates.test.ts`): три действия, подписи, шаблоны плагина, пустые шаблоны старого
      Harness; settings без новых полей читаются с шаблонами по умолчанию.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Unit test (`test/unit/render-template.test.ts`): `{sha}` из 40 hex рендерится; короче, длиннее, с пробелом или
      переводом строки — отказ; `prFollowState` с пустым шаблоном — отказ с подсказкой.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Unit test (новый `test/unit/pr-follow.test.ts`): причины и порядок — `DIRTY` первым, затем `failing`, затем
      замечания; чужой PR, PR из fork, закрытый PR — отказ с причиной.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Unit test (`test/unit/project-settings-shell.test.tsx`): в Project settings — три новых поля.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Unit test hook-а `usePrFollowState`: пустой шаблон, read-only и причина отказа функции — кнопка неактивна с
      причиной; test-ы `test/unit/review-threads-badge.test.tsx` и `test/unit/pr-inbox-view.test.tsx` зелёные после
      переноса функций в `src/shared`.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Contract test (`test/contract/actions.test.ts`): Session Node с Binding-ом launch на Ticket и `lastAt` 23 ч —
      текст уходит в неё (`sent`; во время хода — `queued`; без процесса — после продолжения через
      `NodeSessions.started`), есть notice-строка; `lastAt` 25 ч или Session на Codex — новая Session Node (`new`) с
      Binding-ом launch.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Contract test: отказ при Autopilot, при `busy` Orchestrator-е Epic-а Ticket-а, для PR из fork и чужого PR;
      `{sha}` в тексте — head свежего чтения, а не head прошлого snapshot-а.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Contract test: Linked machine с доступом read-only получает отказ (`write`).
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · a57442e1608790945c69189a61f46005395933bd
- [ ] Английская страница `docs/features/projects.md` описывает три действия, `{sha}` и маршрут.
  - evidence: commit pass · worfy-pr-follow/01: Fix checks, Resolve conflicts and Address comments in main · - - · a57442e1608790945c69189a61f46005395933bd
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44333073670/job/134921886284 · ci - · cfb3853686ea78cd0b90c78848c28c4f3f9a2493

## Где в коде

- `src/shared/projects/action-templates.ts`
- `src/shared/actions/render-template.ts`
- `src/shared/actions/pr-follow.ts` (новый), `src/shared/pr-inbox/rows.ts` (новый, имя — предложение)
- `src/renderer/canvas/badges/review-threads.ts`, `src/renderer/pr-inbox/usePrInbox.ts` (импорт из `src/shared`)
- `src/renderer/canvas/actions/gates.ts` (`usePrFollowState`)
- `src/shared/ipc/actions.ts`, `src/shared/ipc/pr-inbox.ts`
- `src/main/actions/launch.ts`
- `src/main/ipc/actions.ts`
- `src/main/github/inbox.ts`
- `src/main/projects/settings.ts`
- `test/unit/action-templates.test.ts`, `test/unit/render-template.test.ts`, `test/unit/pr-follow.test.ts` (новый),
  `test/unit/project-settings-shell.test.tsx`, `test/contract/actions.test.ts`
- `docs/features/projects.md`

Только читать: `src/main/agent/node-sessions.ts`, `src/main/agent/session.ts`, `src/main/agent/continuity.ts`,
`src/main/layout/archive.ts`, `src/shared/binding/resolve.ts`, `src/renderer/shell/ProjectSettings.tsx`.

## Вне скоупа

- Кнопки в Pull requests — Ticket 04; Ticket Node и Command palette — Ticket 05; skill — Ticket-ы 02 и 03.
- PR watch и шаг маршрута «Session, которая уже следит за PR» — часть 2.

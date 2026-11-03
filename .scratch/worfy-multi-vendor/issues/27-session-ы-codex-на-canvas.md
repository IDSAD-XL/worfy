# 27 — Session-ы Codex на Canvas

Type: task
Status: done 2026-11-03T11:06Z
PR: #1284
Blocked by: 22, 23, 24
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 7, «Windows» (пути), «Решено без владельца», п. 9; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 05 ([05-codex-транскрипты.md](05-codex-транскрипты.md)); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Session-ы Claude Project-а, начатые вне worfy, находит registry транскриптов (`src/main/claude-home/registry.ts`,
  `projectDirName` `:51`, `isInsidePath` `:80`) и показывает Node-ами (`src/renderer/claude-home/session-nodes.ts`).
- Канал — `claudeHome.*` (`src/shared/ipc/claude-home.ts`, `src/main/ipc/claude-home.ts`).
- У Codex папок по `cwd` нет; список даёт `history.list(cwd)` Ticket-а 22.

## Что делаем

1. `src/main/vendors/codex/sessions-on-canvas.ts`: Session-ы Codex Project-а — `history.list` по корню Project-а и
   его worktree; `cwd` сравнивается через `isInsidePath` (без учёта регистра на Windows).
2. Канал `claudeHome.*` отдаёт и Session-ы Codex с полем `vendor`; Node — со значком Vendor-а (Ticket 24),
   транскрипт — `history.read`.
3. Resume такой Node — Session Codex через driver; Session, начатая в терминале, — с подтверждением «This Session may
   be open in a terminal».
4. Обновление списка — опрос не чаще раза в 30 s, пока окно Project-а открыто (у Codex нет файла живых Session-ов).
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/27/`.

Платформенный: пути и сравнение путей.

## Готово, когда

- [ ] Contract test (фейк, `threads`): thread-ы с `cwd` в Project-е и в его worktree — найдены; чужой `cwd` — нет;
      `cwd` Windows с другим регистром — найден (test на правиле пути).
- [ ] e2e: Node Session Codex из терминала с транскриптом; Resume спрашивает подтверждение и продолжает thread.
- [ ] Снимки обеих тем в `evidence/27/`.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы `claude-home` и e2e spec — exit 0.

## Где в коде

- `src/main/vendors/codex/sessions-on-canvas.ts` (новый)
- `src/main/ipc/claude-home.ts`; `src/shared/ipc/claude-home.ts`
- `src/renderer/claude-home/session-nodes.ts`, `src/renderer/claude-home/useClaudeHome.ts`
- `test/contract/codex-sessions-on-canvas.test.ts`, `test/e2e/codex-sessions-on-canvas.spec.ts` (новые),
  `scripts/e2e-specs.table.json`

Только читать: `src/main/claude-home/registry.ts:51`, `:80`.

## Итог

- `src/main/vendors/codex/sessions-on-canvas.ts`: `codexProjectSessions` — `history.list` driver-а Codex по корню
  Project-а и по каждому worktree вне его (worktree внутри корня уже в списке корня), каждый thread один раз, новые первыми;
  `cwd` сравнивается через `isInsidePath` (на Windows — любой разделитель, без учёта регистра). `CodexSessionsOnCanvas`
  спрашивает Codex не чаще раза в 30 s на Project (`CODEX_SESSIONS_POLL_MS` в `src/shared/ipc/claude-home.ts`), ключ — корень
  в любом написании. Нет папки Codex home — Codex не спрашивается, опроса нет. Codex не ответил — список остаётся прежним,
  причина один раз в log, опрос окна выключается; toast-а нет. Ответ не ждёт Codex совсем (раунд 2): `claudeHome.sessions`
  отдаёт часть Claude и последний известный список Codex (в первый раз пустой), а запрос к Codex идёт в фоне. Пока первый
  запрос Project-а не ответил, ответ несёт `codexLoading: true`, и окно спрашивает снова через 2 s
  (`CODEX_LOADING_RETRY_MS`), так что thread-ы видны через несколько секунд после открытия окна, а не через 30 s.
  Правило Resume ждёт текущий запрос (`settled`): Resume и так запускает Codex.
- Канал `claudeHome.sessions` добавляет thread-ы Codex в `history` с `vendor: 'codex'` и `origin`, и `codex: true`, пока
  Codex отвечает; без Codex ответ прежний, только Claude. `claudeHome.transcript` для Session, которой нет в Claude home,
  читает thread Codex (`history.read`) — только thread из последнего списка этого Project-а.
- Окно (`useClaudeHome.ts`) при `codex: true` спрашивает список заново каждые 30 s, пока Project открыт.
- Node: thread, начатый вне worfy и изменённый за последние 10 min (`CODEX_ACTIVE_MS`), получает read-only Node сам
  (`activeCodexSessions`, `planSessionNodes`); `data.vendor: 'codex'`. На Node — значок Codex, кнопка Resume под строкой
  папки, вопрос «This Session may be open in a terminal» с Cancel и «Resume anyway». Resume — `sessions.resume`: main берёт
  Vendor из `data.vendor` Node-а и продолжает thread через driver на live Node на месте read-only.
- Session view thread-а: значок Codex после заголовка, ответы подписаны `codex`, chip `unknown`.
- History: строки Codex «terminal · Codex» / «worfy · Codex»; Show ставит Node с Vendor-ом; Resume — вопрос, Node, затем
  `sessions.resume`.
- Правило Resume для Codex (`src/main/agent/app-node-sessions.ts`) берёт тот же список, что Canvas, вместо своего
  `history.list` только корня: thread из worktree вне корня теперь тоже продолжается, и Resume не запускает лишний Codex.
- Снимки обеих тем: [Node](../evidence/27/27-codex-node-light.png) ([тёмная](../evidence/27/27-codex-node-dark.png)),
  [транскрипт](../evidence/27/27-codex-transcript-light.png) ([тёмная](../evidence/27/27-codex-transcript-dark.png)),
  [вопрос Resume](../evidence/27/27-codex-resume-question-light.png) ([тёмная](../evidence/27/27-codex-resume-question-dark.png)),
  [после Resume](../evidence/27/27-codex-resumed-light.png) ([тёмная](../evidence/27/27-codex-resumed-dark.png)).
- `scripts/e2e-specs.table.json` не менялся: `sessions-on-canvas.ts` вызывает каждое окно через `claudeHome.sessions`,
  правила «только этот spec» у него нет — по правилу таблицы путь остаётся вне её (весь набор).
- Платформенный PR (ADR-0056 п. 2, ADR-0071): вердикт Windows — job CI.

Решено без владельца, подтвердить:

1. Node сам появляется только у thread-а, изменённого за последние 10 min; старые thread-ы — в History (Show, Resume).
   Иначе Project с сотнями старых thread-ов засыпал бы Canvas.
2. Chip Node-а и Session view thread-а Codex — `unknown`: Codex не говорит, работает ли thread.
3. Вопрос перед Resume — и для thread-а с неизвестным `origin`; без вопроса — только thread, начатый в worfy.
4. Ответ `claudeHome.sessions` не ждёт Codex; пока первый запрос к Codex идёт, окно спрашивает снова каждые 2 s
   (`codexLoading`, `CODEX_LOADING_RETRY_MS`), до ответа Codex или его отказа (не дольше времени запроса, 30 s на
   страницу).
5. Resume и вопрос — и в History, не только на Node (тикет называет Node); строка Codex не спрашивает вердикт main.
6. Вне «Где в коде» правлены: `src/main/agent/app-node-sessions.ts`, `src/renderer/canvas/overlays/SessionNodes.tsx`,
   `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/session/HistoryPopover.tsx`,
   `src/renderer/session/ExternalSessionPanel.tsx`, `docs/features/sessions.md` — без них Node, Resume и транскрипт
   не работали бы.

# 25 — Переключатель в Session view прячет tool calls в Transcript

Type: task
Status: claimed 2026-10-23T02:45Z
Blocked by: —
Source: просьба владельца 2026-10-23: «когда модель … выполняет, допустим, bash, есть небольшая
сноска с event-ом … edit или bash или agent. Они довольно много спамят … переключатель, который
скрывает подобное сообщение, оставляя просто [текст]». Владелец принял все пять пунктов
(раздел «Что делаем»). Идёт раньше Ticket-а 22 (виртуализация Transcript): оба меняют
`Transcript.tsx`, и 22 строит виртуализацию уже на строках с этим переключателем.

## Что происходит

- Transcript Session рисует каждый tool call отдельной строкой: имя tool, команда или файл,
  статус ✓, «error» или «running» (`src/renderer/session/Transcript.tsx`, `ToolRow` и
  `ToolStatus`; по main `2a83dd55`). Подряд идущие tool calls `foldTranscript`
  (`src/renderer/session/fold.ts`) собирает в один элемент `kind: 'tools'`, но каждый call в нём —
  своя строка.
- У Orchestrator-а за ход десятки Bash, Read, Edit: текст ответа теряется между ними. Спрятать их
  нельзя — переключателя нет ни в Session view живой Session (`SessionView.tsx`, `SessionPanel`),
  ни в Session view внешней Session и Subagent-а (`ExternalSessionPanel.tsx`).

## Что делаем

Решения владельца 2026-10-23.

1. **Кнопка в шапке Session view** — «Hide tools»: кнопка-иконка с этим именем в `aria-label` и
   tooltip, нажата (`aria-pressed`), пока tools спрятаны. Иконка, а не слово: при ширине окна по
   умолчанию слово выталкивало Interrupt за край шапки. Заголовок шапки теперь обрезается
   многоточием, когда места мало, а кнопки справа — нет. Выбор запоминается
   для каждой Session отдельно и переживает повторное открытие Session и перезапуск worfy.
   - **Где хранится:** `localStorage` окна worfy, ключ `worfy.transcript.hideTools:<projectId>/<nodeId>`,
     для Subagent-а — `…/<nodeId>/<agentId>`. Хранится только «спрятано»; «показано» — отсутствие ключа.
   - **Почему так.** Это вид экрана, а не настройка агента: Claude Code его не читает, другим
     экранам он не нужен. Поэтому не `session-settings.json` через `useSessionControls` — там модель,
     effort и permission mode, которые main передаёт Claude Code. Не `app-settings.json` — там
     настройки всего Machine, а не одной Session. Не Layout — он общий для всех экранов Project, и на
     read-only экране (worfy-link) запись в него закрыта. `localStorage` renderer-а лежит в userData,
     а userData — папка данных worfy (`src/main/index.ts`, `app.setPath('userData', dataRoot())`),
     так что ADR-0005 соблюдён. Ключ — Node Session (одна Session — один Node, `CONTEXT.md`), как
     у `session-settings.json`: ключ есть сразу, до того как Claude Code назовёт id своей Session, и
     одна и та же Session, открытая живой и read-only, помнит один выбор. Чтение и запись — в
     `try/catch`: недоступное хранилище даёт «показано» и не ломает view.
2. **Что видно, когда tools спрятаны.** Tool call с ошибкой остаётся как есть. Обычные calls одной
   серии (элемент `tools` из `fold.ts` — calls подряд, без других строк между ними) сворачиваются в
   одну тонкую строку «N tools»; клик раскрывает их обычными строками. Пока хоть один call серии
   ещё идёт, строка «N tools» показывает общий «running» вместо статуса каждого call.
3. **Прячутся только tools.** Строки Subagent-ов — и отдельная строка `subagent`, и tool call
   Agent/Task, который запустил Subagent, — hook-и, thinking, permission requests и вопросы
   (строки `extension`, `src/renderer/session/rows/`) остаются как есть.
4. **Во всех Session view с Transcript:** живая Session (`SessionView.tsx`) и
   `ExternalSessionPanel.tsx` (внешние Session-ы и Subagent-ы).
5. Epic `worfy-ui`; раньше Ticket-а 22.

## Готово, когда

- [ ] Кнопка «Hide tools» в шапке обоих Session view; tooltip говорит, что она делает и что
      выбор запоминается для этой Session.
- [ ] Спрятанный режим: call с ошибкой виден, обычные calls серии — одна строка «N tools»,
      клик раскрывает её, «running» — пока идёт хоть один call серии.
- [ ] Subagent, hook, thinking, permission request и вопрос рисуются как без переключателя.
- [ ] Выбор свой у каждой Session и переживает повторное открытие Session и перезапуск worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e `test/e2e/session-view.spec.ts` — exit 0.

## Тесты

- Unit (`test/unit/transcript-hide-tools.test.tsx`, новый): call с ошибкой остаётся, число в «N tools»,
  раскрытие по клику, Subagent/hook/thinking/permission request не меняются, «running» строки,
  выбор для разных Session-ов не смешивается и читается после повторного монтирования.
- E2e в `test/e2e/session-view.spec.ts`: кнопка прячет строки tool calls, строка «N tools»
  раскрывается, выбор переживает перезапуск worfy с той же папкой данных.

## Где в коде

- `src/renderer/session/Transcript.tsx`
- `src/renderer/session/fold.ts`
- `src/renderer/session/transcript-view.ts` (новый)
- `src/renderer/session/HideToolsButton.tsx` (новый)
- `src/renderer/session/SessionView.tsx`
- `src/renderer/session/ExternalSessionPanel.tsx`
- `src/renderer/session/session.css`
- `src/shared/transcript/subagents.ts` (экспорт имён tool, который запускает Subagent)
- `test/unit/transcript-hide-tools.test.tsx` (новый)
- `test/e2e/session-view.spec.ts`

## Итог

- Кнопка-иконка «Hide tools» (`HideToolsButton.tsx`) стоит в шапке живой Session
  (`SessionView.tsx`, перед Interrupt) и в шапке внешней Session и Subagent-а
  (`ExternalSessionPanel.tsx`); `Transcript` получает `hideTools`.
- `splitTools` (`fold.ts`) делит серию: call с ошибкой и call Agent/Task или с Subagent-ом остаются
  видны; остальные — одна строка «N tools» (`FoldedTools` в `Transcript.tsx`) с общим «running».
- Выбор — `localStorage`, ключ по Project и Node, у Subagent-а ещё `agentId` (`transcript-view.ts`).
  Другие окна worfy узнают о смене по событию `storage`; при ошибке записи выбор держится в окне.
- Заголовок шапки Session view обрезается многоточием (полный текст — в tooltip), когда места мало:
  при окне 1280 px шапка Orchestrator-а показывает «Orchestrator · …», зато Interrupt не
  уходит за край.
- Test-ы: 12 unit в `test/unit/transcript-hide-tools.test.tsx`, e2e ««Hide tools» folds…» в
  `test/e2e/session-view.spec.ts` (прячет, раскрывает, выбор переживает перезапуск, Interrupt не
  обрезан). Mutation testing: 9 мутантов unit и 3 мутанта e2e — все красные.
- Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; e2e `session-view`,
  `own-sessions`, `new-session`, `session-back` — 10 passed; gate fast — `[gate] green (fast)`.


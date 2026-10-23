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
   умолчанию слово выталкивало Interrupt за край шапки. Когда места в шапке мало, первым
   обрезается многоточием имя модели, заголовок — только если и этого мало; кнопки справа — никогда.
   Выбор запоминается
   для каждой Session отдельно и переживает повторное открытие Session и перезапуск worfy.
   - **Где хранится:** `localStorage` окна worfy, ключ `worfy.transcript.hideTools:session:<SDK session id>`,
     для Subagent-а — `…/<agentId>`; пока id Session не известен — `…:node:<projectId>/<nodeId>`. Хранится только «спрятано»; «показано» — отсутствие ключа.
   - **Почему так.** Это вид экрана, а не настройка агента: Claude Code его не читает, другим
     экранам он не нужен. Поэтому не `session-settings.json` через `useSessionControls` — там модель,
     effort и permission mode, которые main передаёт Claude Code. Не `app-settings.json` — там
     настройки всего Machine, а не одной Session. Не Layout — он общий для всех экранов Project, и на
     read-only экране (worfy-link) запись в него закрыта. `localStorage` renderer-а лежит в userData,
     а userData — папка данных worfy (`src/main/index.ts`, `app.setPath('userData', dataRoot())`),
     так что ADR-0005 соблюдён. Ключ — SDK session id: одна Session помнит один выбор, где бы её ни
     открыли (живой на Node, read-only, из Command palette с Node `session:<id>`), а «New
     conversation» на том же Node — новая Session, у неё tools снова видны. У живой Session это её
     id, а пока он временный (`pending-…` у возобновлённой, до system/init) — id, который она
     возобновляет. Чтение и запись — в
     `try/catch`: недоступное хранилище даёт «показано» и не ломает view.
2. **Что видно, когда tools спрятаны.** Tool call с ошибкой остаётся как есть, на своём месте в серии
   (элемент `tools` из `fold.ts` — calls подряд, без других строк между ними). Он делит серию на
   участки: каждый участок обычных calls — своя тонкая строка «N tools» на своём месте (Bash ✓,
   Edit ✗, Grep ✓ — «1 tool», Edit, «1 tool»); клик раскрывает её обычными строками. Пока хоть один
   call участка ещё идёт, строка показывает общий «running» вместо статуса каждого call. Call, чей
   результат пришёл с ошибкой, выходит из строки, и N уменьшается.
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
- `test/fixtures/agent-scripts/hide-tools.jsonl` (новый)
- `test/unit/transcript-hide-tools.test.tsx` (новый)
- `test/e2e/session-view.spec.ts`

## Итог

- Кнопка-иконка «Hide tools» (`HideToolsButton.tsx`) стоит в шапке живой Session
  (`SessionView.tsx`, перед Interrupt) и в шапке внешней Session и Subagent-а
  (`ExternalSessionPanel.tsx`); `Transcript` получает `hideTools`. Нажатая кнопка — с рамкой и иконкой
  цвета `--accent` в обеих темах.
- `toolSegments` (`fold.ts`) делит серию по порядку: call с ошибкой и call Agent/Task или с
  Subagent-ом остаются видны на своём месте, каждый участок обычных calls между ними — своя строка
  «N tools» (`FoldedTools` в `Transcript.tsx`) с общим «running».
- Выбор — `localStorage`, ключ по SDK session id, у Subagent-а ещё `agentId`
  (`transcript-view.ts`). Другие окна worfy узнают о смене по событию `storage`; при ошибке записи
  выбор держится в окне.
- `Transcript` в `SessionPanel` получил `key` по id Session: при показе другой Session раскрытые
  строки «N tools» не остаются раскрытыми. Это же чинит прежнюю ошибку `Disclosure` (thinking, hook,
  notice): строки ключены по позиции `e<N>`, и раскрытая строка одной Session оставалась раскрытой у
  строки с той же позицией в другой.
- Шапка при нехватке места: первым обрезается имя модели (полное — в tooltip), заголовок — только
  если этого мало. При окне 1280 px «Orchestrator · alpha» виден целиком, Interrupt — внутри шапки.
- Test-ы: 13 unit в `test/unit/transcript-hide-tools.test.tsx`; e2e ««Hide tools» folds…» в
  `test/e2e/session-view.spec.ts` на скрипте `hide-tools.jsonl` (Bash ✓, Edit ✗, Grep ✓): порядок
  «1 tool», Edit, «1 tool», раскрытие, заголовок и Interrupt при 1280 px, выбор после перезапуска у
  той же Session, «New conversation» начинает с видимыми tools. Mutation testing: 12 мутантов unit и
  6 мутантов e2e за два круга — все красные.

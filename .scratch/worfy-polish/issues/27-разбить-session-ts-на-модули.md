# 27 — Разбить `src/main/agent/session.ts` на связные модули, без изменения поведения

Type: task
Status: done 2026-10-17
PR: #422
Blocked by: —
Source: решение владельца 2026-10-16 («со всем согласен») по долгу из `HANDOFF.md` («Сейчас в работе»,
`worfy-week`: «долг: `src/main/agent/session.ts` 1077 строк»); файл перерос 1000 строк в
[PR #345](https://github.com/IDSAD-XL/worfy/pull/345) (`worfy-week` 20).

## Что происходит

- `src/main/agent/session.ts` — 1077 строк на main `274c7eb`. Gate печатает предупреждение для файла,
  который diff перевёл через 1000 строк (`harness/hooks/gate.mjs:17-22`, `FILE_LINES_MAX` — `:347`).
  Вердикт оно не меняет, но каждый следующий Ticket, который трогает `session.ts`, читает и правит
  файл целиком.
- В файле пять разных частей:
  - типы границы с SDK — `AccountInfoLike`, `ModelInfoLike`, `ClaudeCodeProcess`, `QueryHandle`,
    `QueryRequest`, `QueryFactory`, `EventSink`, `SessionInfo`, `SessionControls` (`:91-193`);
  - модели и настройки — `modelOptions`, `mergeSettings`, `USER_MODEL_FALLBACK` (`:195-219`);
  - `InputQueue` — async iterable, в который Session кладёт сообщения (`:220-258`);
  - процесс Claude Code — `STDERR_KEEP`, `HALT_TURN_MS`, `EXIT_WAIT_MS`, `KILL_EXIT_MS`, `exitOf`,
    `within`, `Run`, `pushSettings` (`:260-336`);
  - класс `Session` (`:338-967`) и `SessionRegistry` (`:968-1077`).
- Из `session.ts` импортируют 31 файл в `src/` и `test/` (`grep -rln "from '.*agent/session'" src test`).
- Рядом уже есть `src/main/agent/session-settings.ts` (режим attended/unattended) — новые имена с ним
  не должны совпасть.

## Что делаем

1. **Вынести части без поведения** в свои модули в папке `src/main/agent/session/`: типы границы с
   SDK, модели и настройки, `InputQueue`, помощники процесса, `SessionRegistry`. Имена файлов —
   выбор исполнителя; каждая часть — одна тема.
2. **`session.ts` остаётся точкой входа**: класс `Session` и реэкспорт всего, что импортируют 31
   файл. Импорты в `src/` и `test/` не меняются (или меняются механически, одним commit-ом).
3. **Ни одной правки логики.** Перенос строк как есть; комментарии переезжают вместе с кодом.
   Комментарий в начале `session.ts` (`:1-54`) остаётся в нём, к новым модулям — по 1–3 строки.
4. **Цель по размеру:** каждый файл папки и `session.ts` — меньше 1000 строк; gate fast на ветке
   не печатает `[gate] warning: file over 1000 lines` для `session.ts`.

## Готово, когда

- [x] `wc -l src/main/agent/session.ts src/main/agent/session/*.ts` — каждый меньше 1000.
- [x] Ни одного изменения ожиданий в `test/`: `git diff origin/main -- test/` пуст или содержит только
      пути импортов.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.
- [x] В «Итог» — таблица «что куда переехало» со строками до и после.

## Тесты

Новых test-ов нет: поведение не меняется. Доказательство — существующие contract test-ы Session
(`test/contract/agent-session.test.ts`, `agent-controls.test.ts`, `agent-events.test.ts`,
`agent-context-usage.test.ts`, `agent-autocompact.test.ts`, `orchestrator.test.ts`,
`orchestrator-relaunch.test.ts`, `permissions.test.ts`) зелёные без правок ожиданий.

## Где в коде

- `src/main/agent/session.ts`
- `src/main/agent/session/`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): файлы, которые импортируют
`session.ts`, если реэкспорт сохраняет их импорты.

## Вне скоупа

- Любая правка поведения Session, даже очевидная. Найденное — строкой в «Итог», отдельным Ticket-ом.
- Другие большие файлы (`src/renderer/session/session.css` — 1105 строк, предупреждение gate в
  `worfy-ui` 09).

## Итог

`session.ts` разбит на пять модулей в `src/main/agent/session/`; в `session.ts` остались комментарий
в начале, класс `Session`, два помощника `inTurn` и `messageOf` и реэкспорт. Логика не тронута:
строки перенесены `sed -n` по диапазонам исходного файла, добавлены только импорты, слово `export` у
символов, которые раньше были локальными, и комментарий в 1–3 строки в начале каждого модуля.

| Что | Было (`session.ts` на `e6f0ba76`) | Стало |
| --- | --- | --- |
| Комментарий модуля | `session.ts:1-54` | `session.ts:1-54` |
| `inTurn`, `messageOf` | `session.ts:302-305` | `session.ts:109-112` |
| Класс `Session` | `session.ts:338-966` | `session.ts:114-742` |
| Типы границы: `AccountInfoLike`, `ModelInfoLike`, `ClaudeCodeProcess`, `QueryHandle`, `QueryRequest`, `QueryFactory`, `EventSink`, `InputListener`, `SessionInfo`, `SessionControls` | `session.ts:91-192` | `session/types.ts:10-111` |
| Модели и настройки: `DEFAULT_MODEL_VALUE`, `isEffort`, `USER_MODEL_FALLBACK`, `modelOptions`, `mergeSettings` | `session.ts:194-218` | `session/models.ts:5-29` |
| `InputQueue` | `session.ts:220-258` | `session/input-queue.ts:3-41` |
| Процесс Claude Code: `HALT_TURN_MS`, `EXIT_WAIT_MS`, `KILL_EXIT_MS`, `hasExited`, `exitOf`, `within` | `session.ts:262-300` | `session/process.ts:5-43` |
| Живой query: `STDERR_KEEP`, `Run`, `pushSettings` | `session.ts:260`, `:307-336` | `session/run.ts:7-38` |
| `SessionRegistry` | `session.ts:968-1077` | `session/registry.ts:10-119` |

Размеры: `session.ts` — 742 строки (было 1077), модули — от 29 до 119 строк.

Как проверено, что при переносе ничего не потерялось:

- **Экспорты `session.ts`** до и после — список через TypeScript checker (имя, вид, тип значения):
  17 одинаковых строк, `diff` пуст. Импорты 36 файлов в `src/` и `test/` не менялись,
  `git diff origin/main -- test/` пуст.
- **Строки кода:** отсортированные строки исходного файла сравнены с отсортированными строками
  `session.ts` и `session/*.ts` вместе (без префикса `export `). Из исходного пропали только пять
  строк списков импорта (`EFFORT_LEVELS`, `isMainOnlyEvent`, `EffortChoice`, `PermissionModeChoice`,
  `CommandInfoLike`) — эти имена теперь импортируют модули, которым они нужны. Добавлены только
  импорты, реэкспорт, заголовки модулей и одна пустая строка.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (269 файлов, 5718 test-ов) — exit 0; `pnpm build` —
  exit 0, без предупреждений о циклических импортах.

Решено без владельца, подтвердить:

- `inTurn` и `messageOf` остались в `session.ts`: это однострочные помощники самого класса `Session`,
  к процессу Claude Code они не относятся.
- `session/registry.ts` импортирует `Session` из `../session`, а `session.ts` реэкспортирует
  `SessionRegistry` — циклический импорт. Он безопасен: `SessionRegistry` обращается к `Session`
  только внутри `start()`, не при загрузке модуля. Убрать цикл можно было бы только переносом класса
  `Session` в папку, а Ticket оставляет его в `session.ts`.
- Для Ticket-а 29 (порядок `autoCompactWindow`): окно автокомпакта выбирает `app-registry.ts` по
  `QueryRequest.orchestrator`; поле объявлено в `session/types.ts`, заполняется в `Session.begin()`
  (`session.ts`). Имена не менялись.

Owner accepted these decisions on 2026-10-18.

**Ревью и merge (2026-10-17).** Круг 1 — `VERIFIED` без находок
([вердикт](https://github.com/IDSAD-XL/worfy/pull/422#issuecomment-6229565623)); gate full на Mac
зелёный, merge `8bf48ed2`.

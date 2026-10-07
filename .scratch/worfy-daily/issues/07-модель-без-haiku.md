# 07 — Модель: без haiku, минимум sonnet; Orchestrator на модели пользователя

Type: task
Status: done — 2026-10-06, [PR #44](https://github.com/IDSAD-XL/worfy/pull/44)
Blocked by: 05, 29
Source: [spec.md](../spec.md), тема B; [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md), раздел «Решение» (абзац про модель); Ticket 19 worfy-mvp (выбор модели)

## Что делаем

**Откуда сейчас берётся список моделей.** Из SDK. `Session.models()` (`src/main/agent/session.ts:335`)
вызывает `query.supportedModels()`. При ошибке или пустом списке остаётся одна строка — из
init-модели или `settings.model` (`:343`). `modelOptions()` (`:111`) превращает
`DEFAULT_MODEL_VALUE` в `null`. Renderer показывает список в
`src/renderer/session/composer/Pickers.tsx`: загрузка — `:27` и `:31`; сохранённая модель, которой
нет в списке, показывается отдельной строкой — `:56`. Своего списка моделей в коде нет. Слово
haiku встречается только в комментарии `src/shared/agent/settings.ts:40`.

**Правило «минимум sonnet».** Одна функция в `src/shared/agent/settings.ts`: по значению или имени
модели из SDK говорит, можно ли её выбрать. Модели семейства haiku — нельзя. `modelOptions()`
применяет правило в main.

**Сохранённая haiku у Node-а.** Если модель выбрана раньше, при старте Session она заменяется
моделью по умолчанию. Effort сбрасывается, как при переключении на модель без effort
(`Pickers.tsx:62-64`).

**Модель по умолчанию — модель пользователя.** `model: null` значит, что SDK возьмёт модель из
`settings.json` пользователя (`src/main/agent/options.ts:85` ставит модель, только если она не
`null`). Закрепить test-ом: новый Orchestrator и новая Session без выбора пользователя стартуют с
`model: null`.

**haiku в `settings.json` пользователя.** Правило «минимум sonnet» действует и здесь, иначе
Orchestrator в Autopilot стартует на haiku, и сказать об этом некому. Как это работает:

- Модель пользователя читает `src/main/claude-home/user-model.ts` (новый): поле `model` из
  `<claudeHome>/settings.json` (`claudeHome()`, `src/main/storage/paths.ts:19`). Только чтение.
  Нет файла, нет поля или JSON не разобрался — ответ `null`.
- Если у Session `model: null`, а модель пользователя — haiku, Session передаёт SDK явную модель
  `sonnet`. Подстановка делается в `session.ts` при старте запроса и только в настройках запроса к
  SDK. Сохранённый выбор Node-а остаётся `null`.
- `settings.json` пользователя worfy не переписывает: в `~/.claude` worfy не пишет (ADR-0005).
- `options.ts` не меняется. Его в той же Wave меняет Ticket 06.
- Отдельного предупреждения в UI нет, поэтому нет и нового канала IPC.

**Subagent-ы наследуют модель Session.** worfy модель Subagent-ам не задаёт. Это проверяется вживую.
Исключение — Subagent, у которого модель задана в его определении; это часть Harness и решается в
E3.

**fake-агент.** Добавить haiku без efforts в `FAKE_MODELS` (`src/main/agent/fake-query.ts:63`),
чтобы фильтр было видно в test-ах.

**Что известно из ручной проверки 2026-10-06, ночь** (проверка 22, Ticket 19 `worfy-mvp`): строка
«Default (recommended)» на живой Session после другой модели переводит её на встроенную модель
Claude Code `claude-opus-5-5`, а не на `opus[1m]` из `settings.json`: worfy зовёт
`query.setModel(undefined)` (`src/main/agent/session.ts:191`). Правит это Ticket 23, не этот: он
берёт `user-model.ts` этого Ticket-а и идёт после него.

## Готово, когда

- [x] В выборе модели нет haiku, даже если SDK её вернул. sonnet и старше — как раньше.
- [x] Node с сохранённой моделью haiku стартует на модели по умолчанию, effort сброшен.
- [x] Новый Orchestrator и новая Session без выбора пользователя стартуют с `model: null`, если в `settings.json` пользователя не haiku.
- [x] Если в `settings.json` пользователя стоит haiku, Session без выбора пользователя стартует с явной моделью `sonnet`. Файл не меняется: test сравнивает дерево временного `WORFY_CLAUDE_HOME` до и после.
- [x] (вручную) Живая Session: модель Subagent-а в его транскрипте совпадает с моделью Session. Итог — в «Итог». Проверено 2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- [x] Снимки Pickers в светлой и тёмной теме сверены с F-SPEC. Сверил проверяющий PR #44 по снимкам e2e в обеих темах (`session-view-light.png`, `session-view-dark.png`, `pickers-*.png`; во временной папке проверки, в репозиторий не входят): расхождений с F-SPEC нет.

## Тесты

- `test/contract/agent-controls.test.ts` — fake-query отдаёт список с haiku, а `agent.models` возвращает его без haiku; сохранённая haiku заменяется на модель по умолчанию; модель по умолчанию — `null`; haiku в `settings.json` временного `WORFY_CLAUDE_HOME` даёт `sonnet` в запросе к fake-query, файл не меняется.
- `test/e2e/session-controls.spec.ts` — в picker-model нет haiku; Node с сохранённой haiku.
- Сначала падающий test: fake-query отдаёт haiku, и picker её показывает.

## Где в коде

- `src/main/agent/session.ts`
- `src/main/claude-home/user-model.ts` (новый)
- `src/shared/agent/settings.ts`
- `src/renderer/session/composer/Pickers.tsx`
- `src/main/agent/fake-query.ts`
- `test/contract/agent-controls.test.ts`
- `test/e2e/session-controls.spec.ts`

## Итог

Влит [PR #44](https://github.com/IDSAD-XL/worfy/pull/44), merge d8be553, без круга доработки. Gate: `GATE_SCOPE=all gate.sh full` — exit 0, `[gate] зелено (full): lint typecheck test test:e2e test:package`.

- **Правило выбора.** `isSelectableModel` / `withSelectableModel` в `src/shared/agent/settings.ts`: всё семейства haiku (по значению, alias или имени) не выбирается. `modelOptions()` убирает строки haiku из `supportedModels()`; запасной список `Session.models()` из модели `system/init` — тоже.
- **Сохранённая haiku.** Node, сохранённый на haiku, стартует на модели по умолчанию со сброшенным effort. Событие `settings` при старте несёт исправленный выбор, и Orchestrator его сохраняет. `agent.configure` с haiku отклоняется: «…: a Session runs on sonnet or a larger model».
- **Модель пользователя.** Новый `src/main/claude-home/user-model.ts` читает `model` из `<claudeHome>/settings.json`, только чтение; нет файла, сломанный JSON или нет поля — `null`. Session с `model: null`, у пользователя которой стоит haiku, просит у Claude Code `sonnet`. Меняется только запрос: настройки Session и сохранённый выбор Node-а остаются `null`, `settings.json` пользователя не пишется (ADR-0005). Модель пользователя читается заново для каждого процесса Claude Code.
- **Не менялись.** `options.ts` (его в той же Wave правит Ticket 06), `Pickers.tsx` и `fake-query.ts`: список фильтрует main, а в `FAKE_MODELS` строка haiku без effort уже была.
- **Test-ы.** `test/contract/agent-controls.test.ts` — список без haiku, правило `modelOptions`, запасной список, сохранённая haiku, `null` по умолчанию при разных `settings.json`, haiku во временном `WORFY_CLAUDE_HOME` даёт `sonnet` в запросе к fake-query при неизменном дереве (байты и mtime), повторное чтение на каждый процесс, нечитаемая модель пользователя, отказ `configure`. `test/e2e/session-controls.spec.ts` — picker без haiku, новый Orchestrator с `model: null`, Orchestrator на haiku стартует на модели по умолчанию, снимки Pickers в двух темах. Мутанты каждого правила в `session.ts` роняют contract test-ы; без правил краснеют оба e2e.
- **Проверено 2026-10-07.** Живая проверка модели Subagent-а — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- **Долги** — в `HANDOFF.md`: `readUserModel()` по умолчанию читает настоящий `~/.claude/settings.json` (с haiku там падают 10 contract test-ов); подстановка `sonnet` сохраняет effort, которого у sonnet может не быть.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (второй круг ручных проверок).

**Агенты workflow-скрипта, MCP-серверы и модели — проверка M18.** Stable copy из 6df9791 (pid 2455,
CDP 9351), Project CanvasForAI, настоящий Claude Code. Это замена проверки «во время Wave Autopilot»:
Orchestrator пока не запускает workflow-скрипты.

- В Profile worfy нет поля `mcp` (exit 4), в выводе main — строка «[profile] MCP servers for
  …/CanvasForAI: the default list (qmd, worfy-canvas), because … no mcp.allowed field (profile exit
  code 4)». Она пишется в stderr (`console.warn`, `src/main/workflow/profile.ts:119-121`).
- Новая Session b5c7b667: Claude Code (pid 18181) запущен с `--managed-settings`, где
  `allowManagedMcpServersOnly` и разрешены только qmd и worfy-canvas.
- `/context`: 12 MCP tools (qmd — 4, worfy-canvas — 8). Всего tools 43 против прежних 634: 31
  отложенный (по записи `deferred_tools_delta`) и 12 загруженных (со слов модели).
- Ход «Agent + workflow-скрипт из двух агентов»: по записи `deferred_tools_delta` самого Claude Code у
  Subagent-а и у обоих агентов workflow-скрипта те же 12 `mcp__`, агенты ответили теми же списками.
  `mcp__github` — 0 во всех транскриптах.
- Модели: у Session, Subagent-а и агентов workflow-скрипта — `claude-opus-5-5` (в attachment модели
  у всех `claude-opus-5-5[1m]`). После выбора Sonnet 5.5 в picker Subagent и агент workflow-скрипта
  тоже ответили на `claude-sonnet-5-5`.
- Canvas: под Node-ом Session — дерево из general-purpose и запуска list-mcp-tools с agent-1 и agent-2.
  Второй запуск снят в состоянии running (sleep-1, running 23s), потом — done 1m 05s. Тот же список —
  в панели Subagents Session view.
- Замечание [low]: в превью Node-а агента workflow-скрипта имя tool-а `mcp__qmd__get` показано как
  «mcpqmdget». `summaryLine` снимает `__x__` как выделение даже внутри слова:
  `src/shared/transcript/subagents.ts:401`. По CommonMark подчёркивания внутри слова выделением не
  считаются.
- Вердикт: проверено. Session закрыта кнопкой Close, процесс Claude Code завершён.
- Снимки: дерево workflow-скрипта во время работы — [17-workflow-agents-session.png](../../worfy-daily/evidence/17-workflow-agents-session.png). Остальное — в scratchpad Session
  Orchestrator-а: `M18-context.png`, `M18-canvas-workflow.png`, `M18-canvas-workflow-done.png`,
  `M18-picker-menu.png`, `M18-session-sonnet.png`, `M18-after-close.png`.

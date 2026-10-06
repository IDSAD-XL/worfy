# 07 — Модель: без haiku, минимум sonnet; Orchestrator на модели пользователя

Type: task
Status: blocked — blocked by 05
Blocked by: 05
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

- [ ] В выборе модели нет haiku, даже если SDK её вернул. sonnet и старше — как раньше.
- [ ] Node с сохранённой моделью haiku стартует на модели по умолчанию, effort сброшен.
- [ ] Новый Orchestrator и новая Session без выбора пользователя стартуют с `model: null`, если в `settings.json` пользователя не haiku.
- [ ] Если в `settings.json` пользователя стоит haiku, Session без выбора пользователя стартует с явной моделью `sonnet`. Файл не меняется: test сравнивает дерево временного `WORFY_CLAUDE_HOME` до и после.
- [ ] (вручную) Живая Session: модель Subagent-а в его транскрипте совпадает с моделью Session. Итог — в «Итог».
- [ ] Снимки Pickers в светлой и тёмной теме сверены с F-SPEC.

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

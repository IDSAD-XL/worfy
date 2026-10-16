# 05 — Compatibility suite: worfy против версий Claude Code и Agent SDK

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-16 («со всем согласен»): идея P0 из draft
[PR #325](https://github.com/IDSAD-XL/worfy/pull/325), раздел «A. P0 candidate: Claude runtime compatibility
and fail-closed regression tests» (`docs/research/2026-10-15-frontier-ai-runtime-ideas.md` на ветке
`research/frontier-ai-agent-runtime-2026-10`, в main нет); Ticket [01](01-рестарт-session-без-повтора-действий-и-правило-обновления-sdk.md)
закрыл из этой идеи только рестарт без повтора действий и правило обновления SDK.

## Что происходит

- **Версия закреплена.** `@anthropic-ai/claude-agent-sdk` `0.3.289` (`package.json:28`), внутри —
  Claude Code 2.1.289 (поле `claudeCodeVersion` в `package.json` пакета SDK).
- **Настоящие сообщения SDK** сняты один раз: `test/fixtures/sdk-messages/*.jsonl`, 2026-10-05,
  `scripts/spikes/sdk-probe.ts`; у каждого `system/init` — `claude_code_version: "2.1.289"`
  (`test/fixtures/sdk-messages/README.md:1-7`).
- **Что уже проверяется.** `test/contract/agent-events.test.ts:1-3`: каждое снятое сообщение
  переводится в события worfy, и ничто из SDK не роняет перевод. Contract test-ы Session и Autopilot
  идут на fake SDK (`src/main/agent/fake-query.ts`); Ticket 01 доказал на нём, что worfy после рестарта
  не шлёт ход второй раз.
- **Чего нет.**
  - Ничто не связывает версию SDK в `package.json` с версией, с которой сняты fixtures. Урок «SDK
    поднимать только до Claude Code ≥ 2.1.299 и в том же PR снимать fixtures заново»
    (`docs/lessons/agents.md:117-125`) держится на памяти исполнителя.
  - Ничто не сверяет fake SDK с настоящим: fake может слать сообщение или поле, которого настоящий
    SDK этой версии не шлёт, и contract test-ы будут зелёными на выдуманной форме.
  - Методы `Query`, которые зовёт worfy (`QueryHandle`, `src/main/agent/session.ts:120-137`:
    `interrupt`, `setModel`, `setPermissionMode`, `applyFlagSettings`, `supportedModels`,
    `supportedCommands`, `getContextUsage`, `accountInfo`), не сверяются с типом SDK.
  - Сравнить версию N с N+1 нечем: снять fixtures заново можно, сравнить форму — только глазами.

## Что делаем

1. **Манифест версии.** `test/fixtures/sdk-messages/` получает запись, с какими SDK и Claude Code
   сняты fixtures (файл или строка README — выбор исполнителя). Contract test: версия SDK в
   `package.json` и `claudeCodeVersion` установленного пакета совпадают с манифестом, и каждый
   `system/init` fixtures несёт ту же `claude_code_version`. Поднял SDK без новых fixtures — test
   красный.
2. **Fake SDK не выдумывает формы.** Contract test проходит сценарии fake SDK
   (`test/fixtures/agent-scripts/`) и сверяет каждое сообщение с формами из `sdk-messages`: тип,
   subtype и ключи, которые читает перевод (`src/shared/agent/events.ts`). Форма, которой нет в снятых
   fixtures, — красный test с именем сценария; намеренные исключения — список с причиной в test-е.
3. **Методы `Query`.** Typecheck-проверка: `QueryHandle` worfy совместим с типом `Query` SDK
   (`satisfies` или проверка типа в test-е) — у нового SDK пропал или поменялся метод — `pnpm
   typecheck` красный.
4. **Сравнение N и N+1 — скрипт, без платных прогонов в CI.** `scripts/sdk-compat.mjs`: берёт две папки
   fixtures (текущие и снятые для новой версии) и печатает разницу форм — новые и пропавшие типы
   сообщений, ключи, методы. Снятие fixtures новой версии — `sdk-probe.ts` под временными `HOME` и
   `CLAUDE_CONFIG_DIR` — платный прогон, только по слову владельца в PR обновления SDK; сам скрипт
   сравнения работает на файлах и идёт в unit test-е на маленьких fixture-папках.
5. **Урок** `docs/lessons/agents.md` про обновление SDK получает строку `Проверка:` со ссылкой на test
   пункта 1 — если к этому моменту влит Ticket 07; иначе строка в «Итог».

## Готово, когда

- [ ] Test пункта 1: мутант «версия в манифесте другая» — красный; на main с манифестом — зелёный.
- [ ] Test пункта 2 зелёный на текущих сценариях fake SDK (исключения — с причиной); мутант
      «fake шлёт выдуманный ключ» — красный.
- [ ] Пункт 3: мутант «у `QueryHandle` метод с другой сигнатурой» — `pnpm typecheck` красный.
- [ ] `scripts/sdk-compat.mjs` и его unit test; пример вывода на двух fixture-папках — в «Итог».
- [ ] Ни одного запуска настоящего Claude Code или SDK ради test-ов.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

## Тесты

- `test/contract/sdk-compat.test.ts` — манифест версии, формы fake SDK против снятых.
- `test/unit/sdk-compat-diff.test.ts` — скрипт сравнения на маленьких fixture-папках.

## Где в коде

- `test/contract/sdk-compat.test.ts`
- `test/unit/sdk-compat-diff.test.ts`
- `scripts/sdk-compat.mjs`
- `test/fixtures/sdk-messages/README.md`
- `test/fixtures/sdk-compat/`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/agent/fake-query.ts`,
`src/shared/agent/events.ts`, `src/main/agent/session.ts`, `test/fixtures/agent-scripts/`,
`test/contract/agent-events.test.ts`, `scripts/spikes/sdk-probe.ts`, `package.json`.

## Вне скоупа

- Само обновление SDK и платное снятие fixtures — отдельный PR по слову владельца.
- Матрица на Windows (идея A упоминает её) — когда `worfy-windows` 14 гоняет test-ы на ПК.
- Настройки compaction Subagent-ов и `idleCompaction` — в `src/` их нет (spec Epic-а, «Не в этом
  Epic-е»).
- Auto-updater SDK.

## Итог

—

# 26 — Отказ в разрешении у Autopilot: причина Claude Code в ответе модели, Subagent и причина в журнале

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-15 по отчёту
[docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md](../../../docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md)
(Ticket [12](12-bash-запросы-разрешения-у-orchestrator-а-autopilot.md)): разделы «Коротко», «Как
устроен отказ», «Вопрос 4», «Предложения», пункт 1. Код перечитан по main `39d907f`.

## Что происходит

Autopilot — режим, в котором Wave-ы идут без человека. Его Session запускается unattended и всегда в
`bypassPermissions`. Но некоторые проверки Claude Code спрашивают человека и в этом режиме. Например,
`dangerousRemoval` — `rm -rf` с целью, которую нельзя вычислить заранее (отчёт, «Коротко»).

- **worfy отказывает без причины.** Для unattended Session-а `canUseTool` — это
  `unattendedCanUseTool` (`src/main/agent/session.ts:306-308`). Он отказывает сразу
  (`src/main/agent/permissions.ts:61-66`) и всегда одним текстом `UNATTENDED_DENIED_MESSAGE`
  (`:35-37`). Модель не узнаёт, какая проверка сработала и что переписать.
- **SDK причину даёт, worfy её не читает.** Третий аргумент `canUseTool` несёт `decisionReason` —
  «почему спросили» — и `agentID` — «какой Subagent спросил»
  (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:245-246`, `:280-281`). В типе worfy
  `PermissionRequestOptions` (`permissions.ts:39-49`) этих полей нет; `unattendedCanUseTool` читает
  только имя инструмента (`:62`).
- **Журнал не говорит ни «кто», ни «почему».** Отказ — событие `refused_dialog`
  (`session.ts:316-324`; схема — `src/shared/agent/events.ts:77`). Autopilot пишет его в журнал как
  `refused-dialog` с полем `what` = `<вид диалога> <инструмент>` (`src/main/autopilot/run.ts:745-746`;
  схема — `src/shared/autopilot/journal.ts:222`, описание — `:81`).
- **Цена.** Все четыре отказа в журналах пришли от фоновых Subagent-ов Orchestrator-а. Для разбора
  пришлось сопоставлять время отказа с транскриптами Subagent-ов и восстанавливать причину по
  бинарнику Claude Code (отчёт, «Четыре случая»).

## Что делаем

1. **Сначала красный contract test** в `test/contract/permissions.test.ts` (рядом с test-ом
   unattended-отказа, `:585-600`): `canUseTool` unattended Session-а получает `decisionReason` и
   `agentID`. Ожидание: в ответе модели — `UNATTENDED_DENIED_MESSAGE` и строка `refused because:
   <reason>; rewrite the command so this check does not fire`; событие `refused_dialog` несёт
   `agent` и `reason`. На main красный.
2. **Тип.** `PermissionRequestOptions` получает `decisionReason?` и `agentID?`.
3. **Ответ модели.** `unattendedCanUseTool` читает третий аргумент. Есть `decisionReason` — к тексту
   добавляется причина, как в пункте 1. Нет — текст прежний, слово в слово (старые test-ы с
   `UNATTENDED_DENIED_MESSAGE` не меняются).
4. **Событие.** `refused_dialog` в `events.ts` получает необязательные `agent` и `reason`;
   `refuseDialog` (`session.ts:321`) их передаёт. Отказ `card_ask` (Card API) их не имеет.
5. **Журнал.** Строка `refused-dialog` получает необязательные поля `agent` и `reason`:
   - `reason` обрезан примерно до 200 символов; домашняя папка заменена на `~`;
   - `agent` — `agentID` как есть (имя Subagent-а — по желанию исполнителя, если оно доступно без
     чтения файлов);
   - **саму команду журнал не пишет**: в командах бывают токены и личные пути (отчёт, «Вопрос 4»);
   - схема только расширяется: старые строки без полей читаются как прежде.
6. **Fake SDK.** В `bypassPermissions` fake сейчас не зовёт `canUseTool`
   (`src/main/agent/fake-query.ts:371-373`), а unattended Session всегда в этом режиме. Строка
   сценария `permission` получает флаг, при котором fake спрашивает и в `bypassPermissions` (как
   `dangerousRemoval` у Claude Code), и поля `decisionReason`, `agentID`. Тогда contract test
   Autopilot проходит весь путь: fake → `canUseTool` → журнал.
7. **Test журнала.** `test/contract/autopilot.test.ts` (рядом с `:365-366`): строка `refused-dialog`
   с `agent` и `reason`; путь домашней папки в ней заменён на `~`; текста команды в строке нет.
   `test/unit/autopilot-journal.test.ts` (`:36`): старая строка без полей читается.

## Готово, когда

- [ ] Test пункта 1 красный на main и зелёный с правкой.
- [ ] Мутанты краснят свои test-ы: «причина не попадает в ответ модели»; «домашняя папка не
      заменена»; «команда пишется в журнал»; «схема требует новые поля» (старая строка не читается).
- [ ] Старые test-ы с `UNATTENDED_DENIED_MESSAGE` (`permissions.test.ts`, `orchestrator.test.ts`)
      зелёные без правок их ожиданий.
- [ ] Ни одного запуска настоящего Claude Code: только fake SDK.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/contract/permissions.test.ts` — ответ модели и событие.
- `test/contract/autopilot.test.ts` — строка журнала через fake SDK.
- `test/unit/autopilot-journal.test.ts`, `test/contract/autopilot-journal.test.ts` — схема, старые
  строки.

## Где в коде

- `src/main/agent/permissions.ts`
- `src/main/agent/session.ts`
- `src/main/agent/fake-query.ts`
- `src/shared/agent/events.ts`
- `src/main/autopilot/run.ts`
- `src/shared/autopilot/journal.ts`
- `test/contract/permissions.test.ts`
- `test/contract/autopilot.test.ts`
- `test/unit/autopilot-journal.test.ts`
- `test/contract/autopilot-journal.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/main/ipc/card-api.ts`, `test/contract/orchestrator.test.ts`,
`docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md`,
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

## Вне скоупа

- Правило для агентов про `rm` и `-c`-script — Harness, `worfy-harness` 48.
- Guard в `harness/hooks/guard.mjs` — отложен владельцем.
- Allowlist в Profile-е или Harness-е — не поможет (отчёт, «Предложения»).
- Session-ы с человеком: диалог разрешения не меняется.

## Итог

—

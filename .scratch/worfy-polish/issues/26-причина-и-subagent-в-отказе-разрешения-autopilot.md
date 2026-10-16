# 26 — Отказ в разрешении у Autopilot: причина Claude Code в ответе модели, Subagent и причина в журнале

Type: task
Status: blocked — REJECTED дважды (PR #378): правило начала пути из брифа доработки вернуло утечку имени в \\?\C:\Users\…; узкий круг — по решению владельца
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
- `test/fixtures/agent-scripts/autopilot-refused-permission.jsonl` (новый сценарий fake SDK; добавлен при claim)

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

- **Ответ модели.** `unattendedCanUseTool` (`src/main/agent/permissions.ts`) читает `decisionReason` и
  `agentID` третьего аргумента. Есть причина — ответ `UNATTENDED_DENIED_MESSAGE` + перевод строки +
  `refused because: <reason>; rewrite the command so this check does not fire`. Нет причины (или она
  пустая) — ответ прежний, слово в слово.
- **Событие.** `refused_dialog` получил необязательные `agent` и `reason` (`src/shared/agent/events.ts`);
  `Session.refuseDialog` передаёт их; `card_ask` их не имеет. В событии причина полная, без обрезки.
- **Журнал.** `refused-dialog` получил необязательные `agent` (agentID как есть; имени Subagent-а нет —
  без чтения файлов оно недоступно) и `reason` — через `journalReason`
  (`src/shared/autopilot/journal.ts`): домашняя папка (`os.homedir()`) → `~`, затем не больше
  `REASON_MAX` = 200 UTF-16 units без половины суррогатной пары. Правило одно на все платформы
  (круг 2 ревью): регистр не важен, `\` и `/` — один разделитель, для домашней папки на диске
  принимается и форма MSYS (`/c/Users/Ann` для `C:\Users\Ann`); заменяется только путь, который не
  продолжает имя пути: перед ним не буква, не цифра, не `.`, `_`, `-` и не разделитель (`/mnt/Users/ann`
  и `x/Users/ann` остаются, `,/Users/ann`, `[/Users/ann`, `>/Users/ann` — заменяются). Команду журнал не пишет. Старые
  строки без полей читаются как прежде; строка с `reason` длиннее 200 — не читается (как `narrow-round`
  с длинным `text`).
- **Fake SDK.** Строка `permission` получила `bypassImmune` (спрашивать и в `bypassPermissions`),
  `decisionReason`, `agentID`; в сценариях появилась подстановка `{{home}}`. Новый сценарий
  `test/fixtures/agent-scripts/autopilot-refused-permission.jsonl` — два отказа за ход: от Subagent-а с
  короткой причиной и от самого Session-а с длинной.
- Решено без владельца, подтвердить:
  - причина идёт в ответ модели отдельной строкой после `UNATTENDED_DENIED_MESSAGE`;
  - пустая или пробельная `decisionReason` считается отсутствующей;
  - регистр не учитывается на всех платформах: на Linux `/home/Ann` при домашней `/home/ann` тоже
    станет `~` — лишняя замена, не утечка;
  - после домашней папки точка не мешает замене (`/Users/ann.` → `~.`), буква, цифра, `_` и `-` —
    мешают (`/Users/ann2` остаётся): лишняя замена безопаснее, чем утечка пути;
  - `decisionReason` от Claude Code сама может содержать команду или её часть; журнал пишет её как есть
    (обрезанной и с `~`), отдельно команду из `input` не пишет.
- Не проверено: шаг владельца — отказ настоящего Claude Code в Autopilot (настоящий SDK в этом Ticket-е
  не запускался, только fake).

### Gate оркестратора (2026-10-16)

- Wave 5 Epic-а под Autopilot: только Ticket 26. Глубина — один verifier на круг.
- Круг 1 — `REJECTED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/378#issuecomment-6205502510)): [med] `journalReason` заменял домашнюю папку только при точном совпадении — на Windows `c:\users\ann`, `C:/Users/Ann`, `/c/Users/Ann` оставляли имя в журнале. Бриф доработки: без ветки по `process.platform`, без учёта регистра, оба разделителя, форма `/c/`, замена только в начале пути.
- Круг 2 — `REJECTED` по основанию (б) ([комментарий](https://github.com/IDSAD-XL/worfy/pull/378#issuecomment-6206051366)): правило «перед домом не разделитель» из брифа оркестратора вернуло утечку имени в `\\?\C:\Users\Ann\…`, `\\.\C:\…`, `file:///C:\…`, которые круг 1 заменял. Пункт круга 1 исправлен. Предложение verifier-а: разделитель проверять только для формы `/c/…`, для `C:` достаточно «перед ним не буква, цифра, `.`, `_`, `-`»; test на `\\?\C:\…`.
- Выведен из Wave: Ticket листовой, узкий круг — только по решению владельца. PR #378 открыт, worktree `pol-26` сохранён.
- Consider: [low] текст для модели «rewrite the command so this check does not fire» (`permissions.ts:75`) взят из Ticket-а; verifier предлагает «follow the reason above: give a literal, resolvable target» — решение владельца.
- Noted: причина Claude Code сама цитирует часть команды `rm` — до 200 символов попадают в журнал (выбор research-отчёта, **решено без владельца, подтвердить**). [low] debt: WSL `/mnt/c/Users/…` и `/cygdrive/c/…` не заменяются (и в круге 1); `/System/Volumes/Data/Users/…` на macOS; нет test-а на дом с символами regex (мутант без `escapeRegExp` проходит).
- Dismissed — нет.

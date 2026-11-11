# 05 — Allow in Project, query инвентаря и вход OAuth для Claude; поправка к ADR-0021

Type: task
Status: open
Blocked by: 03, 04
Source: [spec.md](../spec.md), «Ticket-ы», строка 05; «Решения владельца» Q1, Q5, Q6, Q8, Q11; «Решения по реализации»
(query инвентаря, Allow, ADR, Autopilot, приватность); «Решено без владельца» 5; «Риски» (query инвентаря, вход OAuth,
цена); истории 4, 7, 8, 11; возражение 3 критика
([docs/product/critic/worfy-mcp-live-2026-11-11.md](../../../docs/product/critic/worfy-mcp-live-2026-11-11.md))

## Что происходит

- Claude Code не сообщает серверы, которые отсёк policy tier: ни в `system/init`, ни, по fixture-ам, в ответе Session
  (`test/fixtures/sdk-messages/plugin-mcp-name-*.jsonl`). Строк «не разрешён» после Ticket-ов 02–04 нет: UI их
  нарисует, но main их не строит.
- Spike (Ticket 01) проверил query инвентаря в sandbox: даёт ли query без allowlist-а и без вызова модели имена и
  статус серверов вне списка. Перечисляет ли он connector-ы claude.ai — итог живой проверки владельца в заметке
  `.scratch/worfy-mcp-live/spike-mcp-live.md`.
- Окно Edit profile пишет Profile через `src/main/ipc/profile-edit.ts` и `bin/profile-set` Harness-а; свой
  `profile.json` worfy не пишет (`test/contract/profile-edit.test.ts`).
- Подхват на ходу и `restart` даёт Ticket 03; кнопки Allow и Sign in рисует Ticket 04.
- Сервер со статусом needs-auth есть в списке, но войти в него изнутри worfy нельзя. Что можно, решил spike:
  `mcpAuthenticate` SDK или запасной путь.
- ADR-0021 говорит «Session-ы worfy получают только серверы из списка» и ничего — о списке на ходу.

## Что делаем

1. Query инвентаря в main Claude: query Claude Code с `settingSources` Session, без `managedSettings`-allowlist-а, без
   своих серверов worfy, без сообщения модели. Ждёт выхода серверов из `pending`, читает `mcpServerStatus`,
   закрывается. Запуск — при открытии списка (`agent.mcp`) и при старте Session Claude; не больше одного на Project и
   Machine за раз; ответ — в памяти main, на диск не пишется. Серверы из ответа, которых нет в наборе Session, —
   строки `not-allowed` с действием `allow`.
2. Запасной путь Q11 для connector-ов: если по итогу spike-а и живой проверки query их не перечисляет, popover
   показывает строку-подсказку: connector claude.ai вне списка вписывается в `mcp.allowed` вручную в Project settings.
   Если итога владельца к claim-у нет, строится запасной путь, а пункт connector-а в «Готово, когда» остаётся
   открытым до итога (spec, «Решено без владельца» 5).
3. `allow` в `agent.mcpAction`: добавляет имя в `mcp.allowed` Profile-а Project-а Session через `profile-edit` и
   `bin/profile-set`, затем включает сервер в Session путём Ticket-а 03 (подхват или строка с `restart`).
4. В Autopilot Session `allow` пишет Profile, но сервер включается только со следующей Wave (Q6).
5. Конфликт записи Profile (чужой fingerprint, `bin/profile-set` слишком старый) — та же ошибка, что в Edit profile,
   toast; Session не меняется.
6. `sign-in` для needs-auth: путь, который выбрал spike. Через SDK — вход открывается в системном браузере
   (`shell.openExternal`), callback возвращается в SDK, затем Reconnect. Без SDK — строка говорит, где войти (`/mcp`
   в терминальном Claude Code или настройки connector-а в claude.ai), и предлагает Reconnect после входа.
7. Ответ query инвентаря не пишется в Journal, Flight recorder и диагностические выгрузки.
8. ADR-0021: раздел-поправка с датой — Allow из Session пишет список Profile, query инвентаря и запасной путь для
   connector-ов, подхват без новой Session и Restart по ADR-0064, правило Wave в Autopilot, у Codex список к серверам
   пользователя пока не применяется (Q8). Номер ADR не меняется; новый ADR не нужен.

## Готово, когда

- [ ] Contract test `test/contract/claude-mcp-inventory.test.ts` над fake query: query инвентаря идёт без allowlist-а и
      без сообщения модели; сервер вне списка — строка `not-allowed` с `allow`; второй запуск при идущем первом не
      стартует; ответ не попадает в Journal. Красный до правки — в «Итог».
- [ ] Contract test `test/contract/claude-mcp-allow.test.ts` над fake query и stub `bin/profile-set`: `allow` пишет
      `mcp.allowed` одним вызовом `profile-set` и включает сервер в Session (или даёт строку с `restart`); конфликт
      записи не меняет Session.
- [ ] Contract test: в unattended Session `allow` пишет Profile, набор Session не меняется.
- [ ] Contract test `sign-in`: по выбранному пути spike-а; браузер и OAuth — stub без сети.
- [ ] E2e `test/e2e/session-mcp.spec.ts` дополнен: клик Allow — строка уходит из группы «не разрешён». Зелёный на
      macOS и Windows runner-е.
- [ ] (manual) Connector claude.ai вне списка: по итогу живой проверки владельца — строка «не разрешён» с Allow или
      подсказка о ручном вводе в Project settings; что выбрано — в «Итог».
- [ ] ADR-0021 дополнен поправкой; `pnpm lint` (проверка документов) — exit 0.
- [ ] Все unit и contract test-ы модулей `src/main/vendors/claude/` и `src/main/ipc/profile-edit.ts` зелёные; lint,
      typecheck и gate fast — exit 0.

## Где в коде

- `src/main/vendors/claude/mcp.ts`
- `src/main/vendors/claude/mcp-inventory.ts` (новый)
- `src/main/ipc/profile-edit.ts`
- обработчик `agent.mcpAction` из Ticket-а 02
- `src/main/agent/fake-query.ts`
- `src/renderer/session/McpChip.tsx` (строка-подсказка запасного пути)
- `docs/adr/0021-mcp-servers-allowlist-in-profile.md`
- `test/contract/claude-mcp-inventory.test.ts` (новый)
- `test/contract/claude-mcp-allow.test.ts` (новый)
- `test/e2e/session-mcp.spec.ts`

## Вне скоупа

- Allow и «не разрешён» для Codex: их нет (Q8); применение списка к Codex — «Не в этом Epic-е» spec-а.
- Удаление сервера из `mcp.allowed` из popover-а: это делает Edit profile.

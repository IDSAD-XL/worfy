# 02 — Session без человека: bypassPermissions насквозь и ни одного диалога

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), тема A, риск 7; [CONTEXT.md](../../../CONTEXT.md), термин Autopilot; Ticket 21 worfy-mvp (разрешения)

## Что делаем

Autopilot запускает Session-ы, рядом с которыми нет человека. Сейчас такая Session может зависнуть
в двух местах.

1. **Запрос разрешения.** Новая Session и так стартует в `bypassPermissions`
   (`src/main/agent/options.ts:5`, `src/main/actions/launch.ts:9-10`), и
   `allowDangerouslySkipPermissions: true` стоит в любом режиме (`options.ts:78`). Но пользователь
   может сменить режим посреди хода (`options.ts:77`). Тогда запрос разрешения идёт в
   `PermissionGate` (`src/main/agent/permissions.ts:91`) и ждёт ответа в UI, которого никто не даст.
2. **Запрос от Card.** Card просит Session спросить человека (`session.ask`). Это открывает
   `dialog.showMessageBox` и ждёт ответа (`confirmAsk`, `src/main/ipc/card-api.ts:14-25`).

**Признак Session «без человека».** Признак хранится в настройках запуска Session
(`src/main/agent/session-settings.ts`). Имя поля выбирает Ticket, например `unattended`. Ставит
признак только Autopilot (Ticket 04). У такой Session:

- **Режим всегда `bypassPermissions`**, при любом сохранённом режиме Node-а. Смена режима
  отклоняется понятным текстом в ответе IPC. У обычной Session всё как было.
- **`canUseTool` не ждёт UI.** Если вызов всё же пришёл, сразу отказ с причиной. Подписчики получают
  событие `refused-dialog`. В журнал его пишет Ticket 04.
- **`session.ask` от Card не открывает диалог.** Card получает отказ «рядом нет человека», подписчики
  получают событие `refused-dialog`. Чтобы это можно было проверить test-ом, `confirmAsk` выносится
  функцией с подменяемым `dialog`.

Отклонить смену режима или поставить прогон на паузу — решает ADR (номер с 0022). Предложение —
отклонять.

**Subagent-ы и Subagent-ы workflow-скриптов** наследуют режим своей Session — так устроен Claude
Code. Fake-агент в `bypassPermissions` `canUseTool` не вызывает (`src/main/agent/fake-query.ts:283`).
Поэтому наследование проверяется только вживую.

## Готово, когда

- [ ] ADR о смене режима у Session без человека принят.
- [ ] Session с признаком стартует в `bypassPermissions`, даже если у Node-а сохранён другой режим.
- [ ] Смена режима такой Session отклоняется, режим остаётся `bypassPermissions`. Обычная Session меняет режим, как раньше.
- [ ] `canUseTool` такой Session сразу отвечает отказом. `PermissionGate` запроса не получает, подписчики получают `refused-dialog`.
- [ ] `session.ask` от Card для такой Session не вызывает `dialog.showMessageBox` (в test-е подменённый dialog ни разу не вызван). Card получает отказ.
- [ ] (вручную) Session без человека на тестовом Project запускает workflow-скрипт с двумя Subagent-ами — ни одного запроса разрешения. Как проверить: за весь запуск подписчики Session не получили ни одного `refused-dialog`. Каждый вызов `canUseTool` такой Session даёт `refused-dialog` (пункт выше), поэтому ноль событий значит ноль вызовов. Для ручной проверки main пишет каждый `refused-dialog` в свой лог; после Ticket-а 04 то же видно в журнале прогона. Транскрипты Claude Code для проверки не годятся: `permission_request` — внутреннее событие worfy (`src/shared/agent/events.ts:48`, порождает `PermissionGate`), в JSONL его нет. Итог — в «Итог».

## Тесты

- `test/unit/agent-options.test.ts` (новый) — `sessionOptions` для обычной Session и Session без человека: `permissionMode`, `allowDangerouslySkipPermissions`, `canUseTool`.
- `test/contract/permissions.test.ts` — смена режима отклонена; `canUseTool` отказывает без `PermissionGate`.
- `test/contract/card-api.test.ts` (новый) — вынесенный `confirmAsk` с подменённым `dialog`.
- Сначала падающий test: смена режима Session без человека на `default` проходит, а должна отклоняться.

## Где в коде

- `src/main/agent/options.ts`
- `src/main/agent/permissions.ts`
- `src/main/agent/session-settings.ts`
- `src/main/ipc/card-api.ts`
- `test/unit/agent-options.test.ts` (новый)
- `test/contract/permissions.test.ts`
- `test/contract/card-api.test.ts` (новый)

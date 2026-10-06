# 02 — Session без человека: bypassPermissions насквозь и ни одного диалога

Type: task
Status: claimed — 2026-10-06
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
- [x] Session с признаком стартует в `bypassPermissions`, даже если у Node-а сохранён другой режим.
- [x] Смена режима такой Session отклоняется, режим остаётся `bypassPermissions`. Обычная Session меняет режим, как раньше.
- [x] `canUseTool` такой Session сразу отвечает отказом. `PermissionGate` запроса не получает, подписчики получают `refused-dialog`.
- [x] `session.ask` от Card для такой Session не вызывает `dialog.showMessageBox` (в test-е подменённый dialog ни разу не вызван). Card получает отказ.
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

## Итог

Сделано в ветке `worfy-daily/02`.

- **Признак.** Поле `unattended` в `SessionLaunch` (`src/main/agent/session-settings.ts`), отдельно
  от выбора пользователя (`SessionSettings`). Session получает его при запуске:
  `SessionRegistry.start(cwd, resume, sink, settings, { unattended: true })`. Через IPC `agent.start`
  его не передать: ставит его только Autopilot (Ticket 04) из main.
- **Признак не пишется в `session-settings.json`.** Он принадлежит одному прогону. Иначе после
  перезапуска worfy или конца прогона Node остался бы «без человека», и пользователь не смог бы
  сменить режим своей Session.
- **Режим.** У такой Session `launchSettings` ставит `bypassPermissions` при любом сохранённом
  режиме. `sessionOptions` с `unattended: true` тоже ставит `bypassPermissions` — это второй
  рубеж на случай, если настройки пришли в обход Session.
- **Смена режима** (`Session.configure`) с `permissionMode`, отличным от `bypassPermissions`,
  отклоняется целиком: модель и effort из того же запроса тоже не применяются. Ответ IPC:
  `agent.configure failed: This Session runs unattended (Autopilot), so its permission mode stays
  bypassPermissions: …`. Смена модели, effort и «смена» на `bypassPermissions` проходят.
- **`canUseTool`** такой Session — `unattendedCanUseTool` (`src/main/agent/permissions.ts`): сразу
  `deny` с причиной, без `PermissionGate`, без `permission_request` и `needs_permission`.
- **Событие.** Новый тип `AgentEvent` — `refused_dialog` (`src/shared/agent/events.ts`), поля
  `dialog` (`permission_request` | `card_ask`), `subject` (имя tool или id Card), `message`.
  Имя — в snake_case, как у остальных событий Session. В журнале прогона (Ticket 01) оно
  записывается как `refused-dialog`. Его получают и sink Session, и наблюдатели
  `SessionRegistry.observe`. Renderer событие не показывает: `fold` пропускает незнакомые типы.
  Каждый отказ main пишет в свой лог: `[agent] unattended Session <id> refused a <dialog> (<subject>)`.
- **`session.ask` от Card.** `confirmAsk` (`src/main/ipc/card-api.ts`) получил третий параметр
  `ConfirmAskDeps` с подменяемым `dialog` и поиском Session. Если получатель — Session без
  человека, диалог не открывается, Card получает ошибку `No one is at this Session to confirm the
  message: it runs unattended (worfy Autopilot). Nothing was sent.`, подписчики Session получают
  `refused_dialog` с `dialog: 'card_ask'`.
- **Файлы вне «Где в коде».** Без них обязательный исход недостижим. Смена режима идёт через
  `Session.configure`, а `canUseTool` Session выбирает сама — отсюда `src/main/agent/session.ts`.
  Подписчикам нужен новый тип события — отсюда `src/shared/agent/events.ts`. Фабрика SDK должна
  передать признак в `sessionOptions` — отсюда `src/main/agent/app-registry.ts` и test этой строки
  в `test/unit/agent-query-factory.test.ts`.
- **Для Ticket-а 04.** Orchestrator сохраняет настройки из события `settings`
  (`src/main/agent/orchestrator.ts`, `saveSettings`). Если запустить его без человека, принудительный
  `bypassPermissions` перезапишет режим, который пользователь сохранил для Node. Ticket 04 должен
  не сохранять настройки Session без человека.

Tests: `test/unit/agent-options.test.ts` (новый), `test/contract/permissions.test.ts` (раздел «an
unattended Session»), `test/contract/card-api.test.ts` (новый), `test/unit/agent-query-factory.test.ts`
(один test). Мутанты проверены вручную: убрать отказ в `configure`, принудительный режим в
`launchSettings`, `sessionOptions` или фабрике, выбор `unattendedCanUseTool`, emit `refused_dialog`,
проверку в `confirmAsk` — каждый краснит хотя бы один test.

не проверено: пункт «(вручную) Session без человека на тестовом Project запускает workflow-скрипт
с двумя Subagent-ами». Запустить Session без человека сейчас нечем: признак ставит только
Autopilot (Ticket 04), в UI и IPC его нет. Кроме того, настоящий Claude Code пишет транскрипты в
`~/.claude/projects`, а запись в `~/.claude` на эту ночь не разрешена. Проверка — после Ticket-а 04,
по логу main (строки `refused a`) или по журналу прогона.

не проверено: пункт «ADR о смене режима принят». Номер ADR не выдан; черновик — ниже, файл и номер
заводит оркестратор.

### Черновик ADR: Session без человека отклоняет смену режима разрешений

Дата: 2026-10-06. Статус: черновик.

Autopilot запускает Session-ы, рядом с которыми нет человека. Такая Session стартует в
`bypassPermissions`. Пользователь может открыть её в worfy и сменить режим посреди хода. В любом
режиме, кроме `bypassPermissions`, Claude Code перед tool спрашивает разрешение. Ответить на
запрос некому, и прогон висит до утра.

Решение: смена режима у Session без человека отклоняется. Ответ IPC объясняет причину, режим
остаётся `bypassPermissions`. Смена модели и effort разрешена. Признак «без человека» живёт только
в памяти main на время жизни Session и в `session-settings.json` не пишется.

Следствия: чтобы работать с Session в другом режиме, пользователь останавливает Autopilot. Ticket 04
пишет любую попытку человека вмешаться в журнал как `human-input`; отклонённая смена режима — тоже
такая попытка.

#### Considered Options

- **Отклонять смену режима** (выбрано). Прогон не зависает, причина видна сразу в ответе IPC.
- **Поставить прогон на паузу и применить режим.** Человек явно у экрана, но Autopilot должен
  знать, когда он ушёл, чтобы продолжить. Сигнала «ушёл» нет: пауза превращается в остановку,
  о которой Autopilot не узнает.
- **Применить режим молча.** Первый же запрос разрешения повесит прогон — тот самый дефект,
  который закрывает Ticket 02.


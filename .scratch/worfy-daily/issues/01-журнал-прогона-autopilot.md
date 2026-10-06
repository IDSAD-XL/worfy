# 01 — Журнал прогона Autopilot

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), тема A; [CONTEXT.md](../../../CONTEXT.md), термин Autopilot; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) — собственное состояние worfy

## Что делаем

Журнал прогона — файл, куда Autopilot пишет каждое своё событие. По нему утром видно, что
происходило ночью и где понадобился бы человек. Сейчас журнала нет. Единственная дозапись в файл —
`WORFY_AGENT_LOG` fake-агента (`src/main/agent/app-registry.ts:47-51`), и она только для test-ов.

**Формат.** JSONL, одна строка на событие:
`{ "at": <ISO-время>, "run": <id прогона>, "project": <ключ Project>, "epic": <имя>, "kind": <вид>, ...поля вида }`.

- Файл: `<dataRoot>/autopilot/<run>.jsonl`. `run` — время старта плюс короткий суффикс. Один файл на
  прогон, отдельной ротации нет.
- worfy пишет только в dataRoot (`src/main/storage/paths.ts:10-13`, ADR-0005). В репозиторий
  Project и в `~/.claude` журнал не пишется.
- Путь к папке собирается в самом `journal.ts` как `join(dataRoot(), 'autopilot')`. `paths.ts` не
  меняется.

**`src/shared/autopilot/journal.ts`** — чистый код: типы событий и разбор файла.

- Виды событий: `run-started`, `wave-started`, `wave-finished`, `limits-hit`, `waiting-until`,
  `resumed`, `session-error`, `refused-dialog`, `human-input`, `run-stopped` (с причиной).
- `human-input` — любое вмешательство человека в прогон. Поля: `source` и `what`.
  - `source: "worfy"` пишет сам worfy (Ticket 04) на действие пользователя в Session прогона:
    сообщение Orchestrator-у или его Subagent-у, «Send queued», смена режима или модели, ручной
    перезапуск Session.
  - `source: "observer"` пишет агент-наблюдатель: касание вне worfy, которое видно только на экране
    (системный диалог macOS, Keychain, ручной перезапуск приложения). Он дописывает строку в тот же
    файл по формату из комментария, без кода worfy.
  - На такую запись ссылается `Source` Ticket-а, заведённого по вмешательству (условие готовности 2
    в [spec.md](../spec.md)).
- Комментарий в начале файла описывает формат. По нему агент-наблюдатель читает журнал без кода
  worfy.
- Строка неизвестного вида и оборванная последняя строка (после аварийного завершения) разбор не
  роняют. Такие строки пропускаются, и разбор возвращает их число.

**`src/main/autopilot/journal.ts`** — работа с файлами:

- открыть новый прогон;
- дописать событие — одна строка за вызов, через `appendFile`;
- список прогонов Project, последний первым;
- чтение одного прогона через разбор из shared.

Образец записи файлов — `src/main/storage/json-file.ts`.

Показа журнала в UI в этом Ticket-е нет. Ticket 04 показывает только строку состояния прогона.

## Готово, когда

- [ ] Каждое событие из списка пишется одной строкой JSON в `<WORFY_DATA_DIR>/autopilot/<run>.jsonl`. Два прогона — два файла.
- [ ] Строка `human-input` с `source: "observer"`, дописанная в файл снаружи между двумя записями worfy, читается разбором вместе с остальными, порядок строк сохраняется.
- [ ] Файл с оборванной последней строкой и строкой неизвестного вида читается: остальные события на месте, число пропущенных строк возвращается.
- [ ] Ни одной записи вне `WORFY_DATA_DIR`: test сравнивает дерево временного Project и временного `WORFY_CLAUDE_HOME` до и после.
- [ ] Список прогонов Project отсортирован от нового к старому.
- [ ] Формат описан комментарием в `src/shared/autopilot/journal.ts`.

## Тесты

- `test/unit/autopilot-journal.test.ts` (новый) — разбор: обычные строки, оборванная последняя, неизвестный вид, `human-input` от наблюдателя.
- `test/contract/autopilot-journal.test.ts` (новый) — дозапись на временном `WORFY_DATA_DIR`, два прогона, порядок списка. Образец — `test/unit/limits.test.ts`.
- Сначала падающий test: файл с оборванной последней строкой.

## Где в коде

- `src/shared/autopilot/journal.ts` (новый)
- `src/main/autopilot/journal.ts` (новый)
- `test/unit/autopilot-journal.test.ts` (новый)
- `test/contract/autopilot-journal.test.ts` (новый)

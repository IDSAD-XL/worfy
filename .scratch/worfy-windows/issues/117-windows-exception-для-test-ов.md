# 117 — Windows exception: test, красный только на Windows, пропускается до приёмки

Type: task
Status: claimed 2026-10-31T14:46Z
Branch: worfy-windows/117-windows-exceptions
Blocked by: —
Source: решения владельца 2026-10-31, Q1 («либо дорабатывать тесты, чтобы проходили, либо делать исключения для
падающих тестов на винде») и Q9 (вариант б: отдельный вид записи для win32, свой лимит 30, срок — до приёмки
Windows плюс 30 дней, один общий Ticket-владелец). Таблица падений gate full на ПК 2026-10-31: 0 из 11 зелёных, на
8 workers 13 из 15 упавших test-ов упали один раз; quarantine — 13 из 15 записей.

## Что происходит

- Quarantine (`test/quarantine.ts`): запись `test/quarantine/<id>.json`, не больше `MAX_ENTRIES` = 15, срок не дольше
  `MAX_DAYS` = 14 от `since`, у каждой свой Ticket-владелец; `test/unit/quarantine.test.ts` краснеет на сломанной,
  чужой или просроченной записи.
- Приёмка `worfy-windows` 16 — gate full на ПК зелёный; по Q1 test, который краснеет только на Windows, либо чинят,
  либо делают ему исключение. Лимит quarantine кончится за один-два gate.

## Что делаем

1. Новый вид записи — Windows exception — в том же каталоге `test/quarantine/`, поле `"kind": "windows-exception"`
   (у записей quarantine поля нет или `"kind": "quarantine"`):
   - `platforms` — ровно `["win32"]`; `owner` — ровно `worfy-windows 117`;
   - не больше `MAX_WINDOWS_EXCEPTIONS` = 30 записей, отдельно от 15 записей quarantine;
   - `until` не дальше `MAX_WINDOWS_EXCEPTION_DAYS` = 45 дней от `since` (дата приёмки неизвестна; после приёмки 16
     даты записей ставятся на «приёмка + 30 дней», продление — только словом владельца, как у quarantine);
   - остальные поля и поведение (`WORFY_QUARANTINE`, строка на stderr и `::warning`, имя test-а, пропуск только в
     блокирующих run-ах) — как у quarantine; в строке и имени — «windows exception», не «quarantine».
2. `test/unit/quarantine.test.ts` проверяет оба вида: свой лимит, свой срок, `platforms` и `owner` exception-а.
3. Перевести в Windows exception две записи только для win32: `terminal-windows-close-no-console-host` и
   `workflow-branches-gone-worktree-then-repository` (quarantine станет 11 из 15).
4. Шапка `test/quarantine.ts` описывает оба вида; глоссарий `CONTEXT.md` получает термины Quarantine и Windows
   exception (без деталей реализации).
5. Этот Ticket — общий владелец всех Windows exception: остаётся open, пока они есть; «Итог» ведёт их список.

## Готово, когда

- [ ] Сначала падающий test: запись `kind: windows-exception` с `platforms: ["win32"]` и сроком 30 дней — сейчас
      красная (14 дней).
- [ ] Test: 31-я запись exception — красный; exception с `platforms: ["darwin"]` или чужим `owner` — красный;
      exception не считается в 15 записей quarantine.
- [ ] Две записи переведены; на Mac обе по-прежнему не пропускаются (не их платформа).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
- [ ] После приёмки 16: даты записей — «приёмка + 30 дней»; к этому сроку каждая запись починена или удалена по
      правилу удаления test-ов.

## Тесты

- `test/unit/quarantine.test.ts`, test-ы helper-а для vitest и Playwright (`test/e2e/quarantine.ts`).

## Где в коде

- `test/quarantine.ts`, `test/e2e/quarantine.ts`, `test/unit/quarantine.test.ts`, `test/quarantine/*.json`
- `CONTEXT.md`
- профиль worfy `rules.md` — только если там описан лимит quarantine (правит Orchestrator)

## Итог

Windows exception-ы, которыми владеет этот Ticket (`test/quarantine/<id>.json`, `"kind": "windows-exception"`):

| id | test | since | until |
|---|---|---|---|
| `terminal-windows-close-no-console-host` | `test/contract/terminal-windows.test.ts` — close не оставляет console host-а | 2026-10-31 | 2026-12-15 |
| `workflow-branches-gone-worktree-then-repository` | `test/contract/workflow-branches-gone.test.ts` — удаление worktree, затем репозитория | 2026-10-31 | 2026-12-15 |

Quarantine после перевода — 11 из 15 записей. Даты `until` — предел «since + 45 дней»; после приёмки
`worfy-windows` 16 их ставят на «приёмка + 30 дней».
- Механизм влит PR #1143 (`eb200227`): Windows exception-ы — `terminal-windows-close-no-console-host`, `workflow-branches-gone-worktree-then-repository` (обе до 2026-12-15). Ticket остаётся open — общий владелец.

# 02 — Test-ы на отказы unattended-старта Orchestrator-а: Vendor без ответа о возможностях и занятая Session

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Находки», находки test-gaps-1 и test-gaps-2

Глубина review — `medium` (PR меняет только test-ы). Не платформенный PR.

## Что делаем

На коммите аудита `42372355b` два guard-а в `src/main/agent/orchestrator.ts` не дают перевести Orchestrator в unattended
режим (режим без человека, в нём идёт Autopilot), но ни один test не проходит через их ветку отказа. Удалить их можно, не
покраснев ни одним test-ом.

1. `src/main/agent/orchestrator.ts:531-536` — если `deps.capabilities(vendor)` бросает, `unattendedRefusal` возвращает
   отказ «Autopilot did not start: worfy could not read what … can do». Во всех test-ах этот stub отвечает успехом:
   `test/contract/codex-orchestrator.test.ts:301`, `:562`, `test/contract/autopilot-faults-setup.ts:405`. Сценарий
   регрессии: catch меняют на `return null`, и Autopilot стартует на Vendor-е, чьи гарантии Harness прочитать не
   удалось. Сегодня оба настоящих driver-а ловят свои ошибки сами
   (`src/main/vendors/codex/capabilities.ts:193-203`, `src/main/vendors/claude/index.ts:25-36`), поэтому это пробел в
   test-ах, а не дефект.
2. `src/main/agent/orchestrator.ts:365`, `:370`, `:371` — `setUnattended(projectId, true)` бросает
   `ORCHESTRATOR_IN_TURN`, `ORCHESTRATOR_HAS_TASKS` или `ORCHESTRATOR_HAS_QUEUE`, если Session Orchestrator-а в turn-е,
   у неё живые background task-и или очередь сообщений. Это последний guard перед перезапуском attended Session в
   unattended: перезапуск убил бы task-и человека и потерял бы очередь. Тексты `ORCHESTRATOR_IN_TURN` и
   `ORCHESTRATOR_HAS_QUEUE` встречаются только в renderer-test `test/unit/canvas-actions.test.tsx:597`, `:611`, `:632`, где
   их подставляет stub; текста `ORCHESTRATOR_HAS_TASKS` нет ни в одном test-е. Autopilot сначала ждёт `busy()`
   (`src/main/agent/orchestrator.ts:463-472`, `src/main/autopilot/run.ts:1151-1155`), и это ожидание покрыто
   (`test/contract/autopilot.test.ts:659`, `:743`). Но сами три throw остаются без test-а: без них unattended-старт поверх
   занятой Session возможен в промежутке между `busy()` и `setUnattended` или у вызывающего без `busy()`.

Код guard-ов не меняется. Отказ `hooks.trust()`, который бросает (`orchestrator.ts:548`), уже закреплён test-ом
`test/contract/codex-orchestrator.test.ts:551`; эта находка аудита отброшена.

## Готово, когда

- [ ] Test «refuses an unattended start when the capabilities of the Vendor cannot be read» рядом с
      `test/contract/codex-orchestrator.test.ts:551`: `capabilities: () => Promise.reject(...)`, `setUnattended` бросает с
      текстом отказа. Test краснеет, если catch на `orchestrator.ts:533` вернёт `null` (проверено правкой и записано в PR).
- [ ] Три test-а «setUnattended refuses a turn / live tasks / queued messages» в
      `test/contract/orchestrator-relaunch.test.ts`: каждый ждёт точный текст своей константы. Каждый краснеет, если
      удалить свою строку `:365`, `:370` или `:371` (три правки, итог в PR).
- [ ] Остальные test-ы обоих файлов зелёные.

## Тесты

- `test/contract/codex-orchestrator.test.ts` — критерий 1 (extend)
- `test/contract/orchestrator-relaunch.test.ts` — критерий 2 (extend)

## Где в коде

- `src/main/agent/orchestrator.ts` — `setUnattended` (с `:332`, ветка unattended `:360-372`), `unattendedRefusal` (`:527-550`), `busy()` (`:463`).
- `test/contract/codex-orchestrator.test.ts` — test отказа hooks (`:551`), stub-ы capabilities (`:301`, `:562`).
- `test/contract/orchestrator-relaunch.test.ts` — test-ы перезапуска Orchestrator-а.

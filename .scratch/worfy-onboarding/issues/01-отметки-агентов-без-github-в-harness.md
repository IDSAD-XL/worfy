# 01 — Отметки агентов без GitHub: Full mode с `local-green` пишет файл отметок

Type: task
Status: open
Blocked by: —
Source: решения владельца 2026-10-26, пункт 5 (Demo project — Full mode, `workflow.finish` `local-green`, без GitHub); [spec.md](../spec.md), «Решено без владельца», Р1 (решено без владельца, подтвердить); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md) — отметки агентов привязаны к SHA

## Что происходит

- Отметка агента — `review` или `check/<name>` с вердиктом `pending`, `success`, `failure` или
  `skipped`, привязанная к SHA commit-а (ADR-0067). Ставит её `bin/ticket mark`.
- `mark()` выбирает хранилище только по режиму Project-а (`harness/bin/ticket:696-702`): Silent mode —
  файл `<HARNESS_HOME>/runs/<profile>/marks/<epic>-<NN>.json` (`markLocal`, `:743`), всё остальное —
  commit status на GitHub (`markGitHub`, `:704`).
- В Full mode без `origin` `markGitHub` падает: «has no origin: a commit status needs a repository on
  GitHub» (`:723`). Full mode с `workflow.finish` `local-green` и без `origin` — ровно Demo project
  этого Epic-а (пункт 5 владельца).
- Skills ставят отметки ревью командой `ticket mark` (`harness/skills/ship-ticket/SKILL.md:413-415`) и
  читают их: в Silent mode — из файла, иначе — из статусов PR (`harness/skills/epic-wave/SKILL.md:920`).
- `preflight` уже знает Full mode без `origin` при `local-green` («origin: none — local finish»,
  `harness/bin/preflight:522`).

## Что делаем

1. Правило «где отметки»: файл отметок — в Silent mode, **и** в Full mode, когда
   `workflow.finish` — `local-green` и у репозитория Ticket-а нет `origin`. Иначе — commit status, как
   сейчас. Правило — одна функция в `bin/ticket`.
2. `mark()` идёт по правилу. Формат файла, замок и запись — те же, что у `markLocal`.
3. Места skills, которые читают отметки по `mode === "silent"` (`epic-wave/SKILL.md:920` и такие же в
   `ship-ticket`), читают по тому же правилу.
4. `ticket mark --contexts` не меняется.

Не входит: чтение отметок в worfy — Ticket 02.

## Готово, когда

- [ ] Full mode, `local-green`, без `origin`: `ticket mark todo 01 review failure --sha <sha>` — exit 0,
      запись в `runs/<profile>/marks/todo-01.json`, `gh` не вызван.
- [ ] Full mode с `origin` на GitHub — commit status, как раньше; Full mode с `pr-green-ci` без
      `origin` — та же ошибка, что сейчас.
- [ ] Silent mode — без изменений (существующие test-ы `ticket-mark.test.sh` зелёные).
- [ ] Skills `ship-ticket` и `epic-wave` читают отметки по тому же правилу; test-ы
      `harness/bin/tests/epic-wave-ship-ticket.test.sh` зелёные.
- [ ] Платформенный PR (ADR-0056, пункт 2; скрипт Harness): вердикт Windows — по ADR-0071 (PR без
      окон и e2e) или gate full на ПК, код 0 и строка `[gate] green (full)`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- `harness/bin/tests/ticket-mark.test.sh`: новый профиль `full` с `"workflow":{"finish":"local-green"}`
  над репозиторием без `origin` — три отметки в файл, `gh` не вызван (по образцу блока Silent mode,
  `:62`, `:150-154`); тот же профиль с `pr-green-ci` — прежняя ошибка.
- Сначала падающий: Full + `local-green` без `origin` — сейчас exit 1 «has no origin».

## Где в коде

- `harness/bin/ticket` — `mark` (`:696-702`), `markGitHub` (`:704-741`), `markLocal` (`:743`)
- `harness/skills/ship-ticket/SKILL.md` (`:413-415` и места чтения отметок)
- `harness/skills/epic-wave/SKILL.md` (`:920`)
- `harness/bin/tests/ticket-mark.test.sh`

Только читать: `harness/bin/preflight` (`:522`), `harness/profiles/README.md`.

## Итог

Заполняется при закрытии.

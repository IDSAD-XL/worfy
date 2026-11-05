# 07 — Документация test-ов Autopilot и урок «сбой Autopilot-а → Fault scenario»

Type: task
Status: done 2026-11-05T18:47Z
PR: #1449
Blocked by: 02, 03, 04, 05, 06
Source: [spec.md](../spec.md), «Вопросы владельцу», Q6, «Новые термины», «Решено без владельца», п. 6; Epic [worfy-feature-docs](../../worfy-feature-docs/spec.md), «Шаблон раздела» (Implementation — главные test-ы); [worfy-reliability 03](../../worfy-reliability/issues/03-сбой-инцидент-и-регрессионный-test-предложение-процесса.md) (сбой → инцидент → регрессионный test)

## Почему не страница Feature

Epic добавляет только test-ы: поведение Autopilot не меняется, пользователь ничего нового не видит. Страница
`docs/features/` описывает поведение (worfy-feature-docs, «Шаблон раздела»), поэтому своей страницы набор не
получает. Его место — раздел Implementation у Autopilot, где уже есть таблица test-ов, и урок для следующего сбоя.

## Что происходит

- `docs/features/autopilot.md:427-456` — `#### Tests`: какой файл что проверяет (строки `autopilot.spec.ts`,
  `autopilot-chat.spec.ts` и другие). Страница — 456 строк; правило Epic-а worfy-feature-docs — больше примерно 400
  строк делится на две. Этот Ticket добавляет немного строк и не делит её.
- По `rules.md` в PR с поведением правится только английская страница; перевод `docs/features/ru/autopilot.md` —
  отдельным шагом. Здесь поведения нет, поэтому английская страница и перевод правятся в одном PR.
- Уроки — `docs/lessons/testing.md`; у каждого урока строка `Проверка:` (её проверяет `scripts/check-lessons.mjs`).

## Что делаем

1. **`docs/features/autopilot.md`, `#### Tests`:** абзац «Fault scenarios» — правила восстановления одной фразой
   каждое и где они (`test/autopilot-invariants.ts`); строки таблицы для `autopilot-faults-api`, `-process`,
   `-github`, `-codex` и `test/e2e/autopilot-faults.spec.ts`. Без номеров строк.
2. **`docs/features/ru/autopilot.md`** — тот же абзац и строки в переводе.
3. **`docs/lessons/testing.md`** — урок: «Сбой Autopilot-а, найденный человеком, — сначала Fault scenario в
   `autopilot-faults`, потом исправление». Откуда — worfy-polish 50. `Проверка:` — путь к test-у API 500 из
   Ticket-а 02.

## Готово, когда

- [ ] В `#### Tests` английской страницы — абзац и строки всех файлов набора; ссылки на файлы открываются.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 09b2482e277b3afad2be80d695cb171ddd209b05
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 3e3654f40a8d21812e3ee41ca958fd4ea503ac0a
  - evidence: review pass · PR #1449 · - - · 46edee48b2cb3136c180bb4d270a3e97ff574cf2
- [ ] Перевод в `docs/features/ru/autopilot.md` совпадает по смыслу.
  - evidence: commit pass · docs: Autopilot fault scenarios in the Autopilot page and the lesson (worfy-faults 07) · - - · 09b2482e277b3afad2be80d695cb171ddd209b05
  - evidence: commit pass · docs: checkRecovery returns one line per violation; I3 relaxes for any run without run-stopped (worfy-faults 07, rework 1) · - - · 3e3654f40a8d21812e3ee41ca958fd4ea503ac0a
  - evidence: review pass · PR #1449 · - - · 46edee48b2cb3136c180bb4d270a3e97ff574cf2
- [ ] Урок в `docs/lessons/testing.md` с `Проверка:` на существующий test; `node scripts/check-lessons.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-lessons.mjs` exit 0 · mac - · 09b2482e277b3afad2be80d695cb171ddd209b05
  - evidence: test-run pass · `node scripts/check-lessons.mjs` exit 0 · mac - · 3e3654f40a8d21812e3ee41ca958fd4ea503ac0a
  - evidence: review pass · PR #1449 · - - · 46edee48b2cb3136c180bb4d270a3e97ff574cf2
- [ ] `pnpm lint` — exit 0 (Cyrillic, ссылки); `ci-ok` на PR зелёный.
  - evidence: review pass · PR #1449 · - - · 46edee48b2cb3136c180bb4d270a3e97ff574cf2
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42086967099/job/127455705772 · ci - · 46edee48b2cb3136c180bb4d270a3e97ff574cf2

## Тесты

- Новых test-ов нет. Проверка — `scripts/check-lessons.mjs` и линза ревью `documentation`.

## Где в коде

- `docs/features/autopilot.md`
- `docs/features/ru/autopilot.md`
- `docs/lessons/testing.md`

## Итог

- `docs/features/autopilot.md`, `#### Tests`: шесть строк таблицы — `test/unit/autopilot-invariants.test.ts`,
  `autopilot-faults-api`, `-process`, `-github`, `-codex` и `test/e2e/autopilot-faults.spec.ts`; абзац «Fault scenarios» —
  что такое Fault scenario, что берёт `checkRecovery` (`test/autopilot-invariants.ts`), правила I1–I8 по одной-две фразы
  (сверены с функциями правил, не с шапкой файла: И2 — список чтений, И3 — допуск без последнего чтения, И4 — причина
  после нужной строки и `resumed`), и где сценарии собирают Run (`faultRun()`, `autopilot-world.ts`). Без номеров строк.
- `docs/features/ru/autopilot.md` — те же строки и абзац в переводе. **Шапка перевода:** `same-pr` заменён на
  `19f1660c` — последний commit английской страницы, с которого сделан перевод (README `docs/features`, раздел
  «Translation»). С `same-pr` эта правка сдвинула бы начало счёта и спрятала бы отставание: до неё
  `feature-docs-lag.mjs` показывал 6 commit-ов английской страницы после `19f1660c` (среди них строки
  `codex-orchestrator.test.ts` и `autopilot-vendor-limits.test.ts`, которых в переводе нет). Перевод этих commit-ов —
  не этот Ticket.
- `docs/lessons/testing.md` — урок «Сбой Autopilot-а, найденный человеком, — сначала Fault scenario в `autopilot-faults`,
  потом исправление»; `Проверка:` — `test/contract/autopilot-faults-api.test.ts:64` (API 500, случай worfy-polish 50).

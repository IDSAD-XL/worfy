# 07 — Документация test-ов Autopilot и урок «сбой Autopilot-а → Fault scenario»

Type: task
Status: open
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
- [ ] Перевод в `docs/features/ru/autopilot.md` совпадает по смыслу.
- [ ] Урок в `docs/lessons/testing.md` с `Проверка:` на существующий test; `node scripts/check-lessons.mjs` — exit 0.
- [ ] `pnpm lint` — exit 0 (Cyrillic, ссылки); `ci-ok` на PR зелёный.

## Тесты

- Новых test-ов нет. Проверка — `scripts/check-lessons.mjs` и линза ревью `documentation`.

## Где в коде

- `docs/features/autopilot.md`
- `docs/features/ru/autopilot.md`
- `docs/lessons/testing.md`

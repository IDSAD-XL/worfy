# 07 — `scripts/check-lessons.mjs` и строка `Проверка:` у всех уроков (В2)

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-16 по Ticket-у [03](03-сбой-инцидент-и-регрессионный-test-предложение-процесса.md)
(«Итог», пункты 3 и 4): вариант встраивания В2 из
[docs/research/2026-10-15-сбой-инцидент-test.md](../../../docs/research/2026-10-15-сбой-инцидент-test.md),
разделы «Куда встроить» и «Follow-up Ticket-ы», кандидат 2; `Проверка:` — всем существующим урокам,
вместе с В2.

## Что происходит

- Уроков в `docs/lessons/` на main `274c7eb` — 34 (`grep -c "^## "`: `agents.md` 12, `process.md` 9,
  `testing.md` 7, `ci-merge.md` 6). В отчёте Ticket-а 03 их 33: урок про обновление SDK
  (`docs/lessons/agents.md:117`) добавил Ticket 01 позже.
- Строку `Код:` имеют 9 уроков (8 в отчёте и урок про SDK), на файл test-а указывают 2
  (`docs/lessons/testing.md:73` — unit test, `:53` — helper e2e `test/e2e/snapshots.ts`); раздел «Что
  есть сейчас» документа. Остальные уроки ничем не проверяются.
- Образец проверки документа кодом — `scripts/check-handoff.mjs`: он идёт в `pnpm lint`
  (`package.json:17`) и имеет unit test `test/unit/check-handoff.test.ts`.

## Что делаем

1. **Сначала красный unit test** `test/unit/check-lessons.test.ts` на маленьких fixture-папках: урок без
   строки `Проверка:` — ошибка с файлом и заголовком; `Проверка:` с путём к несуществующему файлу —
   ошибка; `Проверка: проверки нет: <почему>` с непустой причиной — проходит; путь с `:line` за концом
   файла — ошибка.
2. **Скрипт** `scripts/check-lessons.mjs`: каждый `##` в `docs/lessons/*.md`, кроме `README.md`, имеет
   строку `Проверка:`; файл из неё существует, строка в пределах файла. Exit code 1 и список нарушений;
   0 — молча или одной строкой итога. Без зависимостей, как `check-handoff.mjs`.
3. **В `pnpm lint`** рядом с `check-handoff.mjs` — так скрипт идёт в gate fast и в CI.
4. **`Проверка:` всем 34 урокам.** Для каждого — `file:line` test-а, hook-а или eval-кейса, который
   сторожит урок, или «проверки нет: <почему>». Ссылки — настоящие: каждую исполнитель открывает и
   читает. Новых test-ов этот Ticket не пишет: урок без test-а получает «проверки нет».
5. **Список уроков без проверки** — таблица в «Итог»: кандидаты в будущие Ticket-ы, без их заведения.

## Готово, когда

- [ ] Unit test пункта 1 красный без скрипта и зелёный со скриптом; мутанты «не проверять существование
      файла» и «пропускать пустую причину» — красные.
- [ ] `node scripts/check-lessons.mjs` на ветке — exit 0; на main (без строк `Проверка:`) — exit 1 и 34
      нарушения.
- [ ] `pnpm lint` зовёт скрипт; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0
      и строка `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.
- [ ] Таблица пункта 5 — в «Итог».

## Тесты

- `test/unit/check-lessons.test.ts` — правила скрипта на fixture-папках `test/fixtures/check-lessons/`.

## Где в коде

- `scripts/check-lessons.mjs`
- `test/unit/check-lessons.test.ts`
- `test/fixtures/check-lessons/`
- `package.json`
- `docs/lessons/agents.md`
- `docs/lessons/process.md`
- `docs/lessons/testing.md`
- `docs/lessons/ci-merge.md`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `scripts/check-handoff.mjs`,
`test/unit/check-handoff.test.ts`, `docs/lessons/README.md` (формат строки задаёт Ticket 06).

## Вне скоупа

- Раздел README про классы и формат — Ticket 06. Если 06 влит раньше, формат строки — его; если позже,
  06 описывает уже работающую проверку.
- Новые test-ы под уроки без проверки.
- PR только с уроками gate fast по диффу может не проверить, пока Gate registry не знает
  `docs/lessons/` (как с `HANDOFF.md`): перед push такого PR — `node scripts/check-lessons.mjs`.

## Итог

—

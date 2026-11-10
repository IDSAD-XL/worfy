# 87 — Flaky test: `beforeAll` в `affected-tests.test.ts` не укладывается в 30 s под нагрузкой

Type: bug
Status: open
Blocked by: —
Source: находка Orchestrator-а 2026-11-10 в прогонах `pnpm test` на Mac. Строки перечитаны по main `8d08ed9f7`.

## Что происходит

`test/unit/affected-tests.test.ts:616` — `beforeAll` блока describe «scripts/affected-tests.table.json of this
repository» (:608). Он вызывает `generate(REPO)` (:617) из `scripts/affected-tests-table.mjs:217`: строит
generated-строки таблицы по исходникам всех test-ов репозитория. Один такой вызов занимает около 17 s, даже когда
файл запущен один.

Предел hook-а — общий для набора: `hookTimeout: ms(10_000)` в `vitest.config.ts:57`, умноженный на
`DEFAULT_TIMEOUT_SCALE = 3` (`test/time-scale.ts:15`), то есть 30 s. Под нагрузкой полного `pnpm test` на Mac
`generate` идёт дольше 30 s, hook падает по времени, и все test-ы блока краснеют. Один файл проходит.

## Что делаем

- Сначала замерить: сколько `generate(REPO)` идёт один и под нагрузкой полного набора; где уходит время (чтение
  файлов, разбор import-ов, обход папок). Числа — в «Итог».
- Сделать setup дешевле, если замер показывает, где: например, не строить строки, которые test-ам блока не нужны,
  или убрать повторную работу внутри `generate`. Поведение `scripts/affected-tests.mjs` не меняется.
- Если дешевле сделать нельзя — дать этому hook-у свой предел (`beforeAll(fn, ms(N))`) по замеру под нагрузкой с
  запасом; число и замер — в комментарии рядом и в «Итог». Общий `hookTimeout` в `vitest.config.ts` не трогаем.

## Готово, когда

- [ ] `node scripts/vitest-electron.mjs test/unit/affected-tests.test.ts` один — exit 0; время `beforeAll` — в «Итог».
- [ ] Тот же файл под нагрузкой полного `pnpm test` (параллельно с ним) 10 раз подряд — 0 падений; команда и счёт в
      «Итог»; до исправления — сколько падений из 10.
- [ ] Полный `pnpm test` на нагруженной машине — exit 0, test-ы блока зелёные.
- [ ] Общий `hookTimeout` в `vitest.config.ts` не изменён.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `test/unit/affected-tests.test.ts:608` — describe «scripts/affected-tests.table.json of this repository»;
  :615–618 — `beforeAll` с `generate(REPO)`; :22 — import `generate` из генератора.
- `scripts/affected-tests-table.mjs:217` — `generate(root)`.
- `vitest.config.ts:57` — `hookTimeout: ms(10_000)`; `test/time-scale.ts:15` — `DEFAULT_TIMEOUT_SCALE = 3`.

## Вне скоупа

- Общие пределы набора и множитель в `test/time-scale.ts`.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.

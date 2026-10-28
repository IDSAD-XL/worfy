# 44 — Windows e2e на GitHub runner-е: job в `ci-ok`, сначала только статистика, блокирует после пяти зелёных run-ов подряд

Type: task
Status: claimed 2026-10-28T10:44Z
Branch: triage/windows-e2e
Blocked by: 35
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решение 15 (Windows e2e —
отдельным job-ом в `ci-ok`, сначала не блокирующим, блокирующим после примерно пяти зелёных run-ов подряд;
начать с разбора красных Windows e2e); условие merge `ci-ok` —
[ADR-0083](../../../docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md).

## Что происходит

- После Ticket-а 35 `ci-ok` собирает Linux, macOS (`macos-tests`, `macos-e2e`, `macos-package`) и
  `windows / full-suite` — это `pnpm test` (unit и contract) из `windows-tests.yml`. e2e Playwright на Windows
  в CI не идут нигде: `windows-tests.yml` их не запускает (комментарий в начале файла: «no e2e»).
- Windows e2e гоняет только ПК владельца в gate full. Когда-то красными там были 128 e2e; ПК сейчас снимает
  свежую базу красных на `main` `2e70bf0f`.
- Карантин Ticket-а 20 после #878 работает и для Playwright (`test/e2e/quarantine.ts`, записи
  `test/quarantine/<id>.json` с `"runner": "playwright"` и полем `platforms`), так что пропуск e2e на `win32` с
  владельцем и датой уже есть.

## Что делаем

1. **Разбор красных Windows e2e первым.** Взять базу ПК на `2e70bf0f` (или первый run нового job-а, если база
   ПК ещё не пришла): каждый красный spec — в одну группу: дефект кода (Ticket или исправление в этом PR),
   отличие runner-а (окна, фокус, путь, время) или flaky. Таблица групп с run-ами — в «Итог».
2. Job `windows-e2e` в `ci.yml` (на `windows-latest`, тот же `changes` для выбора по путям, что у `macos-e2e`),
   shard-ами, если один job дольше 20 min.
3. **Сначала не блокирует.** `ci-ok` видит результат job-а, но красный `windows-e2e` его не краснит:
   статистика — run-ы и красные spec-и — копится в комментарии PR или в «Итог». Способ (`continue-on-error`,
   отдельный список необязательных job-ов в `scripts/ci-ok.mjs` или другое) — на implementer-е, закрепить
   contract test-ом.
4. **Блокирует после пяти зелёных run-ов подряд** на `main` (push-run-ы). Переключение — отдельный маленький
   PR со ссылками на пять run-ов; до него — нет.
5. Flaky и отличия runner-а, которые не чинятся в этом Ticket-е, — записи карантина с владельцем и датой выхода
   (не больше 15 записей всего), а не повтор run-а.

Нужен ПК: только база красных (п. 1), работа и merge — без ПК. Трогает Harness: нет (условие merge — `ci-ok`,
ADR-0083).

## Готово, когда

- [ ] «Итог»: таблица разбора красных Windows e2e — spec, группа, run, что сделано (исправление, Ticket или
      запись карантина).
- [ ] Job `windows-e2e` запускается на каждом PR и push в `main`, где `changes` его ждёт; contract test в
      `test/contract/ci-workflow.test.ts` закрепляет триггеры, права только на чтение и место job-а в `ci-ok`.
- [ ] Пока job не блокирует, красный `windows-e2e` не краснит `ci-ok`; contract test это закрепляет.
- [ ] Пять зелёных push-run-ов `windows-e2e` подряд на `main` — ссылки в «Итог»; после них PR делает job
      блокирующим, и contract test закрепляет это.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok`.

## Где в коде

- `.github/workflows/ci.yml`, `.github/workflows/windows-tests.yml` (если e2e удобнее держать там),
  `scripts/ci-ok.mjs`, `scripts/ci-scope.mjs`
- `test/contract/ci-workflow.test.ts`, `test/contract/windows-tests-workflow.test.ts`
- `playwright.config.ts`, `test/e2e/helpers.ts`, `test/e2e/quarantine.ts` — только если runner Windows требует
  настройки
- `test/quarantine/` — записи `win32` для e2e
- Дописать при claim по PR

## Вне скоупа

- Починка каждого красного Windows e2e — здесь только разбор и записи; дефекты кода — свои Ticket-ы
  (Epic `worfy-windows`).
- Flaky unit- и contract-test-ы Windows — Ticket 23.
- Вердикт `check/windows` и scope `pc` — Ticket-ы 24 и 30.

## Итог

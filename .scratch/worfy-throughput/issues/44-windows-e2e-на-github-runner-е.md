# 44 — Windows e2e на GitHub runner-е: job в `ci-ok`, сначала только статистика, блокирует после пяти зелёных run-ов подряд

Type: task
Status: open
Blocked by: 35
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решение 15 (Windows e2e —
отдельным job-ом в `ci-ok`, сначала не блокирующим, блокирующим после примерно пяти зелёных run-ов подряд;
начать с разбора красных Windows e2e); условие merge `ci-ok` —
[ADR-0083](../../../docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md).

## Что происходит

- После Ticket-а 35 `ci-ok` собирает Linux, macOS (`macos-tests`, `macos-e2e`, `macos-package`) и
  `windows / full-suite` — это `pnpm test` (unit и contract) из `windows-tests.yml`. e2e Playwright на Windows
  в CI не идут нигде: `windows-tests.yml` их не запускает (комментарий в начале файла: «no e2e»).
- Windows e2e гоняет только ПК владельца в gate full. Когда-то красными там были 128 e2e; База ПК на `main`
  `2e70bf0f` — раздел «База ПК 2026-10-28» ниже: 0 красных e2e.
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

## База ПК 2026-10-28

Стартовая точка триажа на runner-е. gate full (`GATE_SCOPE=all`) на ПК владельца, `main` `2e70bf0f`, 08:21–09:06 EET,
CPU на старте 18 %. Exit 2 — красное только в шаге `test`. Логи на ПК:
`C:/Users/Alexey/.claude/worfy-harness/gate/state/logs/c848baa6/2026-10-28T06-21-26Z-69084/`.

| Шаг | Итог |
| --- | --- |
| lint, typecheck | зелёные |
| test (unit и contract) | 2 файла красные, 9371 passed, 462 skipped |
| test:e2e | 323 passed, 16 skipped, 0 failed (23,7 min) |
| test:package | 16 passed, 1 skipped |

- Красные test-ы — flaky под нагрузкой, оба зелёные 2 из 2 в тихих повторах (CPU 25–27 %, 7 файлов, 304 passed):
  `test/contract/terminal-git-bash-close.test.ts` (Git Bash вывел только escape-коды режима, без строки готовности;
  `terminal-harness.ts:300`) и `test/contract/harness-evals-outcome.test.ts` (hook timeout 300 000 ms, файл 705 с).
  Оба — Ticket 23.
- Все 8 красных e2e базы 2026-10-23 (тогда 295 passed, 8 failed) зелёные, в карантине их нет: browser-mcp service worker
  (`:406`), done-stack (`:139`), epic-frame-undo (`:125`), linked-machines — Project машины B (`:780`), linked-notify
  (`:108`), palette-find (`:107`), projects-connect (`:217`), window — размер и положение после перезапуска (`:179`).
- 16 skipped e2e — по платформе: login shell, PATH из Finder, dev-запуск упакованной сборки, terminal-ai (zsh),
  `window:153` (кнопки окна macOS).
- В `test/quarantine` на тот момент 14 записей, все vitest (13 — `win32`, 1 — `darwin`), e2e — ни одной.
- Что падает на runner-е, но не на ПК, — первый шаг этого Ticket-а.

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

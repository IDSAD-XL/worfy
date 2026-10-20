# 78 — Workflow «Windows tests» отказывает `test/contract/harness-scripts.test.ts` с понятной причиной

Type: task
Status: done 2026-10-20T20:17Z
PR: #607
Branch: worfy-windows/78
Blocked by: —
Source: решение владельца 2026-10-20, вариант (a), передано Session на Mac. Строки — на main `2c4df570`.

## Что происходит

`.github/workflows/windows-tests.yml` гоняет на runner-е Windows список test-файлов, и job
останавливается через 10 минут (`timeout-minutes: 10`). `test/contract/harness-scripts.test.ts`
запускает все shell-test-ы Harness. На ПК владельца это около 26 минут (full-прогоны PR #590 и
#596: 1569 и 1574 с). На runner-е файл не успевает никогда, и запуск тратит 10 платных минут на
красный по таймауту, а не на ответ. `scripts/windows-test-list.mjs` проверяет список до установки
зависимостей, но этот файл пропускает: он лежит в `test/contract/`, и в имени нет «e2e», «packaged»
или «acceptance».

## Что делаем

1. `scripts/windows-test-list.mjs` отказывает `test/contract/harness-scripts.test.ts`, как файлы с
   «e2e» в имени: одна строка в stderr с причиной (дольше 10 минут job-а) и с тем, где файл
   гоняется вместо этого (на Windows-ПК владельца), exit 1, без output. `timeout-minutes: 10`
   остаётся.
2. Комментарий в начале `windows-tests.yml` и в начале скрипта называет это правило.
3. `test/contract/windows-tests-workflow.test.ts`: случай отказа в stand-in репозитории и на
   настоящем файле репозитория.

## Готово, когда

- [x] `TEST_FILES=test/contract/harness-scripts.test.ts node scripts/windows-test-list.mjs` — exit 1,
      в stderr — путь в JSON-написании и причина; список, где этот файл один из нескольких, отказан
      целиком.
- [x] `test/contract/windows-tests-workflow.test.ts` — exit 0; мутант без нового правила — красный.
- [x] `timeout-minutes: 10` в workflow не изменён.
- [x] `pnpm lint`, `pnpm typecheck` — exit 0.

## Вне скоупа

- Сам `harness-scripts.test.ts` и его длительность: он остаётся full-прогоном на ПК владельца.
- Запуск workflow: его запускает только владелец и Session на Mac.

## Итог

Сделано в PR #607. `scripts/windows-test-list.mjs`: таблица `RUNS_ON_THE_PC`; `test/contract/harness-scripts.test.ts`
отказан одной строкой в stderr — он идёт около 26 минут на Windows, дольше 10 минут job-а, и гоняется на
Windows-ПК владельца; exit 1, без output. Правило стоит после проверки, что файл есть на диске (находка ревью:
иначе отказ проходил бы и для несуществующего файла). Комментарий в начале скрипта называет правило.
`test/contract/windows-tests-workflow.test.ts`: отказ в stand-in репозитории и на настоящем файле; файл добавлен
в случай «отказан весь список»; test всего репозитория его исключает. `timeout-minutes: 10` не изменён.

На ПК: test workflow с двумя guard-test-ами — exit 0, 129 passed; mutant «правило возвращает undefined» — 3
красных; mutant «настоящий файл переименован» — красный случай репозитория. lint и typecheck — exit 0. Те же
test-ы на пробном слиянии с main `767160f0` — exit 0, 129 passed.

**Не сделано — шаг владельца.** Пункт 2 «Что делаем» наполовину: две строки комментария в начале
`.github/workflows/windows-tests.yml`, которые называют правило. GitHub отказал push-у: у token-а Windows нет
scope `workflow`, а Session на Mac без владельца его не пушит. Patch — в комментарии PR #607
(issuecomment-6291169599). Test-ы от него не зависят.

### Закрытие (2026-10-20)

Влит в main PR-ом #607 (2026-10-20, `87402850`) после gate на Mac; check/windows — по прогону ПК на
`74c0d489`. Ticket закрыт docs-PR-ом с ПК по просьбе Session на Mac.

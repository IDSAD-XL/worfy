# 78 — Workflow «Windows tests» отказывает `test/contract/harness-scripts.test.ts` с понятной причиной

Type: task
Status: claimed 2026-10-20T12:39Z
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

- [ ] `TEST_FILES=test/contract/harness-scripts.test.ts node scripts/windows-test-list.mjs` — exit 1,
      в stderr — путь в JSON-написании и причина; список, где этот файл один из нескольких, отказан
      целиком.
- [ ] `test/contract/windows-tests-workflow.test.ts` — exit 0; мутант без нового правила — красный.
- [ ] `timeout-minutes: 10` в workflow не изменён.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0.

## Вне скоупа

- Сам `harness-scripts.test.ts` и его длительность: он остаётся full-прогоном на ПК владельца.
- Запуск workflow: его запускает только владелец и Session на Mac.

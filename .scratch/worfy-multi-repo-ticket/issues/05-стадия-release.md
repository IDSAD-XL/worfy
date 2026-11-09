# 05 — Стадия `release`: каталог стадий, проверка tag-а и опубликованной версии

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает» → «Release и подъём версии — стадия Ticket-а (Ticket-ы 04, 05; Q3)»;
«Решено без владельца»; «Риски» (release не приходит, `npm view` и частная registry); «Ticket-ы», «Волны» (Wave 3);
«Ответ на критику», п. 3; «Решения владельца 2026-11-09», Q3;
[ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), пункты 5, 6

Платформенный Ticket: скрипт Harness (`harness/lib/pipeline.cjs`) и запуск `git` и `npm` из main на Mac и Windows;
Windows verdict до merge (ADR-0056). Глубина ревью — `high`.

Правит те же `pipeline.ts` и `stages.ts`, что Ticket 04, поэтому идёт после него.

## Что происходит

- Потребитель видит библиотеку только через выпущенную версию: зависимость — диапазон версий в `package.json`,
  публикацию запускает tag в репозитории библиотеки.
- Каталог стадий Pipeline — `src/shared/workflow/pipeline.ts:15`, `harness/lib/pipeline.cjs`,
  `harness/profiles/README.md`, строка `workflow.pipeline` Profile-а. Стадии `release` в нём нет.

## Что делаем

1. Стадия `release` в каталоге стадий (`pipeline.ts`, `pipeline.cjs`, `profiles/README.md`). Ticket стоит на ней, пока
   хоть одна строка `Release:` не выполнена; факт стадии несёт «waits for release <version>» для Board (Ticket 06).
2. `src/main/workflow/release.ts` (новый) — worfy release не делает, только замечает:
   - `tag` — tag есть в remote репозитория библиотеки (`git ls-remote --tags`);
   - `package` — версия опубликована (`npm view <name>@<version> version` в checkout-е потребителя, с его настройками
     registry, `.npmrc`).
   Registry недоступна — стадия пишет «release not checked», а не «released».
3. CI потребителя, красный до release, не красит Ticket, пока строка `Release:` не выполнена; после release красный CI
   — обычный красный (раздел «Решено без владельца»).
4. Project без строк `Release:` проходит стадию сразу; Project, который не включил её в `workflow.pipeline`, её не
   видит. `stuck_after` стадии подсвечивает Ticket, если release не приходит.
5. `CONTEXT.md`: стадия `release` в описании Pipeline — единственный новый термин Epic-а.

## Готово, когда

- [ ] Contract test: строка `Release: lib tag lib-v1.4.0`, tag-а в remote нет — Ticket на `release`; tag появился —
      стадия пройдена (stub `git`).
- [ ] Contract test: `Release: lib package <name>@<version>` — `npm view` без версии держит стадию, с версией —
      проходит; ошибка registry — «release not checked» (stub `npm`).
- [ ] Contract test: красный CI потребителя до release Ticket не красит; после release — красит.
- [ ] Test: Ticket без `Release:` проходит стадию сразу; Profile без `release` в `workflow.pipeline` — стадии нет.
- [ ] `CONTEXT.md` и `harness/profiles/README.md` описывают стадию `release`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).
- [ ] Contract test `workflow-release` на Windows — exit 0.
  - needs: windows

## Тесты

- Unit `test/unit/pipeline.test.ts`; contract `test/contract/workflow-release.test.ts` (новый).
- Сначала падающий: на `main` в каталоге стадий нет `release`.

## Где в коде

- `src/shared/workflow/pipeline.ts`
- `src/main/workflow/stages.ts`
- `src/main/workflow/release.ts` (новый)
- `harness/lib/pipeline.cjs`
- `harness/profiles/README.md`
- `CONTEXT.md`
- `test/unit/pipeline.test.ts`
- `test/contract/workflow-release.test.ts` (новый)

# 01 — Очередь Acceptance в main и каналы: правило «ждёт владельца», группы, хранилище «Sent», `acceptance.get` и `acceptance.changed`

Type: task
Status: claimed 2026-11-23T20:14Z
PR: #2153
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 1; «Решения по реализации» → «Одно правило «ждёт владельца»», «Группы»,
«Служба в main», ««Sent» — отправлено, но ещё не записано»; «Решения по test-ам», Seam 1 и 2; «Вопросы владельцу», Q1 и
Q4

Кто: агент.

Не платформенный Ticket (`src/shared/`, `src/main/`, без Harness). Глубина ревью — `medium`.

Вне Epic-а этот Ticket ждёт двух вещей (поле Blocked by берёт только номера этого Epic-а): merge docs PR разбора
2026-11-06 (Orchestrator отмечает строками Evidence проверки Stable copy, которые владелец отдал ему; Q1 spec-а) и merge
[worfy-polish 132](../../worfy-polish/issues/132-метка-manual-читается-рядом-с-вручную.md) — метка `(manual)` читается
рядом с `вручную`. Без первого очередь покажет владельцу работу Orchestrator-а, без второго — не покажет 15 Ticket-ов
worfy с `(manual)`.

## Что происходит

- Ручной пункт и его состояние уже есть в модели Project-а: `manual`, `checked` и `state` пункта
  (`src/shared/workflow/types.ts`, схема `evidenceItemSchema`), `itemState` (`src/shared/workflow/evidence.ts`).
- Правило «Ticket ждёт владельца» (`blocked` с `Waits: owner`) живёт только в очереди Autopilot: `ownersOwn`
  (`src/shared/autopilot/epic-queue.ts:38`), не экспортирован.
- Модели всех Project-ов Machine держит workflow hub (`src/main/ipc/workflow.ts`, `workflowHub`) и следит за
  Ticket-файлами; так уведомления «ждёт тебя» читают его без gh и git (`src/main/workflow/waits-notify.ts`).
- Канал без Project-а в запросе — образец `projectPulse.get` и `projectPulse.changed`
  (`src/shared/ipc/project-pulse.ts:40-43`, `src/main/ipc/project-pulse.ts`). Хранилище состояния в папке данных
  Project-а — образец `src/main/projects/pr-inbox-state.ts`.
- Списка «что ждёт владельца по всем Project-ам» нет нигде (spec, «Проблема»).

## Что делаем

1. `src/shared/acceptance/queue.ts` — чистые функции над моделями Project-ов: пункт ждёт владельца, когда он ручной, без
   `[x]` и не `verified`; Ticket ждёт сам, когда `blocked` с `Waits: owner` (`ownersOwn` становится общей функцией,
   очередь Autopilot зовёт её же). Группы в порядке spec-а: Ready to check, Update first, Waits for you, Failed, In work,
   Older (Ticket-ы, закрытые больше 14 дней назад; Q1); внутри — по Project-у, Epic-у, номеру Ticket-а и пункта. Для
   Update first функция принимает ответ «есть ли изменение в Stable copy» как вход; считает его Ticket 02.
2. `src/main/acceptance/service.ts` — служба по всем Project-ам Machine поверх workflow hub, как
   `installWaitsNotifications`: пересчёт только при изменении модели, gh и git не запускаются.
3. `src/main/acceptance/sent-store.ts` — хранилище «Sent» в папке данных Project-а: Project, Epic, номер Ticket-а, номер
   и hash текста пункта, вердикт, время; слов владельца нет. Запись уходит, когда в checkout-е появилась строка
   `owner-check` с тем же вердиктом; после 24 часов без строки — состояние «Not recorded yet». Перезапуск запись не теряет.
4. `src/shared/ipc/acceptance.ts` и `src/main/ipc/acceptance.ts`: `acceptance.get` и событие `acceptance.changed`,
   `'project', 'read'`, без Project-а в запросе. Снимок несёт пункт, его строки Evidence, неручные пункты Ticket-а,
   отметку «Sent» и место для строки Stable copy (её заполняет 02).
5. Английская страница `docs/features/acceptance.md` (новая): что считается «ждёт владельца», группы, «Sent». Перевод и
   правки других страниц — Ticket 09.

## Готово, когда

- [ ] Unit test (`test/unit/acceptance-queue.test.ts`, новый): ручной без `[x]` и не `verified` — ждёт; `[x]` или
      `verified` — нет; неручной — нет; `blocked` + `Waits: owner` без ждущих пунктов — Waits for you; последняя строка
      `fail` — Failed; не влит — In work; закрыт больше 14 дней назад — Older; порядок групп и внутри группы. Красный до
      правки — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/acceptance-queue.test.ts` exit 0, red before the change (module missing); 11 mutants of the queue each red · mac - · 612b46128
- [ ] `test/unit/epic-queue.test.ts` зелёный с общей функцией `ownersOwn`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/epic-queue.test.ts` exit 0 with the exported ownersOwn; red before (ownersOwn is not a function) · mac - · 612b46128
- [ ] Contract test (`test/contract/acceptance-service.test.ts`, новый): служба над двумя временными Project-ами с
      Ticket-файлами отдаёт снимок по обоим; правка Ticket-файла даёт `acceptance.changed`; «Sent» переживает новый
      экземпляр службы и уходит, когда в файле появилась строка `owner-check` с тем же вердиктом.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/acceptance-service.test.ts` exit 0; 8 mutants of the service, store and channel each red · mac - · 612b46128
- [ ] Английская страница `docs/features/acceptance.md` описывает правило, группы и «Sent»;
      `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 (39 pages) · mac - · 612b46128
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0; `gate fast` exit 0 · mac - · 612b46128

## Где в коде

- `src/shared/acceptance/queue.ts`, `src/main/acceptance/service.ts`, `src/main/acceptance/sent-store.ts`,
  `src/shared/ipc/acceptance.ts`, `src/main/ipc/acceptance.ts` (новые)
- `src/shared/autopilot/epic-queue.ts` (`ownersOwn` становится общей)
- `src/main/index.ts` (запуск службы и регистрация каналов)
- `test/unit/acceptance-queue.test.ts`, `test/contract/acceptance-service.test.ts` (новые), `test/unit/epic-queue.test.ts`
- `docs/features/acceptance.md` (новый)

Только читать: `src/main/workflow/waits-notify.ts`, `src/main/ipc/workflow.ts`, `src/shared/ipc/project-pulse.ts:40-43`,
`src/main/projects/pr-inbox-state.ts`, `src/shared/workflow/evidence.ts`, `src/shared/workflow/types.ts`.

## Вне скоупа

- Строка Stable copy и группа Update first по-настоящему — Ticket 02; канал решения — Ticket 03; UI — Ticket 05.
- Метка `(manual)` — `worfy-polish` 132.

## Итог

- Красный до правки: `node scripts/vitest-electron.mjs run test/unit/acceptance-queue.test.ts test/unit/epic-queue.test.ts
  test/contract/acceptance-service.test.ts` — exit 1: `Cannot find module '../../src/shared/acceptance/queue'`,
  `Cannot find module '/src/main/acceptance/service'` (5 contract test-ов), `ownersOwn is not a function` в
  `epic-queue.test.ts`.
- Mutants по одному на поведение (20) в копии под `mktemp -d`: каждый красный на своём test-е — правило пункта
  (`[x]`, `verified`, ручной), строка Waits for you, Failed, Ticket владельца в Ready to check, `done` только в ветке,
  порог Older, Update first, порядок, неручные пункты, `ownersOwn` с `trim`/регистром, изменение модели не доходит,
  «Sent» снимается старой строкой или не снимается вовсе, 24 часа, перезапуск теряет «Sent», отметка неждущего пункта,
  нет `acceptance.changed`, текст пункта в файле «Sent».
- Решено без владельца: «влит» читается из модели без gh — Ticket `done` в checkout-е main-ветки (ADR-0107) и не
  только в своей ветке; запись «Sent» помнит число строк `owner-check` того же вердикта при отправке и уходит, когда их
  стало больше (повторный Fail на уже проваленном пункте не снимается старой строкой); запись уходит и когда пункт
  переписан или больше не ждёт владельца; Waits for you и Ready to check Ticket-а владельца требуют `blocked` с `Waits: owner`: `ownersOwn` общая и
  не менялась, но Ticket без статуса (`none`), который Autopilot тоже оставляет владельцу, очередь не показывает ждущим
  (round 2); порядок «по Project-у» — порядок списка Project-ов, как у `projectPulse`.
- Вне следа: `test/unit/link-access.test.ts` (канал `acceptance.get` в списке `read`) и
  `test/contract/windows-tests-workflow.test.ts` (выборка 13 файлов пропускает имена с запрещённым словом: новый
  `acceptance-queue.test.ts` встал первым по алфавиту).
- docs PR разбора 2026-11-06 на `main` не влит: у `worfy-week` 05, 08–12, 15, 17, 18 и `worfy-harness` 18, 19, 21, 24,
  25 ручные пункты по-прежнему без `[x]` и без строк Evidence (на `7553f9dd5`). Код это не блокирует; до этого PR
  очередь покажет владельцу эти пункты.

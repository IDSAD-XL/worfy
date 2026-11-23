# 01 — Очередь Acceptance в main и каналы: правило «ждёт владельца», группы, хранилище «Sent», `acceptance.get` и `acceptance.changed`

Type: task
Status: claimed 2026-11-23T20:14Z
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
- [ ] `test/unit/epic-queue.test.ts` зелёный с общей функцией `ownersOwn`.
- [ ] Contract test (`test/contract/acceptance-service.test.ts`, новый): служба над двумя временными Project-ами с
      Ticket-файлами отдаёт снимок по обоим; правка Ticket-файла даёт `acceptance.changed`; «Sent» переживает новый
      экземпляр службы и уходит, когда в файле появилась строка `owner-check` с тем же вердиктом.
- [ ] Английская страница `docs/features/acceptance.md` описывает правило, группы и «Sent»;
      `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

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

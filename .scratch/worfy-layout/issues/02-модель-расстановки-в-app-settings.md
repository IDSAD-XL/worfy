# 02: Модель расстановки в app settings

Type: task
Status: claimed 2026-11-27T02:06Z
Branch: worfy-layout/02
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 02; «Решения по реализации» («Модель расстановки», «Хранение», «Окно Linked machine (Q13)»); «Решения по test-ам», Seam 1 и Seam 2; «Риски» («Сборка новее и сборка старее»); «Волны», Wave 1

Кто: агент.

## Что строить

- Расстановку View button-ов по зонам сейчас задаёт код; хранить её негде.
- Новый модуль без React `src/shared/layout/view-buttons.ts`: id, зоны, расстановка по умолчанию, ремонт,
  перемещения.
- Поле `viewButtons` в схеме app settings, мягкое чтение файла, patch с `null`, `merge` store. Без UI.

## Где в коде

- `src/shared/layout/view-buttons.ts` (новый)
- `src/shared/settings/app-settings.ts` — `appSettingsSchema` `:292`
- `src/main/settings/store.ts` — `appSettingsFileSchema` `:128`, `autoContinue` `:181-185`, `appSettingsPatchSchema`
  `:348`, `merge` `:330`
- Только читать: `src/shared/ipc/app-settings.ts` (каналы `local` `:12-18`), `src/renderer/ipc.ts` (`routeOf`
  `:60-63`), `src/renderer/settings/useAppSettings.ts` (`appSettings.changed` `:41`)

## Решения

spec.md, раздел «Решения по реализации», «Модель расстановки», «Хранение» и «Окно Linked machine (Q13)»:

- `VIEW_BUTTON_IDS` — шесть id. `VIEW_ZONES = ['header', 'rail', 'footer']`.
- `ViewButtons = { header: id[], rail: id[], footer: id[] }`. `DEFAULT_VIEW_BUTTONS`: header `canvas, session`; rail
  `pull-requests, acceptance`; footer `pipeline, history` (Q1, Q12).
- Чистые функции: `repairViewButtons(raw)`, `moveWithin(layout, zone, from, to)`, `moveToZone(layout, id, zone,
  index?)` (без `index` — в конец зоны), `isDefault(layout)`.
- Правило ремонта при чтении — решено без владельца. Неизвестный id (вид, убранный в новой сборке, или id из сборки
  новее) отбрасывается. Повтор id — первый остаётся. Отсутствующий id (вид, добавленный позже) встаёт в конец своей
  зоны по умолчанию. Не та форма — расстановка по умолчанию. Каждый из шести id всегда ровно в одной зоне (Q6: прятать
  нельзя).
- Хранение — app settings этой Machine (Q5). Поле `viewButtons` в `appSettingsSchema`, необязательное: нет поля —
  расстановка по умолчанию, как у `productSession` и `prInboxNotify`. Строгая схема — `z.enum` id. Функция
  `viewButtonsOf(settings)`.
- Файл читается мягко (`appSettingsFileSchema`): `z.unknown().transform(repairViewButtons).optional().catch(undefined)`,
  как `autoContinue`. Испорченное поле не делает весь `app-settings.json` unreadable и не сбрасывает остальные
  настройки.
- Patch (`appSettingsPatchSchema`): `viewButtons` — вся расстановка целиком или `null`. `null` — Reset layout: поле
  убирается. Store чинит пришедшую расстановку тем же `repairViewButtons`, `merge` и сравнение ревизий её знают.
- Имя поля — не «layout», решено без владельца: в CONTEXT.md **Layout** — положение Node-ов на Canvas.
- Окно Linked machine (Q13) — нового пути чтения не нужно: каналы `appSettings.get`, `appSettings.set` и
  `appSettings.changed` помечены `local`, и из окна Linked machine канал `local` идёт в main этого компьютера. Epic
  закрепляет это test-ом и комментарием у `viewButtonsOf`. Отдельный канал не вводится.
- ADR не нужен: расстановка — ещё одно поле app settings (ADR-0005), маршрут `local` уже задан ADR-0053.
- Риск (раздел «Риски»): Mac Stable и dev-копия могут читать один `app-settings.json`. Ремонт при чтении не даёт
  неизвестному id сломать файл, но расстановку, записанную сборкой с новым видом, старая сборка сохранит без него.

## Test-ы

- Unit `test/unit/view-buttons.test.ts` (новый): `repairViewButtons` (неизвестный id, повтор, пропуск, не та форма),
  `moveWithin`, `moveToZone` с индексом и без, `isDefault` (spec.md, «Решения по test-ам», Seam 1).
- Contract `test/contract/app-settings.test.ts`: `app-settings.json` с испорченным `viewButtons` читается —
  расстановка починена, остальные поля целы, файл не уходит в `unreadable`. Patch `null` убирает поле. Ревизия растёт
  (Seam 2).
- Unit-проверка маршрута: `routeOf('appSettings.get') === 'this-machine'` — якорь Q13 (Seam 2).
- Сначала падающий test: красный на старом поведении, это пишется в «Итог».
- `src/shared/settings/` и `src/main/settings/` не описаны в `scripts/e2e-specs.table.json`, поэтому PR запускает все
  spec-файлы e2e.

## Готово, когда

- [ ] Unit-test-ы модели и contract-test store из раздела test-ов зелёные; испорченное поле не сбрасывает остальные
      настройки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/view-buttons.test.ts test/contract/app-settings.test.ts` exit 0 · mac - · 6d43f8889687d77ede457b59c7e856c5506bdb0c
- [ ] Unit-проверка `routeOf('appSettings.get') === 'this-machine'` есть.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/view-buttons.test.ts` exit 0 · mac - · 6d43f8889687d77ede457b59c7e856c5506bdb0c
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 6d43f8889687d77ede457b59c7e856c5506bdb0c
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6d43f8889687d77ede457b59c7e856c5506bdb0c

## Итог

- Модель — `src/shared/layout/view-buttons.ts`; поле `viewButtons` в `appSettingsSchema`, мягкое чтение и patch с
  `null` — `src/main/settings/store.ts`; `viewButtonsOf` с комментарием про окно Linked machine (Q13).
- Сначала красные test-ы: `test/unit/view-buttons.test.ts` падал на импорте (модуля не было); три новых contract-test-а
  в `test/contract/app-settings.test.ts` на прежнем `store.ts` — 3 failed, 74 passed.
- Решено без владельца: patch с неизвестным id отказывается (окно той же сборки шлёт только свои id), с повтором или
  пропуском — чинится; пропавшая зона в файле — «не та форма», расстановка по умолчанию; отсутствующее поле и
  расстановка по умолчанию, записанная явно, — разные состояния store.

# 06 — Переключатель Off / Shadow / On

Type: task
Status: claimed 2026-11-04T13:27Z
Blocked by: —
Source: [spec.md](../spec.md), «Что видит владелец», п. 1; «Решено без владельца», п. 3; «Безопасность», п. 5; «Соседний Epic worfy-retry»; Q1

Глубина ревью: high (кто может включить одобрение).

## Что происходит

- Образец — Eco mode: composer item `src/renderer/session/composer/EcoMode.tsx` (`order = 15`, класс `w-eco`
  `:110-127`, `ECO_MODE_ELSEWHERE` `:23`), IPC `ecoMode` (`src/shared/ipc/eco-mode.ts`, `src/main/ipc/eco-mode.ts`,
  каналы `local`). Eco mode пишет Profile через Harness; Auto-approval этого делать не должен (spec, «Решено», п. 3).
- Настройки Machine — `app-settings.json` (`src/main/settings/store.ts`, ADR-0005); worfy-retry 02 кладёт туда же
  `autoContinue` по id Project-а.

## Что делаем

1. Поле `autoApproval: Record<projectId, 'off' | 'shadow' | 'on'>` в `app-settings.json`
   (`src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`); нет записи — `off`; значение вне схемы —
   `off`.
2. IPC `autoApproval.read` / `autoApproval.set` (`src/shared/ipc/auto-approve.ts`, `src/main/ipc/auto-approve.ts`),
   каналы `local`: с Linked machine не пишется. Функция `autoApprovalMode(projectId)` для Ticket-а 04.
3. Composer item `src/renderer/session/composer/AutoApprove.tsx`, `order = 17`, только у Orchestrator-а; три
   положения Off / Shadow / On; tooltip на каждое; в окне Linked machine read-only с текстом «Auto-approval is set in
   worfy on the Machine of the Project». Вид — рядом с `w-eco`, свой модификатор для трёх положений (`w-eco` не
   меняется).
4. Проверить и записать в «Итог», читает ли `store.ts` файл заново при чужой правке (spec, «Безопасность», п. 5).
   Если читает — режим Auto-approval берётся из памяти, записанной UI, а правка файла извне видна только после
   рестарта.
5. Строка в инвентаре состояния worfy (`docs/adr/0005-worfy-own-state-inventory.md`).

## Готово, когда

- [ ] Unit test компонента: три положения, клик пишет через IPC, read-only на Linked machine, нет у обычной Session.
- [ ] Contract test настройки: нет файла — `off`; мусор — `off`; запись одного Project-а не трогает другие и
      `autoContinue`.
- [ ] Contract test: канал не принимает запись с Linked machine.
- [ ] Ответ про перечитывание `app-settings.json` — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/auto-approve-switch.test.tsx`, contract `test/contract/auto-approve-setting.test.ts` (новые).
- Прогнать test-ы Eco mode и настроек: `test/unit/eco-mode*.test.tsx`, `test/contract/*settings*.test.ts`.

## Где в коде

- `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts` (общие с worfy-retry 02 — не параллельно)
- `src/shared/ipc/auto-approve.ts`, `src/main/ipc/auto-approve.ts` (новые)
- `src/renderer/session/composer/AutoApprove.tsx` (новый), `src/renderer/session/session.css`
- `docs/adr/0005-worfy-own-state-inventory.md`
- `test/unit/auto-approve-switch.test.tsx`, `test/contract/auto-approve-setting.test.ts` (новые)

## Итог

Сделано в PR (ветка `worfy-auto-approve/06`) — всё из «Что делаем».

- **Настройка.** Поле `autoApproval` в `app-settings.json` (`src/shared/settings/app-settings.ts`): запись по id
  Project-а, значения `shadow` / `on`; Off — это отсутствие записи. При чтении файла (`src/main/settings/store.ts`)
  запись с режимом вне трёх, ключ не в форме id Project-а (`<папка>-<8 hex>`, так отсекается и `__proto__`) или поле
  не-объект отбрасываются — читается Off, остальной файл цел. Пишет режим только `AppSettingsStore.setAutoApproval()`;
  в patch `appSettings.set` поля нет. Функция для Ticket-а 04 — `autoApprovalMode(projectId)` в
  `src/main/settings/store.ts` (не в `src/main/ipc/auto-approve.ts`: модуль handler-ов исполняется при импорте).
- **IPC.** `autoApproval.read` / `autoApproval.set` (`src/shared/ipc/auto-approve.ts`, `src/main/ipc/auto-approve.ts`),
  оба `local`; id не из Project-ов этой Machine — отказ, ничего не пишется.
- **Переключатель.** `src/renderer/session/composer/AutoApprove.tsx`, `order = 17`, только у Orchestrator-а: группа из
  трёх кнопок Off / Shadow / On с `aria-pressed`, tooltip на каждой; рамка и подпись — от `w-eco` (подпись прячется
  вместе с подписью Eco mode, когда строке мало места), три положения — модификатор `w-eco--three` и элементы
  `w-eco__positions` / `w-eco__position` в `session.css`; правила `w-eco` не менялись. Место для Auto-continue
  worfy-retry 02 — `order = 16`, между ними. В окне Linked machine — read-only, tooltip «Auto-approval is set in worfy
  on the Machine of the Project», ничего не читается и не пишется.
- **Ответ на п. 4 («Безопасность», п. 5 spec).** `store.ts` читает `app-settings.json` один раз, при первом
  обращении, и дальше отвечает из памяти. Правка файла извне (рукой или командой агента) запущенным worfy не видна;
  следующая запись из UI (любая настройка) кладёт в файл состояние из памяти и правку затирает; после рестарта worfy
  читает файл заново, и правка, если её не затёрли, действует. Проверяют contract test
  `test/contract/auto-approve-setting.test.ts` («an edit of the file made outside worfy…») и e2e
  `test/e2e/auto-approve.spec.ts`.
- **ADR-0005** — раздел `## Amendments` о поле `autoApproval`. Страница `docs/features/sessions.md` — абзац о
  переключателе и строка в карте кода; что делает каждый режим в Run-е, допишет Ticket 10.
- **Test-ы.** Unit `test/unit/auto-approve-switch.test.tsx`, contract `test/contract/auto-approve-setting.test.ts`,
  e2e `test/e2e/auto-approve.spec.ts` (Off по умолчанию, запись по клику, правка извне — только после рестарта).
  Поля `autoContinue` в `main` ещё нет: contract test сравнивает после записи режима все остальные поля состояния,
  так что `autoContinue` worfy-retry 02 попадёт под проверку без правки test-а.
- **Остаётся владельцу (Ticket 11):** посмотреть переключатель вживую, в том числе в окне Linked machine — e2e с двумя
  Machine-ами для него нет, read-only покрыт unit test-ом.

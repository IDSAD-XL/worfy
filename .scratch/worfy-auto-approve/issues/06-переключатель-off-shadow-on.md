# 06 — Переключатель Off / Shadow / On

Type: task
Status: done 2026-11-04T17:14Z
PR: #1368
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
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-switch.test.tsx test/contract/auto-approve-setting.test.ts` exit 0 · mac - · 5487c4ce6e8b759372633f5e5920f624a1715ad0
  - evidence: test-run pass · `pnpm test:e2e test/e2e/auto-approve.spec.ts test/e2e/eco-mode.spec.ts test/e2e/session-controls.spec.ts test/e2e/context-meter.spec.ts` exit 0 · mac dev · 5487c4ce6e8b759372633f5e5920f624a1715ad0
- [ ] Contract test настройки: нет файла — `off`; мусор — `off`; запись одного Project-а не трогает другие и
      `autoContinue`.
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-switch.test.tsx test/contract/auto-approve-setting.test.ts` exit 0 · mac - · 5487c4ce6e8b759372633f5e5920f624a1715ad0
- [ ] Contract test: канал не принимает запись с Linked machine.
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-switch.test.tsx test/contract/auto-approve-setting.test.ts` exit 0 · mac - · 5487c4ce6e8b759372633f5e5920f624a1715ad0
- [ ] Ответ про перечитывание `app-settings.json` — в «Итог».
  - evidence: commit pass · Auto-approval: the inspector is asked on every request; Electron fuses ticket · - - · 5487c4ce6e8b759372633f5e5920f624a1715ad0
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5487c4ce6e8b759372633f5e5920f624a1715ad0

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
- **Переключатель.** `src/renderer/session/composer/AutoApprove.tsx`, `order = 17`, только у Orchestrator-а: кнопка
  вида Eco mode (`w-eco` + модификатор `w-eco--three`, правила `w-eco` не менялись) с дорожкой, где knob стоит в одном
  из трёх мест — Off (пустое кольцо), Shadow (половина), On (галочка на зелёном); tooltip кнопки — текущего режима.
  Клик открывает menu из трёх положений (`menuitemradio`, tooltip и строка пояснения у каждого), выбор пишет режим.
  Подпись «Auto-approval» — свой класс `w-auto-approval__label`, прячется вместе с подписью Eco mode. В окне Linked
  machine — read-only, tooltip «Auto-approval is set in worfy on the Machine of the Project», menu не открывается,
  ничего не читается и не пишется.
- **Почему menu, а не три кнопки рядом (решено без владельца).** Первая версия — три кнопки Off / Shadow / On в строку
  (125 px) — уронила в CI e2e `session-controls.spec.ts` и `context-meter.spec.ts`: в окне 1280×800 с sidebar строка
  controls — 674 px, до Ticket-а в ней было занято 592 px, и Send уходил на свою строку. Кнопка с menu — 46 px, после неё
  свободно около 30 px. Auto-continue worfy-retry 02 (`order = 16`) размером с Eco mode (36 px + 8 px gap) в 1280×800 уже
  не поместится рядом без переноса Send: этому Ticket-у понадобится либо меньший элемент, либо пересмотр правила e2e.
- **Ответ на п. 4 («Безопасность», п. 5 spec).** `store.ts` читает `app-settings.json` один раз, при первом
  обращении, и дальше отвечает из памяти. Правка файла извне (рукой или командой агента) запущенным worfy не видна;
  следующая запись из UI (любая настройка) кладёт в файл состояние из памяти и правку затирает; после рестарта worfy
  читает файл заново, и правка, если её не затёрли, действует. Проверяют contract test
  `test/contract/auto-approve-setting.test.ts` («an edit of the file made outside worfy…») и e2e
  `test/e2e/auto-approve.spec.ts`.
- **Debugging port — это Off (round 2 review).** Пока worfy запущен с `--remote-debugging-port` /
  `--remote-debugging-pipe` или Node inspector (`--inspect`, `node:inspector` открыт), любой процесс Machine ведёт окно
  worfy через CDP и зовёт IPC как UI. `debugAccess()` в `src/main/settings/store.ts` смотрит `process.argv`, адрес
  inspector-а и `app.commandLine.hasSwitch` (loader Playwright-а убирает `--remote-debugging-port` из `process.argv` и
  передаёт его Chromium-у через `app.commandLine`). Тогда `autoApprovalMode()` отвечает Off, `autoApproval.set`
  отказывает в Shadow и On, `autoApproval.read` отвечает `{mode: 'off', saved, blocked: <причина>}`, переключатель
  показывает Off, недоступен, tooltip называет причину и сохранённый режим. Цена: Stable владельца, запущенный с CDP
  9351, и любой e2e под Playwright всегда видят Auto-approval Off. Адрес inspector-а спрашивается при каждом запросе
  (contract test с mock-ом `node:inspector`, открытым после загрузки модуля). Пока порт открыт, переключатель
  недоступен целиком, Off из UI тоже не выбрать; IPC Off принимает. **Известный предел — Ticket 12 (Electron fuses).**
  В собранном worfy fuse `EnableNodeCliInspectArguments` включён: `kill -USR1`, запись On через inspector и
  `inspector.close()` проверка не ловит. Ticket 04 и 11 ждут Ticket 12.
- **Id Project-а.** Шаблон хеша, которым кончается id, — один, `src/shared/projects/project-id.ts`; им пользуются
  `projectId()` (`src/main/projects/store.ts`) и схема ключа `autoApproval`. Свои копии шаблона ещё в
  `src/shared/images.ts:56` и `src/shared/browser/partition.ts:12` — вне этого Ticket-а.
- **ADR-0005** — раздел `## Amendments` о поле `autoApproval`. Страница `docs/features/sessions.md` — абзац о
  переключателе и строка в карте кода; что делает каждый режим в Run-е, допишет Ticket 10.
- **Test-ы.** Unit `test/unit/auto-approve-switch.test.tsx`, contract `test/contract/auto-approve-setting.test.ts`,
  e2e `test/e2e/auto-approve.spec.ts`. Playwright всегда открывает debugging port, поэтому e2e проверяет состояние
  «заблокировано»: Off, причина в tooltip, menu не открывается, файл не пишется; сохранённый извне On виден в tooltip
  после рестарта, правка извне до рестарта не видна. Запись по клику покрыта unit test-ом и contract test-ом handler-а.
  Mutation testing round 2: 14 mutant-ов убиты; mutant «устаревший ответ read не отбрасывается» эквивалентен —
  компонент пересоздаётся по `key={projectId}`, старый ответ некуда показать.
  Поля `autoContinue` в `main` ещё нет: contract test сравнивает после записи режима все остальные поля состояния,
  так что `autoContinue` worfy-retry 02 попадёт под проверку без правки test-а.
- **Остаётся владельцу (Ticket 11):** посмотреть переключатель вживую, в том числе в окне Linked machine — e2e с двумя
  Machine-ами для него нет, read-only покрыт unit test-ом.

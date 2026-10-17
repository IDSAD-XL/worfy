# 08 — Settings → «Terminal AI»: переключатели функций, модель Next command, состояние по Limits

Type: task
Status: done 2026-10-14
PR: #309
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 2 (всё выключается в Settings → «Terminal AI»; окно Settings делает Epic worfy-ui), пункт 1(b) (переключатель модели Next command — Sonnet или Haiku), пункт 7 (Epic идёт параллельно с worfy-ui) ([spec.md](../spec.md)); [worfy-ui 02](../../worfy-ui/issues/02-окно-settings.md) (окно Settings, разделы по файлам) и [worfy-ui 08](../../worfy-ui/issues/08-общий-select.md) (общий Select); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункт 4; пометки доступа каналов — `src/shared/ipc/channels.ts:20-34`

## Что происходит

- Окна Settings в worfy нет. Его делает Ticket 02 Epic-а `worfy-ui`: модальный диалог, раздел — файл
  `src/renderer/settings/<Name>Section.tsx` с компонентом по умолчанию, `order` и `title`; окно
  находит файлы само, его правка не нужна. Общие элементы разделов — `SettingRow` и `SettingSwitch`
  (`src/renderer/settings/controls.tsx`). Выбор из списка — общий `Select` Ticket-а 08 `worfy-ui`
  (`src/renderer/theme/Select.tsx`): native `<select>` в renderer после `worfy-ui` нет (его решение
  владельца 4). `Blocked by` держит только Ticket-ы своего Epic-а, поэтому ожидание — в `Status`.
- После Ticket-а 02 этого Epic-а Settings Terminal AI хранятся в `<WORFY_DATA_DIR>/terminal-ai.json`, схема —
  `src/shared/terminal-ai/settings.ts`. Каналы `terminalAi.state`, `terminalAi.setSettings` и событие
  `terminalAi.changed` — `local`: Settings и состояние — машины экрана, как Limits. Выключенная функция
  сразу перестаёт спрашивать модель.
- После Ticket-а 03 widget узнаёт о выключенном Suggestion сообщением `config`. Поэтому 03 — блокер:
  e2e этого Ticket-а проверяет серый текст из истории.
- Ticket 06 (строка `# …`) — не блокер. Если он к claim влит, e2e проверяет и её; если нет — эта
  проверка остаётся приёмке (Ticket 09).
- Переключатели (Ticket 02 этого Epic-а, пункт 7): «Terminal AI»; «Suggestion»; «Ask Claude when history has
  nothing»; «Next command» и его модель; «Command request»; «Fix». По умолчанию всё включено (решение
  владельца 8(b)), модель Next command — Sonnet.
- Terminal AI работает только в Terminal-ах на zsh (решение 4).
- Состояние Limits worfy показывает `LimitsMeter` в toolbar-е (`src/renderer/shell/toolbar/LimitsMeter.tsx`).

## Что делаем

1. Раздел «Terminal AI» окна Settings `worfy-ui` — `src/renderer/settings/TerminalAiSection.tsx`,
   `order` 50, `title` «Terminal AI»: переключатели Ticket-а 02 этого Epic-а — `SettingSwitch`, выбор модели Next
   command (Sonnet или Haiku) — `Select` Ticket-а 08 `worfy-ui` в `SettingRow`. Подчинённые
   переключатели неактивны, когда выключен «Terminal AI» или их функция.
2. Строка состояния по `terminalAi.state`: у функции, выключенной по Limits, — «Paused by Limits
   until 14:20». Рядом — «Works in zsh Terminals».
3. Изменение — `terminalAi.setSettings`; раздел обновляется по `terminalAi.changed`.
4. Окно на Project-е Linked machine-а показывает Settings своей Machine — каналы `local`.

**Не входит:** само окно Settings и его навигация — `worfy-ui`.

## Готово, когда

- [x] Unit (jsdom) `test/unit/terminal-ai-settings.test.tsx` (новый): переключатели показывают значения из `terminalAi.state`; клик зовёт `terminalAi.setSettings` с одним изменённым полем; «Terminal AI» выключен — подчинённые неактивны; статус `paused` — строка «Paused by Limits until …» с временем сброса.
- [x] e2e `test/e2e/terminal-ai-settings.spec.ts` (новый), fake: «Suggestion» выключен — после команды с уникальной меткой набран её префикс, серого текста нет; включён снова — есть. «Terminal AI» выключен — серого текста нет и из истории. Если Ticket 06 к claim влит: «Terminal AI» выключен — строка `# …` + Enter не даёт запроса (журнал fake пуст). — Ticket 06 к claim не влит: проверка строки `# …` остаётся приёмке (Ticket 09).
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: раздел «Terminal AI» в светлой и тёмной теме — `../evidence/08-settings-light.png`, `../evidence/08-settings-dark.png`. Как проверить: окно Settings worfy. — не проверено: `pnpm dev` с настоящим HOME не запускался; снимки по этим путям сделаны Playwright-ом на собранном приложении с временным `HOME` (e2e этого Ticket-а).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — unit «переключатели показывают значения из `terminalAi.state`»: раздела
ещё нет. Как test открывает окно Settings — из «Итог» Ticket-а 02 `worfy-ui` (e2e зовёт пункт меню
«Settings…» по id). В «Итог» — как падал первый test.

## Где в коде

- `src/renderer/settings/TerminalAiSection.tsx` (новый; раздел окна Settings Ticket-а 02 worfy-ui)
- `test/unit/terminal-ai-settings.test.tsx` (новый)
- `test/e2e/terminal-ai-settings.spec.ts` (новый)

Окно Settings находит раздел по файлу (Ticket 02 `worfy-ui`): файлы окна этот Ticket не правит (риск
11 spec-а).

## Итог

2026-10-14. Ветка `worfy-terminal-ai/08`.

### Что сделано

- **Раздел** `src/renderer/settings/TerminalAiSection.tsx`: `order` 50, `title` «Terminal AI»; окно Settings
  находит его само, его файлы не правились. Строки сверху вниз: «Terminal AI»; со сдвигом вправо —
  «Suggestion», под ней ещё правее «Ask Claude when history has nothing»; «Next command», под ней «Next
  command model» (общий `Select`, Sonnet или Haiku); «Command request»; «Fix». Все строки — `SettingRow`,
  переключатели — `SettingSwitch`. У строки «Terminal AI» подсказка «Claude suggests commands and never
  runs them. Works in zsh Terminals.»
- **Подчинённые неактивны.** «Terminal AI» выключен — неактивны все переключатели под ним и выбор модели;
  «Suggestion» выключен — неактивен «Ask Claude when history has nothing»; «Next command» выключен —
  неактивен выбор модели. Значение неактивного переключателя сохраняется и видно. Не только цветом:
  у каждой такой строки под подсказкой текст «Off while Terminal AI is off.» (или «… Suggestion is off.»,
  «… Next command is off.»). Если выключены и «Terminal AI», и своя функция, строка называет «Terminal AI».
- **Пауза по Limits.** `features[<функция>].state === 'paused'` — у строки этой функции текст «Paused by
  Limits until 14:20» цветом `--blocked-text`, `role="status"`. Если пауза снимается в другой день — с
  днём недели: «Paused by Limits until Thu 09:00» (как пишет время сброса `LimitsMeter`). Строки: `suggest`
  — у «Ask Claude when history has nothing» (функция `suggest` — это модель за Suggestion), `next` — у
  «Next command», `request`, `fix` — у своих. Переключатель при паузе не меняется и остаётся активным.
- **Каналы** — новый hook `src/renderer/settings/useTerminalAi.ts` (разрешён brief-ом сверх «Где в коде»):
  `terminalAi.state` при показе раздела, подписка на `terminalAi.changed`, клик — `terminalAi.setSettings`
  с одним полем. Переключатель двигается по ответу main, не раньше. Ответ вызова (и первый снимок)
  берётся, только если с момента вызова не пришло ни одного `terminalAi.changed`: пришедшее событие —
  состояние новее, в каком бы порядке ни дошли событие и ответ. Отказ `setSettings` — «Not saved:
  <причина>» (`role="alert"`), сообщение решает последний клик. Отказ `terminalAi.state` — «Terminal AI
  settings are unavailable: <причина>», переключателей нет. Каналы `local`: окно на Project-е Linked
  machine-а показывает и меняет Terminal AI своей Machine.
- Свой CSS не понадобился: сдвиг и цвета — inline-стили на токенах темы, как в `HealthSection.tsx`.

### Как падал первый test

`test/unit/terminal-ai-settings.test.tsx` до раздела: `Error: Failed to resolve import
"../../src/renderer/settings/TerminalAiSection" from "test/unit/terminal-ai-settings.test.tsx". Does the
file exist?` — `Test Files 1 failed (1)`, exit 1. После раздела — 28 из 28 зелёные.

### Test-ы

- Unit (jsdom), 28 test-ов: раздел в окне Settings после Machines, `order` 50; значения из
  `terminalAi.state` на переключателях и модели; по умолчанию всё включено и Sonnet; до ответа main
  ничего не рисуется; клик по каждому из шести переключателей — `setSettings` с одним полем, переключатель
  двигается по ответу; выбор модели — `{nextCommandModel: 'haiku'}`; три случая неактивности с текстом;
  `terminalAi.changed` перерисовывает, после закрытия подписка снята; событие до первого ответа и событие
  до ответа клика не затираются старым ответом; отказы `setSettings` и `state`; ответы не по порядку —
  сообщение решает последний клик; без подписки (нет bridge) раздел работает по ответам; «Paused by Limits
  until 14:20» только у своей функции, во всех четырёх функциях, в заданном часовом поясе, с днём недели,
  `role="status"`, исчезает по `terminalAi.changed`.
- e2e (собранное приложение, `WORFY_AGENT=fake`, временный `HOME` с `.zshrc`, `SHELL` — zsh машины,
  метка команды уникальная), 3 test-а:
  1. zsh уже запущен, команда с меткой выполнена: префикс даёт серый остаток; «Suggestion» выключен (клик)
     — префикс серого не даёт, буква за буквой; включён снова (Space с клавиатуры) — серый есть;
     «Terminal AI» выключен — серого нет, хотя «Suggestion» включён; включён — серый есть. `config`
     доходит до shell-а, когда zsh ждёт клавишу (долг Ticket-а 03), поэтому проверка повторяет набор через
     `expect(...).toPass()`, без фиксированных пауз. `terminal-ai.json` проверяется после каждой смены.
  2. Раздел: шесть переключателей по порядку, все включены, Sonnet, «Works in zsh Terminals.»; Tab идёт
     сверху вниз, выбор модели — после «Next command»; модель с клавиатуры (↓, ↓, Enter) — Haiku и в файле;
     Space на «Fix»; «Next command» выключен — модель неактивна с текстом; «Terminal AI» выключен — всё
     под ним неактивно, шесть строк «Off while Terminal AI is off.», клик по неактивному ничего не меняет;
     повторное открытие показывает сохранённое. Контраст: каждый текст раздела (подписи, подсказки, строки
     «Off while…» и «Paused by Limits…», кнопка модели) — не меньше 4,5:1 к фону в обеих темах, по
     вычисленным цветам.
  3. Пауза: `limits.json` с окном 5 часов на 92 % и сбросом через 40 минут — «Paused by Limits until
     HH:MM» у «Ask Claude when history has nothing» и «Next command» (время — сброс окна в часовом поясе
     машины), у «Command request» и «Fix» нет; переключатели не меняются; «Next command» выключен —
     строки паузы нет, включён — снова есть. Контраст в обеих темах.

### Mutation testing

- Unit: 55 мутантов `TerminalAiSection.tsx` и `useTerminalAi.ts` (`/tmp/worfy-tai-w3/impl-08/mut/run.mjs`,
  исходник восстанавливается из копии, контрольные суммы совпали) — все 55 роняют unit test: каждое поле
  каждого переключателя (что показывает, что шлёт, неактивность), три правила неактивности и порядок
  причин, модель (значение, неактивность, выбор, имя), строка паузы у каждой функции, день недели, часовой
  пояс, `role="status"`, сообщения об ошибках, подписка и отписка, правило «событие новее ответа».
- e2e: два мутанта на сборке (`/tmp/worfy-tai-w3/impl-08/mut/e2e-mutant.mjs`) — hook двигает переключатель,
  не сообщая main, и строка паузы светло-серая (`#c9c9c9`): красные все три e2e (первый — серый остаток
  `e2e% echo worfy-tai-… second third` после «Suggestion off» через 20 с, второй — `terminal-ai.json` без
  `haiku`, третий — контраст ниже 4,5:1). Контрольные суммы после восстановления совпали.

### Снимки

Playwright, `dialog.screenshot()` на собранном приложении с временным `HOME`
(`WORFY_EVIDENCE_DIR=… pnpm test:e2e test/e2e/terminal-ai-settings.spec.ts`):

- `../evidence/08-settings-light.png`, `../evidence/08-settings-dark.png` — окно Settings на разделе
  «Terminal AI»: шесть переключателей включены, «Next command model» — Sonnet, у «Terminal AI» подсказка
  с «Works in zsh Terminals.»; подчинённые строки сдвинуты вправо; всё помещается без прокрутки.
- `../evidence/08-settings-paused-light.png`, `../evidence/08-settings-paused-dark.png` — у «Ask Claude
  when history has nothing» и «Next command» строка «Paused by Limits until 08:05» (оранжевая в светлой,
  светло-оранжевая в тёмной), у остальных нет; помещается без прокрутки.
- `../evidence/08-settings-off-light.png`, `../evidence/08-settings-off-dark.png` — «Terminal AI»
  выключен: переключатели под ним бледные, у каждой строки «Off while Terminal AI is off.», модель Haiku
  неактивна. Раздел здесь выше окна: строка «Fix» уходит под край, видна после прокрутки.

### Проверки

- `pnpm lint && pnpm typecheck && pnpm test` после rebase на `4d70e68` — exit 0 (234 файла, 4943 test-а).
- `gate.sh fast` — exit 0, `[gate] зелено (fast): worfy/.:lint worfy/.:typecheck worfy/.:test`.
- `pnpm test:e2e test/e2e/terminal-ai-settings.spec.ts test/e2e/settings.spec.ts
  test/e2e/settings-health.spec.ts test/e2e/terminal-ai-history.spec.ts` под `/tmp/worfy-e2e.lock` после
  rebase — exit 0, 10 passed. Test-ы окна Settings (`settings.spec.ts`, `settings-health.spec.ts`,
  `test/unit/settings-dialog.test.tsx`) зелёные без правок.

### Решено без владельца, подтверждено владельцем 2026-10-16

1. Тексты подсказок (английский UI): «Claude suggests commands and never runs them. Works in zsh
   Terminals.», «Grey text after the cursor, from your command history.», «Claude continues the line after
   a short pause in typing.», «On an empty line after a command, Claude suggests what to run next.», «The
   model that suggests the Next command.», «Say what you need in words: Claude writes the command.»,
   «After a command fails, Claude writes a corrected one.». Сочетаний клавиш (`# `, ⌘I) подсказки не
   называют: Ticket-ы 06 и 07 ещё не влиты.
2. Подпись выбора модели — отдельная строка «Next command model» под «Next command».
3. Пауза функции `suggest` показывается у «Ask Claude when history has nothing», а не у «Suggestion»:
   Suggestion из истории Limits не останавливают.
4. Неактивный переключатель показывает сохранённое значение (включённый — бледный включённый), а не
   «выключен»; включение «Terminal AI» возвращает прежний выбор.
5. До первого ответа main раздел пустой (миллисекунды), а не переключатели со значениями по умолчанию.

### Не проверено

- (вручную) `WORFY_AGENT=fake pnpm dev` — не проверено: запуск с настоящим `HOME` владельца агенту
  запрещён; снимки сняты Playwright-ом на собранном приложении. Вид раздела в живом окне и ⌘, — владелец.
- «Terminal AI» выключен — строка `# …` + Enter не даёт запроса: Ticket 06 к claim не влит, проверка
  остаётся приёмке (Ticket 09).
- Снимает ли пауза строку сама в момент сброса окна — main шлёт `terminalAi.changed` (Ticket 02), раздел
  перерисовывается по событию (unit test); e2e ждать сброса окна не может.
- `GATE_SCOPE=all` gate full — не запускал: его запускает Orchestrator.
- Windows: раздел без веток по платформе, но на Windows-ПК не запускался.

### Gate оркестратора (2026-10-14)

- Wave Epic-а под Autopilot (Ticket-ы 04, 05, 06, 08); 08 шёл с первого шага, общих файлов с остальными нет. Гейт — один круг: `VERIFIED` на `057d40d` ([комментарий в PR #309](https://github.com/IDSAD-XL/worfy/pull/309#issuecomment-6161243563)). Verifier сам: gate fast — код 0, не из кэша; unit раздела и окна Settings — 157 passed; e2e `terminal-ai-settings`, `settings`, `settings-health` под замком — 9 passed; 12 unit-мутантов — все красные; e2e-мутант «переключатель двигается, main не вызван» — красный; строка паузы исчезает сама: таймер на `until` в `src/main/terminal-ai/assist.ts:346-367` шлёт `terminalAi.changed`; снимки в обеих темах (обычный вид, «Terminal AI» выключен, пауза по Limits, фокус).
- Мерж: база main `5a1f520`, head `3ad4633`; `GATE_SCOPE=all gate full` — один запуск под замком e2e, код 0, не из кэша, строка `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `975de42`.
- Ручной пункт «Готово, когда» возвращён в `[ ]` (Noted, [low]): `WORFY_AGENT=fake pnpm dev` не запускался, сняты только снимки Playwright-ом на собранном приложении с временным `HOME` — вид в живом окне и ⌘, смотрит владелец.
- Вне Ticket-а: при выключенном «Terminal AI» раздел выше окна Settings, строка Fix видна после прокрутки (`src/renderer/settings/settings.css:15` — высота 520 px, `:41` — тело прокручивается); у неактивного `SettingSwitch` признак — только прозрачность (`settings.css:145`), в этом разделе его возмещает текст строки.

Решение владельца 2026-10-16: все пункты «Решено без владельца» этого Ticket-а приняты пакетом.

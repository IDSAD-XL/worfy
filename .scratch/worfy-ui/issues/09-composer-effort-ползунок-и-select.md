# 09 — Composer: effort — ползунок, Model и Permission mode — Select

Type: task
Status: claimed — 2026-10-13
Blocked by: 08
Source: решение владельца 2026-10-09: 4 (effort — ползунок, как в приложении Claude Code, с уровнями выбранной модели; Model и Permission mode — стилизованные списки на общем Select; макет — `docs/design/F-session-dark.dc.html:177-179`) ([spec.md](../spec.md), «Как устроено», «Select»)

## Что происходит

- Три пикера — native `<select>` в `src/renderer/session/composer/Pickers.tsx`, под полем ввода
  Session (`Pickers.tsx:7`, часть composer-а по файлу — `export const order = 10`, `:14`): модель
  (`:69-84`), effort (`:85-103`), режим разрешений (`:104-121`). Стили — `.w-pickers__select`
  (`src/renderer/session/session.css:772-794`).
- Макет рисует Model, Effort и Permissions в шапке Session (`docs/design/F-session-dark.dc.html:170`;
  кнопки «Model Opus 5.5» и «Effort high» — `:178-179`, chip «Permissions» — `:180-183`), а не под
  полем ввода.
- Модель. Список — из `supportedModels()` SDK: `modelOptions` (`src/main/agent/session.ts:155-163`)
  оставляет модели от sonnet и выше; у каждой — уровни effort (`supportedEffortLevels`). Сохранённая
  модель, которой нет в списке, всё равно показывается (`Pickers.tsx:55-56`). Список обновляется при
  фокусе (`onFocus={refresh}`, `:75`).
- Effort. Все уровни — `EFFORT_LEVELS = ['low','medium','high','xhigh','max']`
  (`src/shared/agent/settings.ts:13`). Пикер показывает:
  - уровни выбранной модели; пока список моделей пуст (не пришёл или упал) — все `EFFORT_LEVELS`
    (`Pickers.tsx:58`);
  - сохранённый уровень, которого у модели нет, — в конце списка (`:59-60`);
  - `null` — «effort default»; пикер неактивен, только когда строк нет совсем: «effort —»
    (`:90`, `:97`).

  Смена модели сбрасывает уровень, которого у новой нет (`:61-65`). Применённый effort
  Claude Code не сообщает — так и пишет `title` пикера (`:88`). Уровень уходит в SDK при старте
  (`src/main/agent/options.ts:246`) и в живую Session (`applyFlagSettings`,
  `src/main/agent/session.ts:252`).
- Режимы разрешений — `PERMISSION_MODES` (`src/shared/agent/settings.ts:8`), подписи — `MODE_LABELS`
  (`Pickers.tsx:16-21`).
- После Ticket-а 08 есть `Select` (`src/renderer/theme/Select.tsx`) с `onOpen`, подписью-префиксом и
  `data-value` на кнопке.
- Test-ы, которые полагаются на native `<select>`:
  - `test/unit/session-view.test.tsx:456-512` (`HTMLSelectElement`, список `option`, `.value`,
    `fireEvent.change` по `picker-model`, `picker-effort`, `picker-permissions`) и `:650` (`.value`);
  - `test/e2e/own-sessions.spec.ts:179-180`, `test/e2e/permissions.spec.ts:58-59` — `selectOption`
    режима и `toHaveValue`;
  - `test/e2e/session-controls.spec.ts:69-86` (`locator('option')`, `selectOption` модели, effort и
    режима, `toHaveValue`), `:154-156` и `:180-184` (`toHaveValue`, `locator('option')`).

## Что делаем

1. **Model и Permission mode — Select Ticket-а 08.** Пикеры остаются под полем ввода; от макета
   берётся вид кнопок: префикс «Model» или «Permissions» и значение. Строки — как сейчас:
   `displayName` моделей и «Default model»; `MODE_LABELS`. Список моделей обновляется при открытии
   (`onOpen`). Сохранённая модель, которой нет в списке, показывается. `data-testid` — прежние, на
   кнопках.
2. **Effort — ползунок.** Кнопка «Effort <уровень>» (вид — макет `:179`) открывает поповер с
   горизонтальным ползунком:
   - отметки слева направо — «default», затем уровни в порядке `EFFORT_LEVELS`: уровни выбранной
     модели (пока список моделей пуст — все) и сохранённый уровень, которого у модели нет, — на своём
     месте по порядку, а не в конце;
   - текущая отметка подписана над ползунком; `aria-valuetext` — имя уровня;
   - ← и →, мышь и тач двигают отметку; в `configure({ effort })` уходит одно значение — когда
     поповер закрывается (Esc, Enter, клик вне) или через 600 ms без движения отметки. События
     `input` и `change` native-ползунка и отдельные нажатия стрелок сами ничего не шлют;
   - кнопка неактивна, «Effort —», только когда отметок нет совсем, как сейчас; у модели без уровней,
     но с сохранённым уровнем — отметки «default» и этот уровень;
   - `title` о применённом effort (`Pickers.tsx:88`) остаётся у кнопки.

   Ползунок — native `<input type="range">` с отметками в цветах токенов.
3. Стили `.w-pickers__select` уступают стилям кнопок Select и ползунка; высота строки composer-а
   не меняется.
4. Test-ы из «Что происходит» выбирают через Select (клик по кнопке и по `option`) и ползунок,
   значение читают из `data-value` кнопки.

Решено в Ticket-е, подтверждено владельцем 2026-10-09: пикеры остаются под полем ввода, а не в шапке Session,
как в макете; ползунок — в поповере кнопки «Effort», а не прямо в строке composer-а; отметка
«default» — слева от уровней модели.

**Не входит:** список уровней (его даёт SDK); общий Select (Ticket 08); перенос пикеров в шапку
Session; смена режима разрешений по сочетанию клавиш.

## Готово, когда

- [x] Unit `test/unit/session-view.test.tsx`: выбор модели, effort и режима — через Select и
  ползунок; sonnet → `configure({ model: 'sonnet' })`; модель, у которой нет текущего уровня,
  сбрасывает его; режим «Plan only» → `configure({ permissionMode: 'plan' })`.
- [x] Unit `test/unit/effort-slider.test.tsx` (новый): отметки — «default» и уровни выбранной
  модели; список моделей пуст — все уровни; сохранённый `low` у модели `[medium, high, xhigh]` стоит
  первым после «default»; → с «high» даёт «xhigh» у модели, где он есть; `aria-valuetext` — имя
  уровня; три нажатия → и закрытие поповера зовут `configure` один раз; три нажатия → и 600 ms
  без движения (fake timers) — тоже один раз; отметок нет — кнопка неактивна.
- [x] e2e `test/e2e/own-sessions.spec.ts`, `test/e2e/permissions.spec.ts`,
  `test/e2e/session-controls.spec.ts` — выбор через Select и ползунок, зелёные. В
  `session-controls.spec.ts` — снимки `composer-pickers` и `effort-slider` (поповер открыт) в светлой
  и тёмной теме.
- [x] grep: `<select` в `src/renderer` нет; `selectOption` в `test/e2e` нет.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.

## Тесты

Сначала падающий test — unit ползунка «отметки — default и уровни модели»: ползунка нет. Затем
перевод `session-view.test.tsx` и e2e на Select. В «Итог» — как падал первый test.

## Где в коде

- `src/renderer/session/composer/Pickers.tsx`
- `src/renderer/session/session.css`
- `test/unit/session-view.test.tsx`
- `test/unit/effort-slider.test.tsx` (новый)
- `test/e2e/own-sessions.spec.ts`
- `test/e2e/permissions.spec.ts`
- `test/e2e/session-controls.spec.ts`

## Итог

Ветка `worfy-ui/09`, база `origin/main` `60e1f563`. Работа шла в три шага, как в брифе Orchestrator-а:
долг Select из «Итог» Ticket-а 08, composer, последний native `<select>` вне composer-а.

- **Как падал первый test.** `test/unit/effort-slider.test.tsx`, «are "default" and the levels of the
  picked model», на коде до правки: `AssertionError: expected null not to be null` в `open()` — клик по
  `picker-effort` не открывал поповер `effort-popover`, потому что effort был native-списком; красными
  были все 33 test-а файла.
- **Composer** (`src/renderer/session/composer/Pickers.tsx`).
  - Model и Permission mode — общий `Select` с префиксом «Model» и «Permissions»; `data-testid`
    прежние, на кнопках, значение — в `data-value` (у модели по умолчанию — пустая строка). Список
    моделей запрашивается заново при каждом открытии (`onOpen`). Сохранённая модель, которой нет в
    списке, показывается; строка «Default model» добавляется, когда в списке нет модели по умолчанию.
  - Effort — кнопка «Effort <уровень>» (`picker-effort`, `aria-haspopup="dialog"`,
    `aria-label="Effort: <уровень>"`, прежний `title`) и поповер `effort-popover` над кнопкой с native
    `<input type="range">` (`effort-slider`). Отметки (`effort-mark`, `data-mark`) — «default», затем
    уровни в порядке `EFFORT_LEVELS`: уровни выбранной модели и сохранённый уровень, которого у модели
    нет, на своём месте. Текущая отметка подписана над ползунком (`effort-current`) и в
    `aria-valuetext`; под ползунком — подписи крайних отметок.
  - Стрелки, Home, End, PageUp и PageDown двигают отметку кодом компонента, а не native-ползунком:
    так у клавиш и у мыши один путь, и он проверяется в jsdom. Мышь и тач идут через событие `input`
    native-ползунка.
  - В `agent.configure` уходит одно значение: когда поповер закрывается (Esc, Enter, нажатие вне,
    клик по кнопке, уход фокуса с кнопки и поповера) или через 600 ms без движения отметки. Уровень,
    который main уже сообщил или который уже отправлен в это открытие, повторно не уходит. Esc
    закрывает только поповер и дальше не идёт; Esc и Enter возвращают фокус на кнопку.
  - Кнопка показывает уровень, который сообщил main (событие `settings`), а не положение отметки:
    так же ведут себя Model и Permission mode. Положение отметки показывает только поповер.
  - Кнопка неактивна, «Effort —», только когда отметок нет совсем.
- **Стили** (`src/renderer/session/session.css`): правила `.w-pickers__select` для native-списка
  удалены, осталась предельная ширина кнопки (220 px); добавлены `.w-effort*` — поповер и ползунок в
  цветах токенов. Кнопки — 24 px, `min-height` строки composer-а (40 px) не менялся.
- **Долг Select** (`src/renderer/theme/Select.tsx`, `test/unit/select.test.tsx`).
  - [med] scroll закрывает список, только если прокрученный элемент (или документ) содержит кнопку.
    Scroll транскрипта рядом с composer-ом список не закрывает. Test «a scroll closes the list only when
    the scrolled element holds the button» на прежнем коде красный.
  - Исправлены долги low, заметные в composer-е: список переставляется после каждого рендера, а не
    один раз (модели приходят в уже открытый список, и список над кнопкой рос бы вниз, на кнопку);
    шеврон двойной ↑↓, как в макете (`SelectChevron`, им же рисуется кнопка Effort); `disabled` под
    открытым списком закрывает его насовсем; при открытии вверх зазор считается с рамкой списка
    (4 px, было 2 px).
  - Закрыты пробелы test-ов: слушатели scroll, resize и blur окна, их снятие при закрытии и
    размонтировании (с тем же флагом capture), Alt+↑, открытие вверх и выбор стороны, возврат фокуса
    на кнопку после выбора.
- **Последний native `<select>`** (`src/renderer/shell/ProjectSettings.tsx`, поле «Terminal shell»):
  переведён на `Select` с прежними `id`, `data-testid="project-settings-shell"` и видом полей формы
  (28 px). Доступное имя — от `<label htmlFor>`, как раньше. Esc на открытом списке закрывает только
  список, окно «Project settings» остаётся. e2e, которые выбирают в этом поле, нет:
  `git grep -n project-settings-shell -- test/e2e` пуст.
- **Снимки** (светлая и тёмная тема), снимает `test/e2e/session-controls.spec.ts`: пикеры —
  [светлая](../evidence/09-composer-pickers-light.png), [тёмная](../evidence/09-composer-pickers-dark.png);
  поповер Effort открыт — [светлая](../evidence/09-effort-slider-light.png),
  [тёмная](../evidence/09-effort-slider-dark.png).
- **Mutation testing.** Каждое правило проверено мутантом в своём дереве, файл возвращался из копии:
  `Select.tsx` — 19 мутантов, `Pickers.tsx` — 56, `ProjectSettings.tsx` — 6; все 81 убиты. Два
  мутанта сначала выжили и получили test: «сторона списка выбирается только по свободному месту» и
  «кнопка Effort показывает положение отметки, а не ответ main».
- **Проверки.** `pnpm lint`, `pnpm typecheck` — exit 0; `pnpm test` — exit 0 (223 файла, 4610
  test-ов); `GATE_SCOPE=all` gate fast — exit 0, «зелено (fast)», с предупреждением: `session.css`
  стал длиннее 1000 строк (990 → 1078). e2e под общим замком — exit 0, 13 из 13:
  `session-controls.spec.ts`, `permissions.spec.ts`, `own-sessions.spec.ts`, `select.spec.ts`,
  `projects-connect.spec.ts`.
- **grep.** `git grep -n '<select' -- src/renderer` и `git grep -n selectOption -- test/e2e` — пусто.
- **Решено без владельца, подтвердить:**
  1. Последний native `<select>` — поле «Terminal shell» в `ProjectSettings.tsx:215` (добавлено
     Ticket-ом `worfy-windows` 10 уже после Ticket-а 08) — переведён на общий Select, потому что
     пункт «Готово, когда» требует «`<select` в `src/renderer` нет». Альтернатива, которую
     Orchestrator не выбрал, — сузить пункт до composer-а и оставить это поле native.
  2. Пока список моделей пуст, ползунок предлагает все уровни и при сохранённой модели. Так написано
     в «Что делаем». Прежний код (`Pickers.tsx:58`) давал все уровни только при модели по умолчанию, а
     при сохранённой модели и пустом списке пикер был неактивен.
  3. Esc закрывает поповер и отправляет уровень, а не отменяет движение отметки: так перечислено в
     «Что делаем» («Esc, Enter, клик вне»).
  4. Пикеры, которые исчезают с непосланным уровнем (Session view закрыт, пикеры перешли к другой
     Session), отправляют его в ту Session, где двигали отметку. Отметка, сдвинутая до того, как у
     пикера пропали уровни, тоже уходит через 600 ms.
  5. `aria-label` кнопки Effort — «Effort: <уровень>», как в макете (`F-session-dark.dc.html:179`);
     у native-списка было «Effort».
  6. У поля «Terminal shell» значение в кнопке моноширинное, а строки списка — шрифтом интерфейса,
     как у полей формы «Add project» (тот же долг, что у `ConnectProject.tsx:635-645`).
- **Убрано.** Атрибут `data-mode` у пикера режима (его никто не читал; то же значение — в
  `data-value`). Подписи строк «effort default», «effort low» и остальные: теперь «default», «low».
  Снимок `pickers-<тема>.png` в `session-controls.spec.ts` заменён на `composer-pickers-<тема>.png`
  из другого test-а того же файла. Обновление списка моделей — при открытии списка, а не при фокусе.
- **Оставшиеся долги Select** (из «Итог» Ticket-а 08, не исправлены):
  - [low] `blur` кнопки не закрывает список: фокус, уведённый кодом (например, палитра по ⌘K), оставляет
    список открытым. Исправление делает недостижимым возврат фокуса в `choose`, поэтому нужно решение,
    а не правка по ходу.
  - [low] курсор встаёт на `disabled` выбранную строку, и Enter на ней ничего не делает. В composer-е
    таких строк нет.
  - [low] `MigrationForm.tsx:203` и `ConnectProject.tsx:635-645` — вне следа, не тронуты.
- **Не проверено:**
  - не проверено: `GATE_SCOPE=all` gate full — шаг Orchestrator-а перед мержем; пункт «Готово, когда»
    оставлен `[ ]`.
  - не проверено: вид и поведение в окне приложения руками (мышь и тач на ползунке, VoiceOver,
    режим фокуса) — GUI-проверки не мои; мышь покрыта только событием `input` в unit test-е.
  - не проверено: поле «Terminal shell» в собранном приложении — оно есть только на Machine с
    выбором shell (Windows); покрыто unit test-ом `test/unit/project-settings-shell.test.tsx`.

# 05 — Machines: точка состояния у заголовка, свёрнута по умолчанию, переключатели — в Settings → Machines

Type: task
Status: claimed — 2026-10-13
Blocked by: 02, 04
Source: решения владельца 2026-10-09: 1 (Machines свёрнута по умолчанию; зелёная точка с лёгкой пульсацией, когда хотя бы одна Linked machine в сети — `online` без `certificateChanged`; нет — точки нет; сменился сертификат — статичная янтарная точка; tooltip (`title`) и `aria-label`; `prefers-reduced-motion`; два переключателя — в Settings → Machines, в секции остаются список и «Link a machine…»; перечислить e2e и шаги приёмки worfy-link 16, которые меняются), 2 (раздел Machines окна Settings) ([spec.md](../spec.md), «Как устроено», «Точка Machines»; риск 6; «Пересечения», worfy-link 16); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (доступ «Linked machines can work with my Projects»)

## Что происходит

- Секция Machines — `src/renderer/shell/sidebar/MachinesSection.tsx`: заголовок `<h2>` «Machines»
  (`:210-214`), список Linked machine-ов (`:222-238`), кнопка «Link a machine…» (`:241-243`) и два
  переключателя `SectionSwitch` (`:244-245`):
  - «Linked machines can work with my Projects» (`link-access-switch`, подпись `:10`);
  - «Keep this computer awake while linked machines are connected» (`link-keep-awake-switch`,
    подпись `:11`).

  Без своей Machine оба неактивны (`:202`). Переключатели оказались в боковой панели, потому что
  общих настроек worfy в UI не было (`.scratch/worfy-link/issues/02-link-a-machine-код-список-и-отзыв.md:14`).
- Хранятся они в `link/settings.json` (`src/main/link/settings.ts:1-8`, по умолчанию доступ выключен,
  keep-awake включён — `:29`); каналы `link.setAccess` и `link.setKeepAwake`
  (`src/renderer/machines/useMachines.ts:63-64`).
- Состояние Linked machine-а — `LinkedMachineView` (`src/shared/ipc/link.ts:76-86`): `state` —
  `online`, `unavailable` или `sleeping`; `certificateChanged`. Renderer — `useMachines()`
  (`src/renderer/machines/useMachines.ts:46-50`). Строка показывает состояние словом и цветом
  (`MachineState`, `MachinesSection.tsx:93-102`): цвет статуса без подписи не показывается
  (`src/renderer/theme/primitives.tsx:40`).
- Отдельной точки состояния нет. Есть точка внутри chip-а — `.w-chip__dot`, 6 px
  (`src/renderer/theme/primitives.css:16-21`), зелёная `--ready-dot` (`:26-28`;
  `src/renderer/theme/tokens.css:55`, `:102`). Янтарь «Certificate changed» — `--blocked-ring`
  (`tokens.css:61`, `:108`).
- Анимация в renderer одна — спиннер Session (`src/renderer/session/session.css:189-197`), и у неё
  есть `prefers-reduced-motion: reduce` (`:199-203`). Токенов движения нет.
- После Ticket-а 04 у секции рамка `SidebarSection` с `defaultCollapsed`; после Ticket-а 02 — окно
  Settings, разделы по файлам, `SettingSwitch`.
- Переключатели и строки Machines трогают e2e:
  - `test/e2e/helpers.ts:463-466` — «Link a machine…» из секции; `:505-506` — состояние строк после
    связи;
  - `test/e2e/linked-machines.spec.ts:20-23` (отзыв правым кликом по строке), `:30-32` (свежая
    Machine: «только кнопка и переключатель»), `:61-65` (`boundingBox` суффикса и chip-а строки),
    `:66` (снимок секции), `:122-138` (доступ переживает перезапуск), `:180` (включить доступ);
  - `test/e2e/linked-sleep.spec.ts:75-79` (оба переключателя), `:86-103` (keep-awake переживает
    перезапуск);
  - `test/e2e/linked-add-project.spec.ts:98`, `test/e2e/linked-cards.spec.ts:80`,
    `test/e2e/linked-notify.spec.ts:52`, `test/e2e/linked-system-actions.spec.ts:126` — включить
    доступ.

  `test/e2e/linked-autopilot.spec.ts:16` упоминает доступ только в комментарии.
- Приёмка worfy-link — Ticket 16, `open` на 2026-10-09. Его шаги смотрят список Linked machine-ов
  (`.scratch/worfy-link/issues/16-приёмка-epic-а-worfy-link.md:37-38`, `:76`), связывают Mac и
  Windows по коду через «Link a machine…» из секции Machines (`:71`) и включают доступ (`:55`,
  `:60`); сквозной e2e — `linked-machines.spec.ts` (`:66`).
- Чистые функции renderer-а test-ы в среде node импортируют по списку: `tsconfig.test.node.json`
  включает их поимённо (например, `src/renderer/find/search-index.ts`); без этого `pnpm typecheck`
  не проходит.
- F-SPEC велит показывать цвет статуса с подписью или иконкой (`docs/design/F-SPEC.md:40`).

## Что делаем

1. **Точка у заголовка «Machines»**, справа от текста, видна и у свёрнутой секции:
   - зелёная (`--ready-dot`) с лёгкой пульсацией — хотя бы одна Linked machine `online` без
     `certificateChanged`;
   - янтарная (`--blocked-ring`), статичная — у какой-нибудь Linked machine `certificateChanged`;
     она важнее зелёной;
   - точки нет — никого в сети (`unavailable`, `sleeping`) или Linked machine-ов нет;
   - у точки `role="img"`, `aria-label` и `title`: «1 linked machine online», «2 linked machines
     online», «Certificate changed — link the machine again»;
   - `prefers-reduced-motion: reduce` — без пульсации.

   Расчёт — чистая функция `machinesDot(linked)` в `src/renderer/machines/machines-dot.ts` (новый);
   файл добавляется в `include` `tsconfig.test.node.json`, как другие чистые функции renderer-а, и
   его unit-test идёт в среде node.
   Вид — `src/renderer/machines/machines.css` (новый): 6 px, как `.w-chip__dot`; пульсация — кольцо
   того же цвета, которое расходится и гаснет, раз в 2 s.
2. **Machines свёрнута по умолчанию** — `defaultCollapsed` рамки Ticket-а 04. Пользователь
   развернул — помнится.
3. **Переключатели — в Settings → Machines**: раздел `src/renderer/settings/MachinesSection.tsx`
   (новый, `order` 40, `title` «Machines») на `SettingSwitch`. Подписи, `data-testid`, неактивность
   без своей Machine и строка ошибки — как в боковой панели. Хранение и каналы не меняются. В
   боковой панели остаются список, контекстное меню строки и «Link a machine…»; `SectionSwitch` и его
   стили удаляются.
4. **e2e.** В `test/e2e/helpers.ts`:
   - перед «Link a machine…» секция Machines разворачивается;
   - новые helper-ы `setProjectsAccess(launched, on)` и `setKeepAwake(launched, on)` берут
     `LaunchedApp` (`app` и `window`, `test/e2e/helpers.ts:35-37`): открывают Settings → Machines через
     `clickMenuItem(launched.app, …)` (`test/e2e/menu.ts` Ticket-а 02) и щёлкают переключатель в
     `launched.window`.

   Spec-файлы из «Что происходит» переходят на них. Перед отзывом правым кликом, `boundingBox`
   строки и снимком секции (`linked-machines.spec.ts:20-23`, `:61-65`, `:66`) секция
   разворачивается.
5. **Приёмка worfy-link 16.** Если к claim она не `done`, её шаги правятся:
   - `:37-38` — список Linked machine-ов смотрят в развёрнутой секции Machines, связь видна и по
     зелёной точке;
   - `:55` и `:60` — переключатель доступа — в Settings → Machines;
   - `:71` — связь Mac и Windows: «Link a machine…» — в развёрнутой секции Machines;
   - `:76` — состояние «спит» — в развёрнутой секции.

   Уже `done` — правки нет, запись об этом в «Итог». Если приёмка в работе — Ticket ждёт её конца
   (spec, «Пересечения»).

Решено в Ticket-е, подтверждено владельцем 2026-10-09: янтарная точка важнее зелёной; тексты tooltip-а; у точки
нет видимой подписи — только tooltip и `aria-label`, это отступление от правила F-SPEC
(`F-SPEC.md:40`) по просьбе владельца, и Ticket 12 записывает его в F-SPEC.

**Не входит:** новые состояния Linked machine-а; рамка и свёрнутость секций (Ticket 04); раздел
«Terminal AI» и другие разделы Settings.

## Готово, когда

- [x] Unit `test/unit/machines-dot.test.ts` (новый): Linked machine-ов нет — точки нет; одна
  `online` — зелёная, «1 linked machine online»; две — «2 linked machines online»; `sleeping` и
  `unavailable` — точки нет; `online` с `certificateChanged` — янтарная; `online` и другая с
  `certificateChanged` — янтарная.
- [x] Unit `test/unit/machines-section.test.tsx` (новый): точка в заголовке с `aria-label`, видна у
  свёрнутой секции; в боковой панели нет `role="switch"`; раздел Settings → Machines — два
  переключателя, клик зовёт `link.setAccess` и `link.setKeepAwake`, без своей Machine они неактивны.
- [x] e2e `test/e2e/linked-machines.spec.ts`: свежая Machine — Machines свёрнута, точки нет; два
  связанных worfy — у обоих зелёная точка с «1 linked machine online», после отзыва — нет; с
  `reducedMotion: 'reduce'` (`page.emulateMedia`) у точки нет анимации; доступ из Settings → Machines
  переживает перезапуск. Снимки `machines-dot` (свёрнутая секция с точкой) и `settings-machines` в
  светлой и тёмной теме.
- [x] e2e `test/e2e/linked-sleep.spec.ts`, `test/e2e/linked-add-project.spec.ts`,
  `test/e2e/linked-cards.spec.ts`, `test/e2e/linked-notify.spec.ts`,
  `test/e2e/linked-system-actions.spec.ts` — зелёные на helper-ах Settings.
- [x] Шаги worfy-link 16 поправлены или в «Итог» записано, что он уже `done`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.

## Тесты

Сначала падающий test — unit `machinesDot`: одна `online` — зелёная. Затем unit секции и e2e.

Перенос переключателей и правка e2e — в одном PR: иначе e2e `worfy-link` краснеют между мержами
(spec, риск 6). Сменённый сертификат в e2e не воспроизвести — его закрывают unit-test-ы. В «Итог» —
как падал первый test.

## Где в коде

- `src/renderer/shell/sidebar/MachinesSection.tsx`
- `src/renderer/machines/machines-dot.ts` (новый)
- `src/renderer/machines/machines.css` (новый)
- `tsconfig.test.node.json`
- `src/renderer/settings/MachinesSection.tsx` (новый)
- `test/unit/machines-dot.test.ts` (новый)
- `test/unit/machines-section.test.tsx` (новый)
- `test/e2e/helpers.ts`
- `test/e2e/linked-machines.spec.ts`
- `test/e2e/linked-sleep.spec.ts`
- `test/e2e/linked-add-project.spec.ts`
- `test/e2e/linked-cards.spec.ts`
- `test/e2e/linked-notify.spec.ts`
- `test/e2e/linked-system-actions.spec.ts`
- `.scratch/worfy-link/issues/16-приёмка-epic-а-worfy-link.md`

## Итог

Сделано, ветка `worfy-ui/05`. Схема настроек, IPC, preload, рамка секции (`SidebarSection.tsx`) и
`sidebar-section.css` не менялись. ADR не понадобился.

**Точка.** `machinesDot(linked)` в `src/renderer/machines/machines-dot.ts` — чистая функция:
янтарная, если у какой-нибудь Linked machine `certificateChanged`; иначе зелёная с числом тех, кто
`online`; иначе `null`. Секция боковой панели кладёт точку в слот `meta` рамки — сразу за
заголовком, вне кнопки-заголовка и вне тела: регион по-прежнему называется «Machines», клик по
точке секцию не сворачивает, у свёрнутой секции точка видна. У точки `role="img"`, `aria-label` и
`title` с одним текстом, `data-state` (`online` или `certificate-changed`), `data-testid="machines-dot"`.

**Кто выделяет место под кольцо.** Сама точка: её блок — 12 × 12 px, точка 6 px стоит в его
середине (`::before`), кольцо (`::after`) растёт от 6 до 12 px и гаснет, раз в 2 s
(`src/renderer/machines/machines.css`). Слот `meta` и заголовок секции обрезают то, что выходит за
блоки своих частей (`overflow: hidden`), поэтому кольцо за блок точки не выходит и рамку править не
пришлось. От текста «Machines» до точки — 9 px. При `prefers-reduced-motion: reduce` анимации нет.
Янтарная точка статична.

**Свёрнута по умолчанию** — `defaultCollapsed` у секции. Кто не трогал заголовок «Machines», видит
секцию свёрнутой (24 px); кто развернул — у того в `sidebar.collapsed.MachinesSection` стоит `false`,
и секция остаётся развёрнутой; кто свернул явно — `true`.

**Settings → Machines** — `src/renderer/settings/MachinesSection.tsx`, `order` 40, `title`
«Machines»: две строки `SettingRow` с `SettingSwitch`. Подписи и `data-testid` переключателей те же
(`link-access-switch`, `link-keep-awake-switch`), без своей Machine оба неактивны. Каналы те же —
`link.setAccess` и `link.setKeepAwake` через `setProjectsAccess` и `setKeepAwake` из
`useMachines.ts`; значение показывается по ответу main, а не по клику. Отказ main показан под
строками как есть (`role="alert"`, `data-testid="settings-machines-error"`); следующая удавшаяся
правка его убирает. Ответы, пришедшие не по порядку: сообщение решает последний клик. Ответ после
закрытия Settings доходит до состояния связи (его принимает `useMachines.ts`), теряется только текст
отказа.

**Боковая панель.** В секции остались список, контекстное меню строки («Revoke») и «Link a
machine…». `SectionSwitch`, его стили и подписи удалены. Сообщение секции (`machines-error`) теперь
показывает только отказ отзыва.

**e2e.** `test/e2e/helpers.ts`: `expandMachines`, `collapseMachines`, `openMachinesSettings`,
`closeSettings`, `setProjectsAccess(launched, on)`, `setKeepAwake(launched, on)`; `openLinkDialog`
сначала разворачивает секцию; `linkThroughUi` в конце требует, чтобы строки были на экране
(`toBeVisible`), а не только имели атрибут. Локальные `setSharing` в пяти spec-ах заменены на
`setProjectsAccess`. В `linked-machines.spec.ts` два новых test-а раздела Settings → Machines.

**`sidebar-sections.spec.ts` (добавлен Orchestrator-ом в след).** Без переключателей развёрнутая
Machines стала ниже: тело 28 px («Link a machine…») вместо прежних 116 px (число — из «Итог»
Ticket-а 04). Замер в окне
800×520 (колонка 460 px): с одним Project-ом нижние пределы секций занимают 392 px при свёрнутой
Machines и 420 px при развёрнутой — колонка больше не прокручивается, спискам Epics и ADR достаётся
больше 3 строк. Условие «секции на нижнем пределе, колонка прокручивается» сохранено так:
- test ошибки «Add project»: сначала проверяется состояние свежего worfy в 800×520 (Machines —
  24 px, колонка не прокручивается, списки выше нижнего предела), затем Machines разворачивается, и
  после ошибки (сообщение 84 px) пределы снова не помещаются — прежние проверки идут как были;
- test «8 Project-ов»: Machines разворачивается, пределы — 476 px из 460;
- test «длинный список в наименьшем окне»: Project-ов теперь три (две папки добавлены в fixture
  этого test-а) и Machines развёрнута — 476 px из 460. Проверка «список в одну строку не сжат» стала
  проверкой «список в три строки не сжат» и «тело Machines равно своему содержимому»; одну строку под
  нехваткой места по-прежнему проверяет test ошибки «Add project».

**Приёмка worfy-link 16** — `open`, поправлен только текст шагов: связь и отзыв (список и «Link a
machine…» — в развёрнутой секции, связь видна и по зелёной точке), оба шага с переключателем доступа
(Settings → Machines), связь Mac и Windows, состояние «спит». Номера строк `:71` и `:76` из «Что
делаем» совпали с файлом.

**Как падал первый test.** `pnpm test test/unit/machines-dot.test.ts` на заготовке, которая всегда
отвечает `null`, — exit 1, 4 из 6 красные: `one online: green, "1 linked machine online"` —
`AssertionError: expected null to strictly equal { kind: 'online', … }`.

**Решено без владельца, подтвердить.**
- У сообщения об отказе в Settings свой `data-testid` — `settings-machines-error`, а не
  `machines-error` боковой панели: оба могут быть на странице сразу, и один id на двоих ломает
  locator в test-ах.
- Клик по тексту подписи в Settings → Machines переключатель не трогает (в боковой панели текст был
  `<label>` и переключал). Так устроен общий `SettingRow` Ticket-а 02 (`controls.tsx` не в следе);
  клавиатура и Esc после такого клика работают, это проверяет e2e.
- У переключателей в Settings нет строки-пояснения, и неактивные переключатели (нет своей Machine) не
  говорят почему — как было в боковой панели.
- Пользователь, у которого Machines была развёрнута «по умолчанию» (заголовок не трогал, ключа в
  настройках нет), после обновления увидит её свёрнутой — прямое следствие решения владельца 1.
- В fixture test-а «длинный список в наименьшем окне» стало три Project-а (см. выше).

**Проверено.**
- [x] Unit `machines-dot.test.ts` — 6 test-ов; `machines-section.test.tsx` — 15: свежий
  пользователь, пользователь с `MachinesSection: false` и с `true`, точка в заголовке свёрнутой
  секции, смена точки по `link.changed`, нет `role="switch"`; раздел Settings — порядок 40 в
  настоящем реестре, каналы, неактивность без своей Machine, отказ main, ответы не по порядку,
  ответ после закрытия, одно состояние у боковой панели и Settings.
- [x] e2e `linked-machines.spec.ts` — 8 test-ов: свежая Machine — секция 24 px, точки нет; после
  связи у обоих точка «1 linked machine online» цвета chip-а «Online», кольцо `2s infinite`, блок
  12 px целиком внутри слота и заголовка; `reducedMotion: 'reduce'` — `animation-name: none`; у
  свёрнутой секции точка на месте; после отзыва и после выхода второй копии точки нет. Settings →
  Machines: доступ переживает перезапуск и записан в `link/settings.json`; в окне 800×520 обе строки
  целиком на экране; настоящий отказ main (папка `link` только для чтения) —
  `link.setAccess failed: EACCES: permission denied, open '…/link/.settings.json.<pid>.1.tmp'`,
  переключатель и файл не изменились, горизонтальной прокрутки нет; после клика по тексту Tab
  остаётся в окне, Space и Enter переключают, фокус остаётся на переключателе, Esc закрывает.
- [x] e2e `sidebar-sections.spec.ts` (4), `linked-sleep` (3), `linked-add-project` (2),
  `linked-cards` (1), `linked-notify` (1), `linked-system-actions` (1), `settings` (3) — зелёные;
  всего 23 test-а одним запуском, exit 0.
- Снимки на состоянии по умолчанию:
  [точка у свёрнутой секции, светлая](../evidence/05-machines-dot-light.png),
  [тёмная](../evidence/05-machines-dot-dark.png);
  [Settings → Machines, светлая](../evidence/05-settings-machines-light.png),
  [тёмная](../evidence/05-settings-machines-dark.png);
  [свежий worfy, Machines свёрнута, светлая](../evidence/05-machines-collapsed-light.png),
  [тёмная](../evidence/05-machines-collapsed-dark.png).
- Mutation testing: 21 мутант unit (расчёт точки, секция, раздел Settings) и 8 мутантов e2e (CSS
  точки и `defaultCollapsed`) — все красные.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (229 файлов, 4751 test).

**Не проверено.**
- не проверено: `GATE_SCOPE=all` gate full, весь `pnpm test:e2e` и `pnpm test:package` — шаг
  Orchestrator-а перед мержем. `test/e2e/linked-autopilot.spec.ts` не в следе и не запускался, а он
  зовёт `launchLinkedPair` с изменённым `openLinkDialog`.
- не проверено: янтарная точка в собранном приложении — сменённый сертификат в e2e не
  воспроизвести; расчёт и атрибуты закрыты unit-test-ами, цвет `--blocked-ring` в e2e не сверялся.
- не проверено: длинный список Linked machine-ов в боковой панели (нужно много связанных копий) и
  точка при масштабе интерфейса не 100 %.
- не проверено: вид и tooltip точки вручную в `.app`, сочетание ⌘, (GUI-проверки — не исполнителю).
- не проверено: Windows.

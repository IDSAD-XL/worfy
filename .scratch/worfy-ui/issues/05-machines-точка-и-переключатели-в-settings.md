# 05 — Machines: точка состояния у заголовка, свёрнута по умолчанию, переключатели — в Settings → Machines

Type: task
Status: open
Blocked by: 02, 04
Source: решения владельца 2026-10-09: 1 (Machines свёрнута по умолчанию; зелёная точка с лёгкой пульсацией, когда хотя бы одна Linked machine в сети — `online` без `certificateChanged`; нет — точки нет; сменился сертификат — статичная янтарная точка; подсказка и `aria-label`; `prefers-reduced-motion`; два переключателя — в Settings → Machines, в секции остаются список и «Link a machine…»; перечислить e2e и шаги приёмки worfy-link 16, которые меняются), 2 (раздел Machines окна Settings) ([spec.md](../spec.md), «Как устроено», «Точка Machines»; риск 6; «Пересечения», worfy-link 16); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (доступ «Linked machines can work with my Projects»)

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
  - `test/e2e/linked-machines.spec.ts:30-32` (свежая Machine: «только кнопка и переключатель»),
    `:66` (снимок секции), `:122-138` (доступ переживает перезапуск), `:180` (включить доступ);
  - `test/e2e/linked-sleep.spec.ts:75-79` (оба переключателя), `:86-103` (keep-awake переживает
    перезапуск);
  - `test/e2e/linked-add-project.spec.ts:98`, `test/e2e/linked-cards.spec.ts:80`,
    `test/e2e/linked-notify.spec.ts:52`, `test/e2e/linked-system-actions.spec.ts:126` — включить
    доступ.

  `test/e2e/linked-autopilot.spec.ts:16` упоминает доступ только в комментарии.
- Приёмка worfy-link — Ticket 16, `open` на 2026-10-09. Его шаги смотрят список Linked machine-ов
  (`.scratch/worfy-link/issues/16-приёмка-epic-а-worfy-link.md:37-38`, `:76`) и переключатель доступа
  (`:55`, `:60`), сквозной e2e — `linked-machines.spec.ts` (`:66`).

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

   Расчёт — чистая функция `machinesDot(linked)` в `src/renderer/machines/machines-dot.ts` (новый).
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
   - новые helper-ы `setProjectsAccess(window, on)` и `setKeepAwake(window, on)` — открывают
     Settings → Machines пунктом меню по id и щёлкают переключатель.

   Spec-файлы из «Что происходит» переходят на них. Снимок секции (`linked-machines.spec.ts:66`) —
   с развёрнутой секцией.
5. **Приёмка worfy-link 16.** Если к claim она не `done`, её шаги правятся:
   - `:37-38` — список Linked machine-ов смотрят в развёрнутой секции Machines, связь видна и по
     зелёной точке;
   - `:55` и `:60` — переключатель доступа — в Settings → Machines;
   - `:76` — состояние «спит» — в развёрнутой секции.

   Уже `done` — правки нет, запись об этом в «Итог». Если приёмка в работе — Ticket ждёт её конца
   (spec, «Пересечения»).

Решено в Ticket-е, подтвердить у владельца: янтарная точка важнее зелёной; тексты подсказки.

**Не входит:** новые состояния Linked machine-а; рамка и свёрнутость секций (Ticket 04); раздел
«Terminal AI» и другие разделы Settings.

## Готово, когда

- [ ] Unit `test/unit/machines-dot.test.ts` (новый): Linked machine-ов нет — точки нет; одна
  `online` — зелёная, «1 linked machine online»; две — «2 linked machines online»; `sleeping` и
  `unavailable` — точки нет; `online` с `certificateChanged` — янтарная; `online` и другая с
  `certificateChanged` — янтарная.
- [ ] Unit `test/unit/machines-section.test.tsx` (новый): точка в заголовке с `aria-label`, видна у
  свёрнутой секции; в боковой панели нет `role="switch"`; раздел Settings → Machines — два
  переключателя, клик зовёт `link.setAccess` и `link.setKeepAwake`, без своей Machine они неактивны.
- [ ] e2e `test/e2e/linked-machines.spec.ts`: свежая Machine — Machines свёрнута, точки нет; два
  связанных worfy — у обоих зелёная точка с «1 linked machine online», после отзыва — нет; с
  `reducedMotion: 'reduce'` (`page.emulateMedia`) у точки нет анимации; доступ из Settings → Machines
  переживает перезапуск. Снимки `machines-dot` (свёрнутая секция с точкой) и `settings-machines` в
  светлой и тёмной теме.
- [ ] e2e `test/e2e/linked-sleep.spec.ts`, `test/e2e/linked-add-project.spec.ts`,
  `test/e2e/linked-cards.spec.ts`, `test/e2e/linked-notify.spec.ts`,
  `test/e2e/linked-system-actions.spec.ts` — зелёные на helper-ах Settings.
- [ ] Шаги worfy-link 16 поправлены или в «Итог» записано, что он уже `done`.
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

Заполняется при закрытии.

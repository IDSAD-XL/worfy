# Spike Base UI в Electron (worfy-ui-kit 01)

Дата: 2026-11-12. Ticket: [issues/01](issues/01-spike-base-ui-в-electron.md). Итог: **«да»** — подробности в конце.

## Как проверяли

- Ветка spike-а — `spike/worfy-ui-kit-01-base-ui` (в `main` не вливается, удалённая ветка оставлена: заметка ссылается
  на её CI run-ы). На ней:
  - `@base-ui/react` 1.9.0 в `dependencies`;
  - probe-ы `src/renderer/spike/BaseUiSpike.tsx`. Dialog, Popover, Menu и Tooltip стоят в полосе внизу окна поверх
    Canvas, в каждом Node-е (на Canvas и в tile focus mode, `NodeChrome.tsx`, `FocusMode.tsx`) и в подвале Settings.
    Probe-ы включает только test (`window.__worfySpike.enable()`). Остальные e2e spec-и гоняют приложение как есть,
    но с Base UI в bundle-е;
  - `Select` получил контекст `SelectPortalContext` (`src/renderer/theme/select-portal.ts`): куда рисовать список;
  - e2e `test/e2e/spike-base-ui.spec.ts` печатает на каждый вопрос строку `[spike] <вопрос>: <json>`. Ожидаемые
    ответы — soft-проверки, поэтому один run отвечает на все вопросы, даже если часть ответов «нет»;
  - unit test (jsdom) `test/unit/spike-base-ui.test.tsx` — та же логика `Select` в Dialog, без раскладки.
- e2e локально не гоняли (правило владельца). Весь CI (`ci.yml`, `workflow_dispatch`, `job=full-macos`: lint,
  typecheck, macOS-тесты, оба shard-а `macos-e2e`, `macos-package`) на ветке spike-а:

| Run | Commit spike-а | Что поменяли перед run-ом |
|---|---|---|
| [43124755612](https://github.com/IDSAD-XL/worfy/actions/runs/43124755612) | `184f90e10` | первый run |
| [43129431332](https://github.com/IDSAD-XL/worfy/actions/runs/43129431332) | `ed716ec6d` | контрольное перетаскивание без menu; строка `[spike]` на каждый probe у `<webview>`; что лежит в центре popup-а над Settings |
| [43137894411](https://github.com/IDSAD-XL/worfy/actions/runs/43137894411) | `e261c2b6e` | z-index слоя на позиционированном portal-е; нажатие на заголовок Node-а мимо открытого menu |

Красные job-ы этих run-ов и почему они не про Base UI — в разделе «Что красное в run-ах spike-а».

## Шаг 2

Test-ы — `test/e2e/spike-base-ui.spec.ts` на ветке spike-а, job `macos-e2e (1/2)`. Числа — из строк `[spike]` лога
run-а 43137894411 (последний; те же ответы в 43129431332, где test был тот же).

1. **Клик внутри `<webview>` закрывает popover? Popover — нет, с закрытием по blur окна — да.** Test `a press inside
   the Browser <webview> and a popup of the Canvas`, зелёный в 43129431332 и 43137894411:
   - Popover Base UI как есть: после клика в страницу `<webview>` открыт (`openAfterPressInWebview: true`, ни одного
     события закрытия). Это [Base UI #5410](https://github.com/mui/base-ui/issues/5410), и для `<webview>` тоже;
   - тот же Popover с обработчиком `blur` окна (так spec задумал обёртку kit-а): закрыт, причина `window-blur`.
     Фокус уходит в guest (`document.hasFocus()` в странице — `true`), и окно renderer-а получает `blur`;
   - Menu закрывается и без этого, причина `outside-press`.

   Значит, закрытие по blur окна в обёртках kit-а обязательно (Ticket 03), а не страховка.
2. **Фокус рядом с xterm после закрытия не теряется: да.** Test `next to a Terminal: …`, зелёный во всех трёх run-ах:
   - фокус в xterm (`textarea.xterm-helper-textarea`); Tooltip на кнопке заголовка Terminal-а его не забирает;
   - Popover из заголовка Terminal-а берёт фокус в своё поле. Esc закрывает его, и фокус возвращается на кнопку,
     которая его открыла, а не на `body`;
   - нажатие в экран Terminal-а при открытом Popover закрывает его, фокус — снова в xterm, набранная команда доходит
     до shell (`typingReachesShell: true`).

   Если после Esc фокус нужен в самом xterm, а не на кнопке, у Popup Base UI есть `finalFocus`.
3. **Menu на Node-е не мешает тащить Node: да, если menu не модальное.** Test `a menu on a Node does not stop the Node
   from being dragged`, лог `[spike] node drag with menu` (test красный: его soft-проверка модального menu):
   - контроль без menu: Node сдвинулся на 84 px;
   - открыто menu с `modal={false}`: первое же перетаскивание за заголовок двигает Node (−84 px), menu закрывается;
   - открыто menu Base UI по умолчанию (`modal: true`): test искал точку заголовка, где сверху лежит сам заголовок,
     и не нашёл ни одной. Нажатие пришлось на пункт menu (`pressedOn: "div.w-spike-item"`), поэтому «0 px за два
     перетаскивания» — не измерение перетаскивания за заголовок. Вывод держится на исходнике Base UI:
     `menu/positioner/MenuPositioner.mjs:223-234` рисует `InternalBackdrop` на всё окно, когда menu модальное и
     открыто не наведением. Значит, нажатие на заголовок при открытом модальном menu получает backdrop, а не Node;
   - кнопка menu без `nodrag` ([Base UI #6150](https://github.com/mui/base-ui/issues/6150)): нажатие и перетаскивание с
     самой кнопки двигают Node (−78 и −80 px), menu не открылось ни на нажатии, ни после отпускания. У кнопок в
     Node-ах worfy и так стоит `nodrag`.

   Значит, menu и popover на Canvas в kit-е — `modal={false}`, как сейчас все свои.
4. **Esc рядом с guard-ами окон закрывает только верхний слой: да. Отметку «обработано» Base UI ставит сам.**
   - Над Settings (test `over Settings: …`, зелёный только в 43137894411): Popover и Menu из подвала Settings
     поверх окна, Esc закрывает только их (Settings открыт), второй Esc закрывает Settings. Guard Settings
     (`settings-window.ts`, `isAbove`) пропускает клавиши слоя, у которого z-index выше `SETTINGS_LAYER` (110).
   - Условие: z-index слоя стоит на позиционированном элементе. В run-е 43129431332 portal нёс только `zIndex`, без
     `position`, и в центре Popover-а лежал `w-settings__backdrop` — окно Settings закрывало popup, хотя Esc уже
     работал верно. С `position: relative` на portal-е (43137894411) popup сверху. Это правило шкалы слоёв kit-а
     (Ticket 03).
   - В focus mode (test `in focus mode: …`, зелёный во всех трёх): Popover и Menu tile-а поверх слоя focus mode, Esc
     закрывает только их, фокус — на кнопке в tile-е, следующий Esc выходит из focus mode.
   - Как Base UI отмечает Esc. `useDismiss` слушает `keydown` на `document` (фаза всплытия), закрывает popup, потом
     вызывает `preventDefault()` и `stopPropagation()`. В логе каждое закрытие по Esc — `reason: "escape-key"`,
     `defaultPrevented: true`, а слушатель на `window` нажатие не получил (`escReachedWindow: []`). Обёртка может
     отменить закрытие (`eventDetails.cancel()`) или пустить нажатие дальше (`eventDetails.allowPropagation()`) в
     `onOpenChange`.
   - Вывод из этого порядка, отдельно test-ом не проверялся. React ловит события на корне приложения, то есть
     раньше `document`. Поэтому любой `onKeyDown` в дереве React видит Esc раньше Base UI, с
     `defaultPrevented: false`. Это касается и предков popup-а по дереву React: portal не разрывает всплытие React.
     Два случая в `main`:
     - фокус внутри popup-а, а у предка в дереве React свой Esc. Пример — `session/ProductSessionPanel.tsx:289-293`:
       если внутри панели открыт popup kit-а, панель закроется на то же нажатие, а её `stopPropagation` не пустит Esc до `document`, и popup останется
       открытым. Нарушено «одно нажатие — одно действие» spec-а;
     - фокус остаётся в поле, popup открыт рядом. Пример — `session/MessageInput.tsx:347` (Ticket 02, уже в `main`):
       поле читает `event.nativeEvent.defaultPrevented` в `onKeyDown`, а Base UI ставит отметку позже, на `document`.
       Поле прервёт ход агента, и Base UI закроет popup тем же нажатием.

     Правило для kit-а записано в Ticket 03: обёртка сама отмечает Esc обработанным в фазе React, на самом popup-е.
     Полю, в котором фокус остаётся при открытом popup-е, этого мало: оно спрашивает helper «открытые слои». Ticket-ы
     10 и 11 проверяют это на своих popup-ах.
   - То же в jsdom: `test/unit/spike-base-ui.test.tsx` › `Esc on a Base UI Popover` — `escape-key`,
     `defaultPrevented: true`, до `window` не дошло.
5. **Install scripts у пакета: нет.** `pnpm add --save-exact @base-ui/react@1.9.0` в worktree spike-а — exit 0, без
   `ERR_PNPM_IGNORED_BUILDS`; `allowBuilds` в `pnpm-workspace.yaml` не менялся. Lockfile добавил 7 пакетов:
   `@base-ui/react` 1.9.0, `@base-ui/utils` 0.5.0, `@floating-ui/core` 1.8.0, `@floating-ui/dom` 1.8.0,
   `@floating-ui/react-dom` 2.1.9, `@floating-ui/utils` 0.2.12, `reselect` 5.3.0. У всех лицензия MIT, ни у одного
   нет `preinstall`, `install`, `postinstall` или `prepare` в `scripts` и нет `binding.gyp` (проверено чтением
   `package.json` каждого в `node_modules/.pnpm`). Версия 1.9.0 вышла 2026-10-09: старше суток, правило
   `minimumReleaseAge` pnpm она проходит без исключений. `date-fns` и `@date-fns/tz` — необязательные peer
   (`peerDependenciesMeta`), не ставятся.

## Шаг 3: свой `Select` внутри модального Dialog kit

Test: `spike-base-ui.spec.ts` › `the app's own Select inside a modal Base UI Dialog, way "<body|inside|trap>"`, job
`macos-e2e (1/2)`, run-ы 43124755612, 43129431332 и 43137894411, зелёный во всех трёх. Dialog kit-а здесь —
`Dialog.Root modal` с portal-ом на z-index 200, список `Select` — 3000, как сейчас.

| Проверка | `body` — список в `document.body`, `modal: true` | `inside` — список внутри окна | `trap` — `modal: 'trap-focus'` |
|---|---|---|---|
| Выбор пункта мышью: значение `beta`, окно открыто | да | да | да |
| Esc на открытом списке: список закрыт, окно открыто; следующий Esc закрывает окно | да | да | да |
| Список виден screen reader-у: `getByRole('listbox')` = 1, нет `aria-hidden`/`inert` на пути вверх, `option "Gamma"` в `ariaSnapshot` | да | да | да |

То же в jsdom: `WORFY_TEST_FILES=test/unit/spike-base-ui.test.tsx node scripts/vitest-electron.mjs` — exit 0,
10 test-ов.

Почему работают все три. Base UI вешает `aria-hidden` и маркер `data-base-ui-inert` на соседей окна в момент
открытия (`FloatingFocusManager`, `markOthers`). Список `Select` появляется позже, поэтому меток на нём нет. Нажатие
на элемент, который появился после открытия и не содержит маркеров, Base UI не считает нажатием снаружи
(`useDismiss`: «a third-party element injected after the floating element rendered»). Esc на списке `Select`
останавливает сам (`stopPropagation` в React-обработчике), и до слушателя Base UI на `document` нажатие не доходит.

**Выбор: `inside` — `Select` рисует список внутри открытого окна.** Довод:
- `body` держится на внутренней эвристике Base UI про «элемент, вставленный после открытия». Она не описана в
  документации и может поменяться в minor release. Ещё она ломается, если окно перерисует свои метки при открытом
  списке.
- `trap` снимает модальность со всех окон с `Select`: клики снаружи доходят до Canvas, а screen reader видит всё
  приложение за окном. Только в Settings 11 `Select`-ов.
- `inside` кладёт список в дерево окна. Для focus trap, `aria-hidden` и нажатия снаружи он часть окна по устройству,
  а не по совпадению. Цена — одна правка `Select` (контекст контейнера, как на ветке spike-а, Ticket 04) и одно
  правило kit-а: popup Dialog-а не центрируется через `transform`. Иначе `position: fixed` списка считается от окна,
  а не от viewport-а. Probe-окно spike-а стоит на `top`/`left` без `transform`.

## Шаг 4: размер сборки и время старта

Размер — `pnpm build` в worktree-ах `origin/main` (`ccd23a2d8`) и spike-а (`184f90e10`), сумма файлов
`out/renderer/assets` и gzip -9 каждого файла (`node` + `zlib`). Renderer собирается без минификации.

| | `main` | spike | Разница |
|---|---|---|---|
| `index-*.js`, байт | 4 387 412 | 4 828 294 | +440 882 (+10,0 %) |
| JS renderer-а, gzip | 1 493 535 | 1 582 622 | +89 087 (+5,96 %) |
| CSS renderer-а, gzip | 68 837 | 69 200 | +363 |

Четыре компонента отдельно (Dialog, Popover, Menu, Tooltip без React), `esbuild --bundle --minify`: 216 201 байт,
min+gzip 71 149 байт. Это в пределах оценки spec-а (один компонент 20–56 KB, весь Base UI 166 KB). Код грузится с
диска.

Старт — e2e test бюджета `epic-frame.spec.ts:1113` («an Auberge-sized Project is interactive within 3 s…»), job
`macos-e2e (2/2)`. На runner-е бюджет — 6 × медиана старта Project-а с одним Ticket-ом, не больше 7,3 s
(`test/e2e/start-budget.ts`).

| Run | Ветка | Interactive, ms | Медиана одного Ticket-а, ms | Отношение | Бюджет, ms | Итог |
|---|---|---|---|---|---|---|
| 43124755612 | spike | 6589 | 1770 | 3,7 | 7300 | зелёный |
| 43129431332 | spike | 3572 | 1046 | 3,4 | 6276 | зелёный |
| 43137894411 | spike | 5092 | 1509 | 3,4 | 7300 | зелёный |
| 43115615773 | `main`, `b1784d1dd` | 7520, повтор 5322 | 1315, 1320 | 5,7, 4,0 | 7300 | первая попытка красная, повтор зелёный |
| 43115220193 | `main`, `42e8cd9f2` | 4833 | 1594 | 3,0 | 7300 | зелёный |
| 43113295685 | `main`, `e89c00005` | 3802 | 895 | 4,2 | 5370 | зелёный |

Разница старта с Base UI в шуме runner-а: отношение spike-а 3,4–3,7 лежит внутри разброса `main` 3,0–5,7. Exit code
test-а бюджета на ветке spike-а — 0 (test зелёный в каждом run-е, без повтора). Точнее на runner-е не измерить: на
`main` тот же test сам падал на 7520 ms.

## Что красное в run-ах spike-а

- `macos-tests`, test `test/contract/ci-scope-e2e.test.ts:298` («gives every spec file that uses the Browser node for
  every file of its rule»): новый spec spike-а открывает Browser Node и не записан в `scripts/e2e-specs.table.json`.
  Ветка не вливается, таблицу не правили.
- `macos-e2e (1/2)` — soft-проверки spike-а, ответ «нет» на вопрос (разобраны выше). В последнем run-е 43137894411 красный один test spike-а — перетаскивание при открытом модальном menu (шаг 2, пункт 3); остальные test-ы spike-а и весь `macos-e2e (2/2)` зелёные.

## Итог

**«да» — Base UI уживается с Electron worfy, Epic идёт дальше по плану.** Все вопросы шагов 2–4 закрыты ответом,
который kit может выполнить; ни один не требует обхода Base UI:

- `<webview>` — закрытие по blur окна в обёртках Popover, PreviewCard и Tooltip обязательно (Ticket 03), Menu
  закрывается и сам;
- Node-ы — popup-ы Canvas с `modal={false}`, кнопки с `nodrag`, как сейчас;
- Esc — Base UI ставит `preventDefault` и останавливает нажатие сам, но на `document`, после обработчиков React.
  Поэтому обёртка kit-а отмечает Esc обработанным ещё в фазе React, на самом popup-е, а поле, где фокус остаётся при
  открытом popup-е, спрашивает helper «открытые слои» (Ticket 03; проверяют Ticket-ы 10 и 11). Guard-ы окон
  пропускают слой выше себя, если его z-index стоит на позиционированном элементе (portal или positioner);
- `Select` — список рисуется внутри открытого окна (вариант `inside`), правка `Select` — в Ticket-е 04;
- размер — JS renderer-а +89 087 байт gzip (+5,96 %; сборка без минификации), четыре компонента отдельно — 71 149
  байт min+gzip; старт в шуме runner-а, test бюджета зелёный.

Не проверено: Windows (job-ы `windows-e2e` в ручном запуске `full-macos` не идут) и Esc в popup-е внутри элемента
со своим Esc (вывод из порядка обработчиков, шаг 2, пункт 4; правило и test-ы — в Ticket-ах 03, 10 и 11).

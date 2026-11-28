# 170 — Свой тонкий scrollbar во всём приложении, один и тот же на macOS и Windows

Type: polish
Status: done 2026-11-28T09:57Z
PR: #2360
Branch: worfy-polish/170
Blocked by: None — can start immediately
Source: просьба владельца 2026-11-28 со screenshot-ом панели Assistant (вкладки Waits / Summary / Journal / Chat): во
вкладке Chat справа стоит широкий серый scrollbar macOS по умолчанию, с дорожкой. Слова владельца: «везде где есть
скроллбары в приложении заюзай кастомный как в чате сессии». Ответ на PR #2346 тем же днём: «Может кастомный
сделать?» — свой вид, а не тот, что рисует ОС.

Кто: агент. Глубина review — `medium`. По коду PR не платформенный: меняется только renderer. Вид на Windows
проверяется отдельным ручным пунктом (`needs: windows stable`) после merge; merge его не ждёт (решение владельца).

## Решения владельца

- 2026-11-28: scrollbar свой, один и тот же на Mac (trackpad и мышь) и на Windows, а не native scrollbar ОС.
- 2026-11-28: merge не ждёт проверки на Windows; вид на Windows владелец смотрит после merge.

## Что происходит

- У chat Session своего scrollbar-а нет. Transcript (`.w-tr`, `src/renderer/session/session.css:1153-1157`) — обычный
  `overflow-y: auto`. Body панели Assistant (`.w-asst-body`, `src/renderer/assistant/assistant.css:146-151`) устроен
  так же. Библиотеки scrollbar-ов в зависимостях нет: ScrollArea из `@base-ui/react` не импортируется нигде в `src/`.
  Правила `::-webkit-scrollbar` для chat-а нет ни в одном CSS. Значит, оба контейнера рисует native scrollbar Chromium-а.
- Native scrollbar на macOS зависит от System Settings → Appearance → Show scroll bars. На этом Mac стоит значение по
  умолчанию «Automatically based on mouse or trackpad» (ключа `AppleShowScrollBars` нет). С trackpad-ом Chromium
  рисует тонкий overlay: он без дорожки и виден только при прокрутке. С мышью или при «Always» Chromium рисует classic:
  15 px, с серой дорожкой — это и есть вид со screenshot-а. Скорее всего, тонкий scrollbar в chat Session владелец
  видел в режиме overlay. По коду разницы между двумя контейнерами нет.
- Windows и Linux: Chromium всегда рисует classic scrollbar (около 17 px, со светлой или тёмной дорожкой по
  `color-scheme`), overlay там нет. Значит, на Windows широкий scrollbar стоит у каждого прокручиваемого контейнера.
- `color-scheme: light dark` уже стоит на `:root` (`src/renderer/theme/tokens.css:10`), поэтому дорожка classic
  scrollbar-а в dark темнеет. Общего вида у scrollbar-ов нет.
- Своё оформление есть только у четырёх мест. Rail sidebar прячет scrollbar
  (`.w-sidebar__rail::-webkit-scrollbar { width: 0 }`, `src/renderer/shell/shell.css:100-102`). Presets Focus mode и
  chapters Story прячут его через `scrollbar-width: none` (`src/renderer/focus/focus.css:88`,
  `src/renderer/stories/stories.css:44`). Toolbar Mind map — `scrollbar-width: thin`
  (`src/renderer/product/mind-map.css:55`).
- Terminal (xterm 6) рисует свой scrollbar в стиле VS Code. Его цвета задаёт тема xterm (`themeOf`,
  `src/renderer/canvas/nodes/TerminalNode.tsx:101`); поля `scrollbarSlider*` она сейчас не задаёт.

### Прокручиваемые контейнеры (origin/main c66e7215a)

Всего 75: 54 правила в CSS (29 файлов) и 21 inline style в 18 файлах `.tsx`. Из них 4 своё оформление уже имеют
(список выше). Остальные 71 показывают native scrollbar.

- Session (9): `session.css:418` `.w-session__rail`, `:556` `.w-product__agents-panel`, `:1156` `.w-tr`, `:1388`
  `.w-tr__pre`, `:1796` `.w-slash__list`, `:2208` `.w-permission__input`; `mcp-chip.css:50` `.w-mcp`;
  `question-card.css:176` `.w-question__preview`; `quote-comments.css:549` `.w-qtray__chips`.
- Assistant (4): `assistant.css:149` `.w-asst-body`, `:794` code-блоки (`pre`), `:800` таблицы Markdown, `:1075`
  textarea Prepare.
- Shell, sidebar, Settings, dialogs (15): `shell.css:98` rail (скрыт), `:320` `.w-project-switcher__menu`;
  `sidebar-section.css:86`, `:102`; `settings.css:42`, `:90`; `shortcuts.css:40`; `integrations.css:235`;
  `autopilot-modal.css:25`; `shell/sidebar/AdrSection.tsx:107`; `shell/ProjectSettings.tsx:42`; `shell/FirstRun.tsx:50`;
  `shell/QuittingDialog.tsx:31`; `update/WhatsNew.tsx:126`; `palette/CommandPalette.tsx:95`.
- Projects, Harness, Getting started (9): `projects/ConnectProject.tsx:91`, `:133`; `projects/EditProfile.tsx:77`;
  `projects/FolderBrowser.tsx:60`; `projects/RemoveProject.tsx:32`; `harness/MigrationForm.tsx:66`, `:89`;
  `getting-started/GettingStartedPanel.tsx:112`; `getting-started/ReviewExample.tsx:67`.
- Pull requests и Changes (8): `pr-inbox.css:167`, `:455`; `pr-inbox/DraftThread.tsx:465`; `pr-review.css:46`, `:133`,
  `:302`; `changes.css:223` (список файлов), `:308` (diff).
- Canvas (15): `epic-frame.css:435` `.w-ticket__body`; `badges/evidence.css:27`; `nodes/BrowserNode.css:419`;
  `browser/BrowserProfiles.tsx:37`; `nodes/HandoffNode.tsx:53`; `nodes/OrchestratorNode.tsx:70`;
  `nodes/SessionNode.tsx:166`, `:179`; `pipeline.css:38`, `:96`; `work-track.css:223`, `:670`;
  `flight-recorder.css:161`, `:564`, `:588`.
- Guide, Markdown, Stories, Mind map, Focus (12): `guide.css:67`, `:100`; `markdown.css:146`, `:215`, `:313`;
  `stories.css:42` (скрыт), `:233`, `:508`; `line-question.css:46`; `mind-map.css:54` (thin), `:432`; `focus.css:87`
  (скрыт).
- Kit (3): `theme/kit/menu.css:9`, `theme/kit/popover.css:8`, `theme/select.css:65`.

Пути — от `src/renderer/`; номер — строка `overflow…: auto|scroll`. Сюда же попадают textarea с длинным текстом
(например, поле ввода Session): у них scrollbar появляется без явного `overflow`.

## Что строить

1. **Свой scrollbar у каждого контейнера.** Общий стиль лежит в базовом CSS: новый файл
   `src/renderer/theme/scrollbars.css`, импорт в `src/renderer/main.tsx` рядом с `./theme/tokens.css` (строка 4).
   Правила стоят на `*::-webkit-scrollbar`, поэтому новая панель получает стиль без своего класса.
   - Ширина и высота 8 px. Дорожка (`::-webkit-scrollbar-track`) и угол (`::-webkit-scrollbar-corner`) не видны.
     Кнопок-стрелок нет.
   - Thumb: скругление 999 px, прозрачная рамка 1–2 px и `background-clip: padding-box`, так что видимая полоса —
     около 5 px. При наведении на сам thumb он темнее (светлее в dark).
   - В покое thumb не виден. Он виден, пока курсор над контейнером (`*:hover::-webkit-scrollbar-thumb`), и пока
     контейнер прокручивается. Так Windows и Mac с мышью выглядят как overlay scrollbar на Mac с trackpad-ом.
   - Одним CSS «пока прокручивается» не показать: прокрутка колесом или клавишами без курсора над контейнером
     `:hover` не даёт. Нужен маленький общий hook, например `useScrollingMark` в `src/renderer/theme/`, один на
     окно, в корне приложения. Он слушает `scroll` на `document` в фазе capture (`{ capture: true, passive: true }`):
     событие `scroll` элемента не всплывает, но capture его ловит. Прокрученному элементу hook ставит
     `data-scrolling`, а через ~800 ms после последнего события снимает. В CSS для таких элементов —
     `[data-scrolling]::-webkit-scrollbar-thumb`. Компоненты hook не вызывают, новая панель получает его даром.
   - Chromium не всегда перерисовывает pseudo-element scrollbar-а, когда меняется только атрибут или `:hover`.
     Проверить это на Mac Stable. Если thumb не появляется, переключать через custom property на самом элементе
     (`--scrollbar-thumb-now`) — это исполнитель решает по тому, что работает.
2. **Цвета** — новые tokens в `tokens.css`, свои для light и для dark: `--scrollbar-thumb` и `--scrollbar-thumb-hover`.
   Шапка `tokens.css` требует менять вместе таблицу Tokens в `docs/design/F-SPEC.md`, этот файл и test-ы
   (`test/e2e/theme.spec.ts`, `test/unit/contrast.test.ts`). Там же, в F-SPEC, — одна строка о scrollbar-е.
3. **Не мешать общему стилю.** Chromium (Electron 44) не применяет `::-webkit-scrollbar` к элементу, у которого задан
   `scrollbar-width` или `scrollbar-color`. `scrollbar-color` к тому же наследуется. Поэтому:
   - `scrollbar-color` в renderer не появляется нигде;
   - `scrollbar-width: thin` у toolbar Mind map (`mind-map.css:55`) убрать: toolbar получит общий стиль;
   - `scrollbar-width: none` (focus, stories) и `width: 0` у rail sidebar остаются: там scrollbar спрятан намеренно.
4. **Ширина.** Стилизованный scrollbar Chromium-а не бывает overlay: на Mac с trackpad-ом он теперь занимает 8 px
   ширины, где раньше было 0. Пройти контейнеры из списка с узким padding-ом справа (body Assistant — 1 px; menu,
   popover, select, CommandPalette), чтобы текст не прилипал к thumb-у. Править padding только там, где видно на глаз.
5. **Terminal.** Свой scrollbar xterm остаётся. В `themeOf` (`TerminalNode.tsx:101`) задать
   `scrollbarSliderBackground`, `scrollbarSliderHoverBackground` и `scrollbarSliderActiveBackground` из тех же tokens.
6. **Необязательно, отдельным Ticket-ом после этого: настоящий overlay у двух главных мест чтения.** Overlay
   scrollbar не занимает ширины и лежит поверх текста. Им можно сделать transcript Session и body Assistant-а.
   `@base-ui/react` 1.9.0 уже в зависимостях, и в его пакете есть ScrollArea (Root, Viewport, Scrollbar, Thumb). В
   `src/` её пока не импортирует никто.
   - Цена для transcript. Прокручиваемым элементом станет Viewport ScrollArea, а не `.w-tr`
     (`Transcript.tsx:1169`). Ref и `onScroll` (строка 1173) переезжают на Viewport, вместе с 17 местами, где Transcript
     читает или ставит `scrollTop`, `scrollHeight` и `clientHeight`: следование за низом, «Load earlier», jump,
     Find. Кроме того, `scrollToMatch` в `transcript-find.ts:548` и `test/unit/session-history-tail.test.tsx`, который
     ищет `.w-tr`.
   - Цена для body Assistant-а: один `div` (`AssistantPanel.tsx:496`, ref `body`) и два `scrollIntoView`
     (строки 349 и 483) — мало.
   - Итого 2 компонента, примерно 4 файла. Риск — в логике прокрутки Transcript-а, которая уже не раз чинилась.
   - Рекомендация: в этом Ticket-е не делать. 8 px ширины у общего стиля почти незаметны. Если владелец на Mac
     Stable скажет, что ширина мешает, — завести Ticket сначала на body Assistant-а (дёшево), transcript — следом.
     Исполнитель пишет в «Итог», нужен ли такой Ticket по его впечатлению.
7. В `docs/features/` абзаца о scrollbar-ах нет, писать его не нужно.

## Где в коде

- `src/renderer/main.tsx:4` — импорт `tokens.css`; рядом ляжет импорт `scrollbars.css`. Hook — в корне приложения.
- `src/renderer/theme/tokens.css` — `:root` light (строка 9 и дальше) и `@media (prefers-color-scheme: dark)`
  (строка 189) для двух новых tokens.
- `src/renderer/product/mind-map.css:55` — `scrollbar-width: thin` убрать.
- `src/renderer/shell/shell.css:100-102`, `src/renderer/focus/focus.css:88`, `src/renderer/stories/stories.css:44` —
  не трогать.
- `src/renderer/canvas/nodes/TerminalNode.tsx:101-112` — `themeOf`.
- `docs/design/F-SPEC.md` (таблица Tokens), `test/e2e/theme.spec.ts`, `test/unit/contrast.test.ts`.
- Для шага 6 (не в этом Ticket-е): `src/renderer/session/Transcript.tsx:1169-1173`,
  `src/renderer/session/transcript-find.ts:548`, `src/renderer/assistant/AssistantPanel.tsx:349`, `:483`, `:496`.

## Test-ы

- Unit test (например, `test/unit/scrollbars-css.test.ts`), который читает CSS-файлы renderer-а:
  - `main.tsx` импортирует `theme/scrollbars.css`;
  - ни в одном `.css` и `.tsx` под `src/renderer/` нет `scrollbar-color`;
  - `scrollbar-width` встречается только со значением `none`.
  Так новая панель не выключит общий стиль случайно. Test красный до правки (из-за `mind-map.css:55`).
- Unit test на hook (jsdom): событие `scroll` элемента ставит ему `data-scrolling`; после паузы (fake timers) метка
  снята; прокрутка другого элемента метит только его; после unmount слушателя нет.
- `test/e2e/theme.spec.ts` сверяет значения tokens с таблицей F-SPEC — дополнить двумя новыми tokens. Локально e2e не
  гонять: его прогоняет CI.
- Сам вид pseudo-element-а в jsdom не проверить — для него ручной пункт.

## Готово, когда

- [ ] Общий стиль scrollbar-а лежит в `src/renderer/theme/scrollbars.css`, подключён в `main.tsx`; tokens
      `--scrollbar-thumb` и `--scrollbar-thumb-hover` есть в light и в dark, они же — в таблице F-SPEC.
  - evidence: commit pass · worfy-polish/170: the app's own thin scrollbar everywhere · - - · f353029649ccf66d7a7aeca7d938e32f232cbc52
  - evidence: review pass · PR #2360 · - - · d65ea3b5fbdd00627c9e2cc7a3f0721450832617
- [ ] Thumb виден при наведении на контейнер и во время прокрутки (общий hook, один на окно); в покое не виден.
  - evidence: review pass · PR #2360 · - - · d65ea3b5fbdd00627c9e2cc7a3f0721450832617
- [ ] Unit test на CSS (импорт есть, `scrollbar-color` нет, `scrollbar-width` только `none`) и unit test на hook
      красные до правки и зелёные после; `test/e2e/theme.spec.ts` знает новые tokens.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/scrollbars-css.test.ts test/unit/scrolling-mark.test.tsx test/unit/contrast.test.ts` exit 0; the two new files exit 1 before the change · mac - · f353029649ccf66d7a7aeca7d938e32f232cbc52
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/scrollbars-css.test.ts` exit 0 with CRLF-safe reads · mac - · 8143cca777018603cb1c6b1f3e1c8ea2033a9fc7
  - evidence: review pass · PR #2360 · - - · d65ea3b5fbdd00627c9e2cc7a3f0721450832617
- [ ] У Terminal цвета thumb-а берутся из тех же tokens.
  - evidence: commit pass · worfy-polish/170: the app's own thin scrollbar everywhere · - - · f353029649ccf66d7a7aeca7d938e32f232cbc52
  - evidence: review pass · PR #2360 · - - · d65ea3b5fbdd00627c9e2cc7a3f0721450832617
- [ ] В «Итог» — нужен ли Ticket на настоящий overlay (шаг 6), по впечатлению исполнителя.
  - evidence: commit pass · worfy-polish/170: the app's own thin scrollbar everywhere · - - · f353029649ccf66d7a7aeca7d938e32f232cbc52
  - evidence: review pass · PR #2360 · - - · d65ea3b5fbdd00627c9e2cc7a3f0721450832617
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 (lint, typecheck, test) · mac - · f353029649ccf66d7a7aeca7d938e32f232cbc52
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/46111733238/job/140909755463 · ci - · d65ea3b5fbdd00627c9e2cc7a3f0721450832617
- [ ] (вручную) Сделай: в Stable worfy на Mac открой панель Assistant → Chat с длинной перепиской, chat Session,
      Settings, Pull requests и diff в Changes. Проверь при Show scroll bars = «Always» (как с мышью) и при
      «Automatically» с trackpad-ом, в light и в dark; прокрути колесом и клавишами, наведи курсор → Должно быть:
      везде тонкий скруглённый thumb без дорожки, один и тот же при обеих настройках; он появляется при прокрутке и
      при наведении и пропадает в покое; широкого серого scrollbar-а нет нигде; текст не налезает на thumb.
  - needs: mac stable
- [ ] (вручную, после merge) Сделай: в Stable worfy на Windows открой те же места → Должно быть: тот же тонкий thumb,
      что на Mac, без classic-scrollbar-ов со стрелками.
  - needs: windows stable

## Итог

- Общий стиль — `src/renderer/theme/scrollbars.css`, импорт в `main.tsx` сразу после `tokens.css`. Правила на
  `*::-webkit-scrollbar`: 8 px, дорожка и угол прозрачны, кнопок нет; thumb скруглён (999 px), рамка 1,5 px
  прозрачная с `background-clip: padding-box` (видимая полоса около 5 px). В покое thumb прозрачен; виден при
  `*:hover` контейнера и у `[data-scrolling]`; под курсором — `--scrollbar-thumb-hover`.
- Hook `useScrollingMark` (`src/renderer/theme/scrolling-mark.ts`) — один на окно, в `App` (`main.tsx`): слушает
  `scroll` на `document` в фазе capture, ставит прокрученному элементу `data-scrolling` и снимает через 800 ms
  (`SCROLLING_MARK_MS`) после последнего события; на unmount снимает слушатель, таймеры и метки.
- Tokens `--scrollbar-thumb` / `--scrollbar-thumb-hover`: light `#b8b8be` / `#8e8e93`, dark `#4a4640` / `#6e685f`;
  строка в таблице Tokens F-SPEC и абзац «Scrollbar» под ней; значения — в `test/e2e/theme.spec.ts`;
  `test/unit/contrast.test.ts` проверяет, что thumb виден на каждом фоне (≥ 1,5:1), а hover контрастнее покоя.
- Terminal: `themeOf` (`TerminalNode.tsx`) задаёт `scrollbarSlider*Background` из тех же tokens.
- `scrollbar-width: thin` у toolbar Mind map убран; `scrollbar-width: none` (focus, stories) и `width: 0` у rail
  sidebar не тронуты.
- Test-ы первыми: `test/unit/scrollbars-css.test.ts` (импорт, нет `scrollbar-color`, `scrollbar-width` только
  `none`; комментарии не считаются) и `test/unit/scrolling-mark.test.tsx` (jsdom, fake timers) — красные до правки
  (exit 1: нет файла стиля и hook-а, `mind-map.css:55`), зелёные после.
- Padding узких контейнеров (body Assistant, menu, popover, select, CommandPalette) не менял: «только там, где видно
  на глаз», а Electron и снимки мне по брифу запрещены. Это — часть ручного пункта на Mac Stable.
- Перерисовку thumb-а по `:hover` и `data-scrolling` в Electron не проверял (нет Electron локально). Если thumb не
  появляется на Mac Stable, запасной путь из Ticket-а — custom property на самом элементе.
- Overlay (шаг 6): по впечатлению исполнителя отдельный Ticket сейчас не нужен — 8 px с прозрачной дорожкой почти не
  отнимают ширины. Заводить его, только если владелец на Mac Stable скажет, что ширина мешает; начинать с body
  Assistant-а.

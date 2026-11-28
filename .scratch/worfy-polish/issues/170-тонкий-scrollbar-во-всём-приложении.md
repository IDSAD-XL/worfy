# 170 — Один тонкий scrollbar во всём приложении, light и dark, на macOS и Windows

Type: polish
Status: open
Blocked by: None — can start immediately
Source: просьба владельца 2026-11-28 со screenshot-ом панели Assistant (вкладки Waits / Summary / Journal / Chat): во
вкладке Chat справа стоит широкий серый scrollbar macOS по умолчанию, с дорожкой. Слова владельца: «везде где есть
скроллбары в приложении заюзай кастомный как в чате сессии».

Кто: агент. Глубина review — `medium`. По коду PR не платформенный: меняется только CSS renderer-а. Вид на Windows
проверяется отдельным ручным пунктом (`needs: windows stable`), merge этого пункта не ждёт.

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

1. Один общий стиль в базовом CSS: новый файл `src/renderer/theme/scrollbars.css`, импорт в
   `src/renderer/main.tsx` рядом с `./theme/tokens.css` (строка 4). Правила — на `*::-webkit-scrollbar`, чтобы новая
   панель получала стиль без своего класса:
   - ширина и высота 10 px; дорожка (`::-webkit-scrollbar-track`) и угол (`::-webkit-scrollbar-corner`) прозрачные;
     кнопок-стрелок нет;
   - thumb: скругление 999 px, прозрачная рамка 2 px и `background-clip: padding-box` (видимая полоса — 6 px);
   - thumb не виден, пока курсор не над контейнером, как у overlay scrollbar-а macOS. Над контейнером
     (`*:hover::-webkit-scrollbar-thumb`) thumb виден, при наведении на сам thumb он темнее (светлее в dark).
2. Цвета — новые tokens в `tokens.css`, свои для light и для dark: `--scrollbar-thumb` и `--scrollbar-thumb-hover`.
   Шапка `tokens.css` требует менять вместе таблицу Tokens в `docs/design/F-SPEC.md`, этот файл и test-ы
   (`test/e2e/theme.spec.ts`, `test/unit/contrast.test.ts`). Там же, в F-SPEC, — одна строка о scrollbar-е.
3. Chromium (Electron 44) не применяет `::-webkit-scrollbar` к элементу, у которого задан `scrollbar-width` или
   `scrollbar-color`. `scrollbar-color` к тому же наследуется. Поэтому:
   - `scrollbar-color` в renderer не появляется нигде;
   - `scrollbar-width: thin` у toolbar Mind map (`mind-map.css:55`) убрать: toolbar получит общий стиль;
   - `scrollbar-width: none` (focus, stories) и `width: 0` у rail sidebar остаются: там scrollbar спрятан намеренно.
4. Стилизованный scrollbar никогда не бывает overlay: на macOS с trackpad-ом он теперь занимает 10 px ширины, где
   раньше было 0. Пройти контейнеры из списка с узким padding-ом справа (body Assistant — 1 px; menu, popover, select,
   CommandPalette), чтобы текст не прилипал к thumb-у. Править padding только там, где видно на глаз.
5. Terminal: свой scrollbar xterm остаётся. В `themeOf` (`TerminalNode.tsx:101`) задать `scrollbarSliderBackground`,
   `scrollbarSliderHoverBackground` и `scrollbarSliderActiveBackground` из тех же tokens, чтобы цвет совпадал.
6. В `docs/features/` абзаца о scrollbar-ах нет, писать его не нужно.

## Где в коде

- `src/renderer/main.tsx:4` — импорт `tokens.css`; рядом ляжет импорт `scrollbars.css`.
- `src/renderer/theme/tokens.css` — `:root` light (строка 9 и дальше) и `@media (prefers-color-scheme: dark)`
  (строка 189) для двух новых tokens.
- `src/renderer/product/mind-map.css:55` — `scrollbar-width: thin` убрать.
- `src/renderer/shell/shell.css:100-102`, `src/renderer/focus/focus.css:88`, `src/renderer/stories/stories.css:44` —
  не трогать.
- `src/renderer/canvas/nodes/TerminalNode.tsx:101-112` — `themeOf`.
- `docs/design/F-SPEC.md` (таблица Tokens), `test/e2e/theme.spec.ts`, `test/unit/contrast.test.ts`.

## Test-ы

- Unit test (например, `test/unit/scrollbars-css.test.ts`), который читает CSS-файлы renderer-а:
  - `main.tsx` импортирует `theme/scrollbars.css`;
  - ни в одном `.css` и `.tsx` под `src/renderer/` нет `scrollbar-color`;
  - `scrollbar-width` встречается только со значением `none`.
  Так новая панель не выключит общий стиль случайно. Test красный до правки (из-за `mind-map.css:55`).
- `test/e2e/theme.spec.ts` сверяет значения tokens с таблицей F-SPEC — дополнить двумя новыми tokens. Локально e2e не
  гонять: его прогоняет CI.
- Сам вид pseudo-element-а в jsdom не проверить — для него ручной пункт.

## Готово, когда

- [ ] Общий стиль scrollbar-а лежит в `src/renderer/theme/scrollbars.css`, подключён в `main.tsx`; tokens
      `--scrollbar-thumb` и `--scrollbar-thumb-hover` есть в light и в dark, они же — в таблице F-SPEC.
- [ ] Unit test на CSS (импорт есть, `scrollbar-color` нет, `scrollbar-width` только `none`) красный до правки и
      зелёный после; `test/e2e/theme.spec.ts` знает новые tokens.
- [ ] У Terminal цвета thumb-а берутся из тех же tokens.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
- [ ] (вручную) Сделай: в Stable worfy на Mac открой панель Assistant → Chat с длинной перепиской, chat Session,
      Settings, Pull requests и diff в Changes. Проверь при Show scroll bars = «Always» и при «Automatically» с
      trackpad-ом, в light и в dark → Должно быть: везде тонкий скруглённый thumb без дорожки; он виден, когда курсор
      над контейнером; широкого серого scrollbar-а нет нигде; текст не налезает на thumb.
  - needs: mac stable
- [ ] (вручную) Сделай: в Stable worfy на Windows открой те же места → Должно быть: тот же тонкий thumb, без
      classic-scrollbar-ов со стрелками.
  - needs: windows stable

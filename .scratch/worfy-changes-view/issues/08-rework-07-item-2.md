# 08: Rework of worfy-changes-view 07, item 2

Type: task
Status: claimed 2026-11-21T00:07Z
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-21 of worfy-changes-view 07, item 2 — 07-приёмка-владельцем.md

**What to build:** the owner checked item 2 of worfy-changes-view 07 on mac stable and it failed. In the words of the owner:

> во первых - изменения в отдельной карточке это неудобно

Кто: агент. Решение владельца — [spec.md](../spec.md), «Ответы владельца 2026-11-21», D1 (Q1 (в)).

Не платформенный Ticket (renderer и чтение Layout-а в main). Глубина ревью — `medium`; снимки экрана вида в «Итог».

## Что происходит

- Changes Ticket-а сейчас — отдельный Node `changes` на Canvas рядом с карточкой. Владелец на приёмке 2026-11-21:
  «изменения в отдельной карточке это неудобно». Решение D1: Changes Ticket-а открываются во весь размер окна, как вид
  Pull requests, — тот же экран diff-а, что у PR во вкладке Pull requests. Панель рядом с чатом в Session view — часть 2,
  без Ticket-а сейчас.
- Входы сейчас:
  - кнопка Changes на карточке — `src/renderer/canvas/actions/Changes.tsx:72` (`ActionButton label="Changes"`), запрос
    из palette она забирает в `:64` (`takeOpenRequest`);
  - строка Open changes в Command palette — `src/renderer/palette/commands.ts:386-390` (`run: () =>
    openChangesFromPalette(...)`, `readOnly`, пока Node-а нет);
  - блок комментария к коду в пузыре чата — `src/renderer/session/QuotedPrompt.tsx:72` (`openChangesAtLine`).
- Node создаёт только `openChanges` (`src/renderer/changes/open.ts:121-134`, операция Layout-а `create` с `kind:
  CHANGES_KIND`, `:28`), id `changes:<epic>/<num>` (`:45`), данные `{ ticket, scope? }` (`:39`, scope читает `:58`).
  Palette центрирует карточку и ждёт её кнопку 2 s (`:148-191`); запрос к строке живёт 5 s, потому что Node
  перемонтируется (`:205-234`).
- Сам Node — `src/renderer/canvas/nodes/ChangesNode.tsx` (компонент `:270`, клавиши `j`/`k`/`n`/`p`/`c` — `:150-170`).
  Registry Node-ов собирает виды из имён файлов (`src/renderer/canvas/nodes/index.ts:30`).
- Вид окна — `ShellView` (`src/renderer/shell/Toolbar.tsx:19`), переключает `setView`
  (`src/renderer/session/navigation.ts:46`); виды смонтированы и скрыты атрибутом `hidden`
  (`src/renderer/shell/AppShell.tsx:120-138`). Вид без кнопки в toolbar уже есть: `story` — его открывает `openStory`
  (`src/renderer/stories/open.ts:85-87`), Esc и смена Project-а возвращают на Canvas
  (`src/renderer/stories/StoryView.tsx:776`, `:786-795`).
- Экран diff-а PR — `ReviewMode` (`src/renderer/pr-review/ReviewMode.tsx:72`), его монтирует
  `src/renderer/pr-inbox/PrInboxView.tsx:789`. Он и Node Changes уже делят `FileTree` и `DiffPane`
  (`src/renderer/changes/FileTree.tsx`, `src/renderer/changes/DiffPane.tsx`; импорт — `ReviewMode.tsx:37-39`) и канал
  `changes.list` (`ReviewMode.tsx:120`). Своё у `ReviewMode`: шапка с Refresh и Close (`:474-482`), колонка списка PR,
  Viewed, лоток Review (`ReviewBar`). Своё у Node-а: шапка scope-ов (`src/renderer/changes/ScopeBar.tsx`), лоток с «To» и
  Send (`src/renderer/changes/Tray.tsx`, `line-comments.tsx`).
- Загрузка Layout-а уже выбрасывает виды Node-ов, которых больше нет: `upgradeLayout` убирает `subagent-tree`
  (`src/main/layout/upgrade.ts:37-40`) и пишет строку log-а (`upgradeMessages`, там же); test —
  `test/contract/layout-store.test.ts`.

## Что делаем

1. Новый вид окна `changes`: значение в `ShellView` (`Toolbar.tsx:19`), без кнопки в toolbar, как `story`;
   `<div className="w-shell__view" data-view="changes">` в `AppShell.tsx`. Предмет вида — Ticket `{ epic, num }` и
   scope — в store рядом с `src/renderer/changes/open.ts`, не в Layout-е.
2. Один экран diff-а для PR и Ticket-а. Общая часть `ReviewMode` и `ChangesNode` — шапка над деревом и diff-ом, дерево
   слева, diff справа, клавиши `j`/`k`/`n`/`p`/`c` и Escape — выносится в общий компонент в `src/renderer/changes/`
   (например, `DiffScreen.tsx`). `ReviewMode` и новый `src/renderer/changes/ChangesView.tsx` дают ему своё: PR — колонку
   списка, Viewed, Review bar; Ticket — `ScopeBar`, лоток `Tray` с «To» и Send. Вид PR на экране не меняется:
   e2e test-ы `test/e2e/pr-review.spec.ts` проходят без правки ожиданий.
3. В шапке вида Changes — одна кнопка возврата «← Canvas» (`data-testid="changes-back"`); Escape делает то же, если его не
   взял открытый слой (popover, меню), как в `StoryView.tsx:786-795`. Смена Project-а в sidebar возвращает на Canvas.
4. Входы открывают вид, а не Node: кнопка Changes (`Changes.tsx`), Open changes в palette (`commands.ts:376-391`),
   блок в пузыре (`openChangesAtLine`, `open.ts:227`). Ожидание кнопки карточки 2 s и запрос к строке на 5 s больше не
   нужны: вид открывается сразу и прокручивает к строке сам.
5. `ChangesNode.tsx` удаляется; `openChanges`, `changesPlace`, `changesNodeOf`, `requestOpenChanges`,
   `takeOpenRequest` и их test-ы — тоже, если их больше никто не зовёт. Плитки Changes в focus mode больше нет.
6. Node-ы `changes`, уже сохранённые в Layout-ах пользователей, `upgradeLayout` убирает при чтении Layout-а, как
   `subagent-tree`, с одной строкой log-а на Project (см. «Решено без владельца», 1).
7. На экране только для чтения (Linked machine с Read only) кнопка Changes и строка palette активны: вид только читает
   git и Layout не меняет. «+», `c`, Comment и лотка там нет, как сейчас.
8. Документы: `docs/features/changes.md` (вид вместо Node-а, вход, «← Canvas», Escape; раздел «The Changes Node»
   переименовать), `docs/features/app-shell.md:147`, `:162-163` (Open changes открывает вид), `docs/features/workflow.md`
   (строка Changes в таблице действий), переводы `docs/features/ru/changes.md` и правленых страниц; термин Changes в
   `CONTEXT.md:65-66` — «вид окна», не «Node».

## Готово, когда

- [ ] Unit test (`test/unit/canvas-actions.test.tsx`): кнопка Changes открывает вид `changes` с этим Ticket-ом и не шлёт
      операции Layout-а; на экране Read only она активна.
- [ ] Unit test (`test/unit/palette-commands.test.tsx`): Open changes открывает вид `changes`, без `readOnly`.
- [ ] Unit test (`test/unit/changes-view.test.tsx`): вид рисует шапку scope-ов, дерево и diff Ticket-а; «← Canvas» и
      Escape возвращают на Canvas; Escape при открытом popover закрывает только popover.
- [ ] Contract test (`test/contract/layout-store.test.ts`): Layout с Node-ом `changes` читается без него, строка log-а
      одна; второе чтение ничего не пишет.
- [ ] e2e test (`test/e2e/changes.spec.ts`, fake agent, временный репозиторий): карточка → Changes → вид `changes` во всё
      окно, файлы и строки совпадают с `git diff <merge-base>`; в сохранённом Layout-е нет Node-а `changes`; «← Canvas»
      возвращает на Canvas; Open changes из palette; репозиторий на 300 файлов открывается свёрнутым; снимки вида в
      светлой и тёмной теме.
- [ ] e2e test (`test/e2e/changes-comments.spec.ts`): два комментария к строке и диапазону уходят одним сообщением из
      вида; блок в пузыре открывает вид на строке.
- [ ] e2e test-ы `test/e2e/pr-review.spec.ts` зелёные без правки ожиданий: экран PR не изменился.
- [ ] Страницы `docs/features/changes.md`, `app-shell.md`, `workflow.md`, их переводы в `docs/features/ru/` и термин в
      `CONTEXT.md` описывают вид; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
- [ ] (manual) Mac Stable: кнопка Changes на карточке открывает Node с diff-ом ветки.
  - needs: mac stable

Пункт (manual) выше записан owner-check-ом дословно из Ticket-а 07. После этого Ticket-а владелец проверяет по нему то,
что решил в D1: кнопка Changes открывает вид Changes во всё окно с diff-ом ветки, «← Canvas» возвращает на Canvas.

## Где в коде

- `src/renderer/shell/Toolbar.tsx:19`, `src/renderer/shell/AppShell.tsx:120-138`, `src/renderer/session/navigation.ts:46`
- `src/renderer/changes/ChangesView.tsx`, `src/renderer/changes/DiffScreen.tsx` (новые; имена — на выбор implementer-а)
- `src/renderer/pr-review/ReviewMode.tsx` (общая часть уходит в `DiffScreen`), `src/renderer/pr-review/pr-review.css`,
  `src/renderer/changes/changes.css`
- `src/renderer/changes/open.ts`, `src/renderer/canvas/actions/Changes.tsx`, `src/renderer/palette/commands.ts:376-391`,
  `src/renderer/session/QuotedPrompt.tsx:72`
- `src/renderer/canvas/nodes/ChangesNode.tsx` (удаляется; лоток и клавиши — в `ChangesView.tsx`)
- `src/main/layout/upgrade.ts`
- `test/unit/canvas-actions.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/unit/changes-view.test.tsx`,
  `test/unit/changes-tray.test.tsx`, `test/contract/layout-store.test.ts`, `test/e2e/changes.spec.ts`,
  `test/e2e/changes-comments.spec.ts`
- `docs/features/changes.md`, `docs/features/app-shell.md`, `docs/features/workflow.md`, `docs/features/ru/`,
  `CONTEXT.md:65-66`

Только читать: `src/renderer/stories/StoryView.tsx:776-795` (образец возврата), `src/renderer/pr-inbox/PrInboxView.tsx:789`,
`src/renderer/changes/DiffPane.tsx`, `src/renderer/changes/FileTree.tsx`, `src/main/changes/` (ADR-0110: чтение git
не меняется).

## Вне скоупа

- Панель Changes рядом с чатом в Session view — часть 2 (D1), без Ticket-а.
- Выбор диапазона перетаскиванием «+», подсказка и строка commit-а в тексте агенту — Ticket 09. Подсветка синтаксиса —
  Ticket 10.

## Решено без владельца

1. **Node-ы `changes` на Canvas-ах пользователей убираются при загрузке Layout-а** (`upgradeLayout`, как
   `subagent-tree`), с одной строкой log-а. Ничего не теряется: неотправленные комментарии — черновики Session в
   `quote-store`, отправленные строки — в localStorage по Ticket-у (`sent-lines.ts`); Node хранил только Ticket и scope.
   Не выбрано: оставить Node-ы как есть (два способа смотреть одно и то же, а Node владелец назвал неудобным) или
   оставить заглушку с кнопкой Open changes (лишний Node на Canvas без пользы).
2. **Возврат — туда, откуда открыли.** С карточки и из palette — «← Canvas», как сказал владелец. Из блока в пузыре чата
   Session view кнопка читается «← Session» и возвращает в Session view: иначе пользователь теряет чат, из которого
   пришёл.
3. **Scope вида не сохраняется между запусками worfy.** Его хранил Node; у вида scope живёт в памяти окна, по Ticket-у,
   и после перезапуска снова All changes.
4. **У вида нет кнопки в toolbar**, как у `story`: без Ticket-а виду нечего показать.

## Итог

Сделано implementer-ом 2026-11-21, ветка `worfy-changes-view/08`.

- Вид окна `changes` (`ShellView` в `src/renderer/shell/Toolbar.tsx`, `data-view="changes"` в `AppShell.tsx`) без кнопки
  в toolbar. Компонент — `src/renderer/changes/ChangesView.tsx` (`ChangesScreen` монтирует shell): шапка «← Canvas»
  (`data-testid="changes-back"`), заголовок, `ScopeBar`, дерево и diff, лоток. Предмет вида, вид возврата и scope по
  Ticket-у — store `useChangesView` в `src/renderer/changes/open.ts`, не Layout.
- Общий экран diff-а — `src/renderer/changes/DiffScreen.tsx` (дерево слева, колонка diff-а справа, свёрнутые папки) и
  клавиши `src/renderer/changes/diff-keys.ts` (`j`/`k`, `↓`/`↑`, `n`/`p`, `c`, Esc; не в текстовом поле и не в открытом
  слое). `ReviewMode.tsx` рисует свои дерево и diff через `DiffScreen`; его шапка, Viewed, Review bar и обработчик клавиш
  не тронуты. e2e `test/e2e/pr-review.spec.ts` прошёл без правки ожиданий.
- Входы: кнопка Changes (`canvas/actions/Changes.tsx`), Open changes (`palette/commands.ts`) и блок в пузыре
  (`openChangesAtLine`) открывают вид сразу; ожидание карточки 2 s и запрос строки на 5 s удалены. На экране Read only
  кнопка и строка palette активны.
- `ChangesNode.tsx` удалён вместе с `changesNodeOf`, `changesPlace`, `requestOpenChanges`, `takeOpenRequest`,
  `openChangesFromPalette`. `upgradeLayout` убирает Node-ы `changes` при чтении Layout-а, одна строка log-а на Project
  (`CHANGES_KIND` — в `src/shared/layout/derived.ts`).
- Отклонение от «Что делаем», 2: клавиши `ReviewMode` не перенесены в `diff-keys.ts` — его обработчик сейчас правит
  worfy-pr-review 11 (⌘⇧↵ Finish review, PR #2122); общая шапка тоже не вынесена: у PR и Ticket-а она разная. Перенос —
  отдельной правкой после merge 11.
- Снимки вида в обеих темах снимает `test/e2e/changes.spec.ts` (`changes-view-card`, `-inline`, `-side-by-side`, `-large`
  в `test-results/e2e/snapshots/`). В репозиторий они не положены: человек ещё не проверил их пиксели (`scrub:`).

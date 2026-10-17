# 10 — Тёмная тема: стопка done со второй карточкой, кольцо акцента у выделенного Node-а и Ticket-а

Type: task
Status: done 2026-10-07
PR: #96
Blocked by: —
Source: ручные проверки 2026-10-07, второй круг, проверка M7 ([PR #93](https://github.com/IDSAD-XL/worfy/pull/93), a3a2c50) — Ticket 11 `worfy-daily`, подраздел [«Ручная проверка 2026-10-07»](../../worfy-daily/issues/11-заголовки-и-chip-ы-без-обрезки.md#ручная-проверка-2026-10-07); [F-SPEC.md](../../../docs/design/F-SPEC.md), «Light/dark pairing rule»; макет `docs/design/F-canvas-dark.dc.html:205-207`; HANDOFF, «Риски и долги»; [spec.md](../spec.md), этап 3

## Что происходит

- Токен `--shadow-node` в тёмной теме — `none` (`src/renderer/theme/tokens.css:117`), в светлой —
  две мягкие тени (`:72`). Так велит F-SPEC: в тёмной теме теней нет («Light/dark pairing rule»).
- Но правило стопки done и три правила выделения ставят `var(--shadow-node)` в список `box-shadow`
  через запятую. `none` внутри списка недопустим, и браузер отбрасывает всё объявление.
  - Стопка done: `src/renderer/canvas/epic-frame.css:170-173`. Вторая карточка стопки нарисована
    тенями `4px 4px 0 -1px var(--done-bg), 4px 4px 0 0 var(--border)`. В тёмной теме стопка
    плоская. В светлой теме и в макете `F-canvas-dark.dc.html:205-207` — со второй карточкой.
  - Кольцо акцента 1 px у выделенного Node-а и Ticket-а: `src/renderer/canvas/canvas.css:22`,
    `src/renderer/canvas/node-chrome.css:37`, `src/renderer/canvas/epic-frame.css:243` — везде
    `var(--shadow-node), 0 0 0 1px var(--accent)`. В тёмной теме кольца нет, выделение видно только
    по цвету рамки.
- Проверка M7: в Chromium 152 `CSS.supports` для такого списка даёт false; у стопки на живой Stable
  copy вычисленный `box-shadow` — `none`. `none` в тёмной теме — с коммита 5c70880; списки с
  `var(--shadow-node)` — с коммитов d91f11f (`canvas.css`), e1b08be (`node-chrome.css`) и a634fa2
  (`epic-frame.css`, 2026-10-05).
- `--shadow-control` и `--shadow-primary` в тёмной теме тоже `none` (`tokens.css:118-119`). В
  списках они сейчас не стоят, но ловушка та же.

## Что делаем

- В тёмной теме токены теней — не `none`, а тень, которой не видно и которая допустима в списке
  (например, `0 0 #0000`). Так правятся все три токена: `--shadow-node`, `--shadow-control`,
  `--shadow-primary`. Тени в тёмной теме по-прежнему нет, а списки снова работают: стопка done
  рисует вторую карточку, у выделенного Node-а и Ticket-а есть кольцо акцента 1 px.
- Правила в `canvas.css`, `node-chrome.css` и `epic-frame.css` не меняются. Если исполнитель решит
  править их, а не токены, он добавляет файлы в «Где в коде» и заново проверяет пересечения с
  Ticket-ами Wave: `canvas.css` меняет Ticket 09.
- Unit-test сторожит ловушку: ни один токен `--shadow-*` ни в одной теме не равен `none`.
- Снимки — helper `snapshotThemes` (`test/e2e/snapshots.ts`, Ticket 18 `worfy-daily`); по правилу
  ревью UI-Ticket-а их сверяют с F-SPEC в обеих темах.

ADR не нужен.

## Готово, когда

- [x] Unit `test/unit/shadow-tokens.test.ts`: ни один токен `--shadow-*` в `src/renderer/theme/tokens.css` ни в светлой, ни в тёмной теме не равен `none`.
- [x] e2e `test/e2e/theme-shadows.spec.ts`, тёмная тема (эмуляция prefers-color-scheme): вычисленный `box-shadow` свёрнутой стопки done не `none` и рисует вторую карточку (смещение 4px 4px); у выделенного Node-а пользователя и у выделенного Ticket-а — кольцо `0 0 0 1px` цвета `--accent`. В светлой теме — то же и прежние мягкие тени.
- [x] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`): рамка Epic-а со свёрнутой стопкой done и выделенным Ticket-ом, выделенный Node пользователя. Сверены с F-SPEC и макетом `F-canvas-dark.dc.html:205-207`: в тёмной теме стопка со второй карточкой, кольцо выделения видно, теней нет. Ссылка из «Итог» — `../evidence/10-тёмная-тема.png`.
- [ ] (вручную) Stable copy после влития, тёмная тема: стопка done со второй карточкой, у выделенного Node-а и Ticket-а кольцо акцента. Как проверить: окно приложения. После этого можно отметить пункт «Снимки в светлой и тёмной теме сверены с F-SPEC» Ticket-а 11 `worfy-daily` (`11-заголовки-и-chip-ы-без-обрезки.md:57`).
  не проверено: окно Stable copy смотрит владелец после влития; исполнитель приложение напрямую не запускает (это подняло бы Orchestrator на настоящем Claude Code).

## Тесты

Сначала падающий test — `test/unit/shadow-tokens.test.ts`: на нынешнем main три токена тёмной темы
равны `none`. В «Итог» — как он падал. Затем e2e: на main вычисленный `box-shadow` стопки в тёмной
теме — `none`.

- `test/unit/shadow-tokens.test.ts` — новый.
- `test/e2e/theme-shadows.spec.ts` — новый: вычисленные тени и снимки в двух темах.

## Где в коде

- `src/renderer/theme/tokens.css`
- `test/unit/shadow-tokens.test.ts` — новый
- `test/e2e/theme-shadows.spec.ts` — новый
- `test/e2e/theme.spec.ts` — правка вне исходного следа, разрешена оркестратором: ожидание тени Node-а в
  тёмной теме

Общих файлов с Ticket-ами 08, 09, 11 и 12 нет.

## Итог

Сделано в ветке `worfy-week/10`, база `origin/main` c539cfd. ADR не заводился (тикет его не требует).

**Как падали test-ы до правки.** `test/unit/shadow-tokens.test.ts`, «dark: no shadow token is "none"…»: на
`origin/main` в тёмной теме `none` у трёх токенов — `--shadow-node`, `--shadow-control`, `--shadow-primary`.
`test/e2e/theme-shadows.spec.ts` на том же main: светлая тема прошла целиком (стопка, кольцо у Ticket-а и у Note);
в тёмной вычисленный `box-shadow` стопки done — `none` вместо
`rgb(27, 26, 24) 4px 4px 0px -1px, rgb(46, 43, 40) 4px 4px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px`.

**Что сделано.**
- `src/renderer/theme/tokens.css`: в тёмной теме три токена теней — `0 0 #0000` (прозрачная тень нулевого размера)
  вместо `none`. Светлые значения не менялись. Правила в `canvas.css`, `node-chrome.css`, `epic-frame.css` не
  менялись: списки `box-shadow` с этими токенами в тёмной теме снова действуют.
- `test/unit/shadow-tokens.test.ts`: читает `tokens.css`; в обеих темах одинаковый набор `--shadow-*`, ни один не
  содержит `none`.
- `test/e2e/theme-shadows.spec.ts`: Epic `demo` (две done-карточки в стопке, 03 и 04 открыты), Note пользователя;
  выделены Ticket 03 и Note (⌘-клик). В обеих темах точное сравнение вычисленного `box-shadow`: стопка — вторая
  карточка `4px 4px` цвета `--done-bg` с рамкой `--border` плюс `--shadow-node`; Ticket и Note — `--shadow-node`
  плюс `0 0 0 1px` цвета `--accent`. В светлой `--shadow-node` — прежние две мягкие тени, в тёмной — прозрачный слой.
- `test/e2e/theme.spec.ts` (с разрешения оркестратора): «dark: a Node has no shadow» ждёт
  `rgba(0, 0, 0, 0) 0px 0px 0px 0px` вместо `none` — тени по-прежнему не видно. Файл вне списка файлов
  Ticket-а. **Решено без владельца, подтверждено владельцем 2026-10-12.**

**Что изменилось вне трёх правил.** Остальные места с этими токенами (`focus.css`, `trash.css`,
`selection-toolbar.css`, `minimap.css`, `session.css`, `primitives.css`, inline-стили панелей) ставят токен одним
значением: в тёмной теме там теперь прозрачная тень вместо `none`, на экране разницы нет.

**Снимки** (helper `snapshotThemes`, копии из `test-results/snapshots/theme-shadows/`):
[тёмная тема](../evidence/10-тёмная-тема.png), [светлая тема](../evidence/10-светлая-тема.png). Сверены с F-SPEC
(«Light/dark pairing rule») и `F-canvas-dark.dc.html:205-207`: в тёмной теме у стопки done видна вторая карточка,
у выделенных Ticket-а 03 и Note — кольцо акцента, теней нет; светлая тема — как раньше, с мягкими тенями.

**Влито.** [PR #96](https://github.com/IDSAD-XL/worfy/pull/96), merge d71bf9a. Ревью — VERIFIED с первого
круга, без доработки и без находок. Попиксельное сравнение тёмной темы: возврат токенов к `none`
меняет только полосу 4 px второй карточки стопки done; minimap, корзина, focus mode и панели не
меняются, светлая тема — тоже.

**Долг.** Нет. Вне тикета ревью заметило давнее: панель выделения закрывает шапку рамки Epic-а и
подпись колонки «Done 2» — кандидат в новый тикет.

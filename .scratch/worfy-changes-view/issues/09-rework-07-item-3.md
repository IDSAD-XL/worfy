# 09: Rework of worfy-changes-view 07, item 3

Type: task
Status: done 2026-11-21T17:19Z
PR: #2130
Blocked by: 08
Source: owner-check fail 2026-11-21 of worfy-changes-view 07, item 3 — 07-приёмка-владельцем.md

**What to build:** the owner checked item 3 of worfy-changes-view 07 on mac stable and it failed. In the words of the owner:

> во вторых - как выделать диапазон строк непонятно

Кто: агент. Решения владельца — [spec.md](../spec.md), «Ответы владельца 2026-11-21», D2 (Q2) и D3 (Q3).

Не платформенный Ticket (renderer и чтение git в main). Глубина ревью — `medium`; снимок экрана подсказки в «Итог».
Blocked by 08: те же файлы — лоток и клавиши, которые Ticket 08 переносит из `ChangesNode.tsx` в вид Changes,
`line-comments.tsx`, `docs/features/changes.md`.

## Что происходит

- **Диапазон строк (D2).** Выбрать диапазон сейчас можно, но этого не видно:
  - «+» в gutter сразу открывает popover на одну строку (`src/renderer/changes/line-comments.tsx:574-590`, `onClick` →
    `openOn`);
  - диапазон даёт только щелчок по строке, затем щелчок по другой с Shift (`:612-622`), или выделение текста через
    строки (`:623-632`), а потом клавиша `c` (`:643-651`) или Comment в меню правого клика (`:633-641`, `:667`);
  - без выбранной строки `c` показывает toast «Click a line first, then press c» (`:645-648`); пока строки выбраны,
    экран ничего не подсказывает.
  - Тот же код, отдельной копией, — в Review mode PR: `src/renderer/pr-review/review-comments.tsx:230` (`picked`),
    `:434` (`renderGutter`), `:466-483` (щелчок с Shift и выделение), `:486-494` (`c`); меню правого клика там нет.
  - Состояние выбора — `Picked { key, side, start, end }` (`line-comments.tsx:76-84`); строки выбора подсвечивает
    `isPicked` в `DiffPane.tsx` (`marks`, класс `is-picked`).
- **Commit в тексте агенту (D3).** `commitOf` (`src/renderer/changes/line-comments.tsx:121-128`) в All changes на
  worktree даёт `null` для новой стороны любого файла (`:126`: `list?.workTree === true ? null : hex(head)`), а
  `agentText` пишет на `null` слово «uncommitted» (`src/renderer/session/quote-comments.ts:341`). Поэтому каждый
  комментарий говорит «uncommitted», даже в чистом worktree, где все строки уже в HEAD.
  - All changes на worktree — один diff от merge-base до рабочего дерева (`src/main/changes/scopes.ts:137`); какие файлы
    отличаются от HEAD, ответ `changes.list` не говорит: у репозитория есть только `headSha` и `workTree`
    (`src/shared/ipc/changes.ts:160-161`), у файла — только `untracked` (`src/shared/changes/types.ts:48`).
  - Commit сохраняется в комментарии при сохранении (`line-comments.tsx:370`), а после Refresh комментарий с другим
    commit-ом, чем у нового чтения, не ищется заново (`:533`) — считается комментарием другого scope-а.
  - Формат строки агенту читает `parseQuoted` (`CODE_ITEM`, `src/renderer/session/quote-comments.ts:299`):
    `(new side, commit f3bcb3e16)` или `(new side, uncommitted)`.

## Что делаем

1. Общий выбор строк для Changes и Review mode PR — новый модуль `src/renderer/changes/line-pick.ts` (hook): обе копии
   (`line-comments.tsx`, `review-comments.tsx`) переходят на него.
2. Перетаскивание «+», как на GitHub: нажатие на «+» начинает выбор на своей строке; движение вниз или вверх по строкам
   того же файла и той же стороны растягивает его (слушатели `mousemove` и `mouseup` на `window` до отпускания, строка —
   по `data-side`/`data-line` под указателем); отпускание открывает popover на весь диапазон. Строка другого файла или
   другой стороны выбор не меняет. Отпускание на той же строке — popover на одну строку, как сейчас.
3. Щелчок с Shift на «+» растягивает выбранное до этой строки (тот же файл и сторона) и popover не открывает; без
   выбранного — выбор одной строки.
4. Пока строки выбраны, у последней выбранной строки видна подсказка «Comment on lines 95–102 (c)» (на одну строку —
   «Comment on line 95 (c)»), `data-testid="changes-pick-hint"`. Щелчок по ней открывает popover, как `c`. Escape и
   щелчок по строке вне выбора её убирают.
5. Клавиша `c` и Comment в меню правого клика остаются как есть. Щелчок по строке, щелчок с Shift по строке и
   выделение текста через строки тоже остаются.
6. Commit по файлу: в ответ `changes.list` у файла новое поле `uncommitted: boolean` (`src/shared/changes/types.ts`,
   `src/shared/ipc/changes.ts`). Main ставит его на worktree: файл отличается от HEAD (в index или в рабочем дереве)
   или не отслеживается git-ом; список — одной командой `git diff --name-only -z HEAD` на репозиторий
   (`src/main/changes/scopes.ts`, только чтение, `GIT_OPTIONAL_LOCKS=0`, ADR-0110; `diff` уже в `READ_COMMANDS`,
   `src/main/changes/git.ts:59`). У ветки без worktree поле `false`; в scope Uncommitted — `true` у каждого файла.
7. `commitOf` получает файл: новая сторона в All changes и Compare against на worktree — `null` («uncommitted») только у
   файла с `uncommitted`, иначе HEAD (`headSha`). Старая сторона, Commit и Uncommitted — как сейчас.
8. Refresh: неотправленный комментарий новой стороны All changes ищется заново, даже если его commit был `null` или
   прежним HEAD-ом этого Ticket-а (агент закоммитил файл после комментария), и получает commit нового чтения. Иначе после
   commit-а агента комментарий выпадает из поиска (`line-comments.tsx:533`).
9. Английская страница `docs/features/changes.md` и её перевод `docs/features/ru/changes.md`: перетаскивание «+», Shift
   на «+», подсказка; строка commit-а в тексте агенту. То же для Review mode — в `docs/features/human-review.md` и
   переводе, если страница описывает выбор строк в Review mode.

## Готово, когда

- [ ] Unit test (`test/unit/changes-line-pick.test.tsx`, новый): нажатие на «+» и движение через строки выбирает
      диапазон, отпускание открывает popover на него; строка другого файла или стороны выбор не меняет; Shift-щелчок по
      «+» растягивает выбранное без popover-а; подсказка «Comment on lines N–M (c)» видна, пока строки выбраны, и
      щелчок по ней открывает popover.
  - evidence: test-run pass · `pnpm test test/unit/changes-line-pick.test.tsx` exit 0 · mac - · 159692900
- [ ] Unit test (`test/unit/review-comments.test.tsx`): то же перетаскивание и подсказка в Review mode PR.
  - evidence: test-run pass · `pnpm test test/unit/review-comments.test.tsx` exit 0 · mac - · 159692900
- [ ] Unit test (`test/unit/changes-tray.test.tsx`): в чистом worktree комментарий новой стороны All changes несёт
      `headSha`; у файла с `uncommitted` — `null`; после Refresh, где файл стал закоммиченным, неотправленный комментарий
      найден на строке и несёт новый HEAD.
  - evidence: test-run pass · `pnpm test test/unit/changes-tray.test.tsx` exit 0 · mac - · 159692900
- [ ] Contract test (`test/contract/changes-read.test.ts`): `uncommitted` у файла, изменённого только commit-ом Ticket-а, —
      `false`; у правленного в рабочем дереве, в index и у нового неотслеживаемого — `true`; `.git/index` не тронут.
  - evidence: test-run pass · `pnpm test test/contract/changes-read.test.ts` exit 0 · mac - · 159692900
- [ ] e2e test (`test/e2e/changes-comments.spec.ts`, fake agent, временный репозиторий с закоммиченной и незакоммиченной
      правкой): диапазон перетаскиванием «+» и комментарий к строке → Send → одно сообщение; у строки закоммиченного файла
      — `(new side, commit <HEAD>)`, у незакоммиченного — `(new side, uncommitted)`; снимок подсказки в светлой и тёмной
      теме.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/changes.spec.ts test/e2e/changes-comments.spec.ts test/e2e/pr-review.spec.ts` exit 0 · mac dev · 159692900
- [ ] e2e test (`test/e2e/pr-review.spec.ts`, тест «comments on lines»): диапазон перетаскиванием «+» в Review mode.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/changes.spec.ts test/e2e/changes-comments.spec.ts test/e2e/pr-review.spec.ts` exit 0 · mac dev · 159692900
- [ ] Страница `docs/features/changes.md` и перевод описывают выбор диапазона и строку commit-а;
      `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 (in `pnpm lint`) · mac - · 159692900
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44923290094/job/136921795205 · ci - · 57663a9e5528d927d842c5106da63bc7df6aa5e6
- [x] (manual) Mac Stable: комментарии к строке и диапазону уходят агенту одним сообщением с путями, строками и кодом.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-9-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-9-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-9-3.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Summary of items 13–19. A line comment and a range comment went to the bound fake-agent Session as one message with paths, lines, side, commit and code. Agent log verified. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763

Пункт (manual) выше записан owner-check-ом дословно из Ticket-а 07. Владелец проверяет по нему и то, что решил в D2 и
D3: диапазон выбирается перетаскиванием «+», подсказка видна, а закоммиченный файл в тексте агенту назван commit-ом HEAD.

Шаги приёмки владельца — из `.scratch/owner-acceptance-guides.md` (перенесены 2026-11-24, `worfy-acceptance` 08):
подготовка Orchestrator-а — пункты без метки, шаги владельца — пункты с меткой, по одному на шаг.

- [ ] Orchestrator: обновить Mac Stable до `main` после «да» владельца и сверить версию.
- [ ] Orchestrator: завести в `worfy-sandbox` Ticket с worktree (ветка с commit-ами, закоммиченный файл и файл с
      правкой без commit-а) — тот же, что для шагов Ticket-а 08.
- [ ] Orchestrator: привязать к этому Ticket-у Session (Binding).
- [x] (manual) Сделай: в виде Changes Ticket-а наведи на строку diff-а и щёлкни **«+»** в gutter; напиши текст и нажми
      Save (⌘↵) → Должно быть: popover называл место (`<path>:<строка> · new side`) и код строки; после Save
      комментарий стоит под строкой с меткой «not sent», Edit и Delete; в лотке внизу — «1 comment on 1 file».
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-13-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-13-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Click «+» on cart.ts:50. Popover reads «src/cart.ts:50 - new side» with the line's code. After ⌘↵ the comment sits under the line with «not sent», Edit and Delete. Tray reads «1 comment on 1 file». · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: нажми **«+»** у строки и, не отпуская, протяни вниз через несколько строк того же hunk-а,
      отпусти → Должно быть: строки подсвечиваются, пока по ним идёт указатель; после отпускания popover открыт на весь
      диапазон.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-14-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-14-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Mouse down on «+» of line 3 and drag down: mid-drag lines 3–5 carry is-picked (blue in screenshot), 3–7 by the end. On release the popover opens with «src/cart.ts:3–7 - new side». · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: закрой этот popover «Cancel»; щёлкни строку, потом Shift+щелчок по «+» строки ниже → Должно
      быть: выбор растянулся до неё, popover не открылся; под последней выбранной строкой подсказка «Comment on lines
      N–M (c)».
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-15-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Cancel, then click discount.ts line 1 and Shift+click «+» on line 3. Lines 1–3 picked, no popover. «Comment on lines 1–3 (c)» appears under line 3. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: щёлкни подсказку (или нажми `c`); добавь в popover картинку (вставь из буфера или «Add
      image»), напиши текст и Save → Должно быть: второй комментарий под последней строкой диапазона; в лотке «2
      comments on …» и chip на каждый.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-16-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-16-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: c opens the popover on 1–3. A synthetic paste of a PNG adds an image chip. After Save the second comment sits under line 3 with «1 image». Tray: «2 comments on 2 files», one chip each. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: открой ещё один комментарий, набери текст и нажми Esc → Должно быть: popover с изменённым текстом
      остаётся открытым (исправлено `worfy-polish` 136, #2072, `0b3abe8e6` — нужен Stable с этим commit-ом). Закрой
      popover «Cancel».
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-17-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Opened a popover on cart.ts:5, typed text, pressed Esc. Popover stayed open with the text after 500 ms; Cancel closed it and still 2 comments. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: посмотри «To» в лотке → Должно быть: выбрана Session, привязанная к Ticket-у (без неё —
      Orchestrator).
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-18-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-18-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: With a worfy Session node bound to Ticket 04 (bindings.json), «To» shows «Session b0b0b0b0». Without a binding (first run) «To» shows «Orchestrator». · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: напиши общий текст в поле лотка и нажми **Send** → Должно быть: оба комментария стали тусклыми,
      «sent to <Session>»; в чате Session одно сообщение: раздел «Comments on lines of the diff (2)» с worktree и
      веткой, у каждого комментария путь, строки, сторона и commit, код и текст, потом «General:» и твой текст; у
      строки закоммиченного файла — `(new side, commit <HEAD>)`, у файла с правкой без commit-а — `(new side,
      uncommitted)`; агент отвечает на всё сразу.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-19-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-19-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Both comments dim (opacity 0.55) with «sent to Session b0b0b0b0». The agent got one message: worktree, branch, commit 51d7b66, «uncommitted», code, image, «General:». The chat bubble shows paths, code, texts and the general text. Fake agent reply only. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: в чате Session щёлкни путь в блоке комментария → Должно быть: открылся вид Changes этого
      Ticket-а и прокрутился к строке, строка мигнула; кнопка возврата читается **← Session** и ведёт в чат.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-20-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Clicking src/discount.ts:1–3 in the Session chat opens the Changes view on that line (data-flash=true, in viewport). Back button reads «← Session» and returns to the chat. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: оставь один комментарий неотправленным и попроси Orchestrator-а перезапустить Stable → Должно
      быть: после перезапуска комментарий «not sent» на месте и в лотке.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-09-21-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-09-21-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Left one comment on cart.ts:5 unsent, closed Electron, relaunched with the same data dir. After reopening, the comment shows «not sent» with its text, tray «1 comment on 1 file». The first try failed in my script, not the app. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763

## Где в коде

- `src/renderer/changes/line-pick.ts` (новый), `src/renderer/changes/line-comments.tsx:76-128`, `:574-651`,
  `src/renderer/pr-review/review-comments.tsx:230`, `:434-494`, `src/renderer/changes/changes.css` (подсказка)
- `src/shared/changes/types.ts:48`, `src/shared/ipc/changes.ts:153-169`, `src/main/changes/scopes.ts:137`, `:226`
  (`listChanges`)
- `test/unit/changes-line-pick.test.tsx` (новый), `test/unit/review-comments.test.tsx`, `test/unit/changes-tray.test.tsx`,
  `test/contract/changes-read.test.ts`, `test/e2e/changes-comments.spec.ts`, `test/e2e/pr-review.spec.ts`
- `docs/features/changes.md`, `docs/features/ru/changes.md`, `docs/features/human-review.md` и перевод (если нужно)

Только читать: `src/renderer/session/quote-comments.ts:299`, `:341` (формат не меняется), `src/main/changes/git.ts:59`,
`src/renderer/changes/DiffPane.tsx` (подсказка и перетаскивание идут через `renderGutter`, `renderBelow` и
`lineEvents`; `Code` правит Ticket 10).

## Вне скоупа

- Меню правого клика в Review mode PR. Commit по отдельной строке, а не по файлу. Подсветка синтаксиса — Ticket 10.

## Решено без владельца

1. **Формат строки агенту не меняется:** `(new side, commit f3bcb3e16)`, как у старой стороны сейчас. Пример владельца
   `new side, f3bcb3e16` несёт то же; слово `commit` держит `parseQuoted` (`quote-comments.ts:299`) и уже отправленные
   сообщения.
2. **«Uncommitted» — по файлу, а не по строке**, как сказал владелец: у файла с незакоммиченными правками все строки
   новой стороны — «uncommitted», даже те, что уже в HEAD.
3. **Перетаскивание и подсказка — и в Review mode PR.** После Ticket-а 08 это один экран; два разных способа выбрать
   диапазон на одном экране запутали бы.
4. **Отпускание после перетаскивания открывает popover сразу**, как на GitHub; Shift-щелчок только растягивает выбор, а
   popover открывают `c`, подсказка или Comment.
5. **Подсказка стоит у последней выбранной строки**, не в шапке: она там, куда смотрит пользователь.
6. **Подсказка и перетаскивание не трогают `DiffPane.tsx`**: они идут через его props, а `mousemove` слушает `window`.
   Так Ticket 10, который правит `Code` в `DiffPane.tsx`, идёт параллельно.

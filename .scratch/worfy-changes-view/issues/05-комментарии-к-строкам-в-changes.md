# 05 — Комментарии к строкам в Changes: gutter, popover, лоток, список «To» и Send одним сообщением

Type: task
Status: done 2026-11-20T03:36Z
PR: #2049
Blocked by: 03, 04
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Решение» → «Как пользователь идёт по экрану», шаги 4–6 и 8;
«Решения по реализации — часть 1» → «Комментарии к строкам», пункты «Экран», Send, «Список «To»», «На экране только для
чтения»; «Linked machine и Silent mode»; «Вопросы владельцу», Q2

Кто: агент.

Не платформенный Ticket (renderer и чтение в main). Глубина ревью — `medium`; снимок экрана лотка в «Итог».

## Что происходит

- После Ticket-ов 03 и 04 Node Changes показывает diff, а модель Comments on quotes знает комментарий к коду
  (вариант `code`, `src/renderer/session/quote-comments.ts`), но поставить комментарий на строку нельзя.
- Send поля ввода Session — `composeRound` (`src/renderer/session/quote-comments.ts:308`) и `agent.send`
  (`src/shared/ipc/agent.ts:69-75`); сообщение во время хода ждёт в очереди (`docs/features/sessions.md:129-131`).
- Session Node, привязанный к Ticket-у, main уже умеет найти: `ticketSession` (`src/main/actions/launch.ts:409-430`) —
  worfy, Claude Code, не в Archive, Binding manual или launch, с порогом 24 часа. Session Orchestrator-а —
  `liveOrchestratorSession` (`src/main/ipc/getting-started.ts:92`).
- Экран только для чтения не предлагает комментариев (`docs/features/sessions.md:254`); палитра знает `readOnly`
  (`src/renderer/palette/commands.ts:130`).
- Kit: `src/renderer/theme/kit/Popover.tsx`, `ContextMenu.tsx`, `Menu.tsx` (ADR-0106).

## Что делаем

1. Gutter `DiffPane.tsx`: «+» на наведении, клавиша `c` на выбранной строке, выделение нескольких строк — диапазон;
   ContextMenu строки — Comment и Copy line.
2. `src/renderer/changes/LineComment.tsx` — popover kit: текст и до 3 картинок, как у Comments on quotes, ⌘↵ сохраняет;
   неотправленный комментарий под своей строкой с Edit и Delete.
3. `src/renderer/changes/Tray.tsx` — лоток внизу Node-а: «N comments on M files», chip-ы (щелчок — к строке), Clear,
   поле общего текста, «To», Send ⌘↵. Лоток показывает комментарии выбранной Session из её хранилища (`quoteKey`), то
   же видит её поле ввода.
4. Список «To»: канал `changes.targets` (`'project', 'read'`) в `src/shared/ipc/changes.ts` и `src/main/ipc/changes.ts`,
   отбор в `src/main/changes/targets.ts` — Session Node-ы с Binding-ом на Ticket, как `ticketSession`, но без порога 24
   часа, и Orchestrator Project-а. По умолчанию — Session с Binding-ом с самой новой записью, без неё — Orchestrator
   (Q2). Пока Orchestrator ведёт Run — предупреждение «Autopilot is running». Смена «To» переносит неотправленные
   комментарии к коду в лоток новой Session.
5. Send делает то же, что Send поля ввода этой Session (`composeRound`, `agent.send`), с очередью как сейчас.
   Отправленные комментарии остаются тусклыми на своих строках.
6. Блок комментария к коду в сообщении пользователя (`QuotedPrompt.tsx`, Ticket 04) открывает Changes Ticket-а на этой
   строке.
7. Refresh ищет неотправленные комментарии заново (`anchorLines` Ticket-а 04); строки нет — «Line changed», комментарий
   остаётся в лотке.
8. Экран Read only: нет «+», `c`, Comment в ContextMenu и лотка; diff читается.
9. Английская страница `docs/features/changes.md`: комментарии, лоток, «To», Send, Read only. Перевод — Ticket 06.

## Готово, когда

- [ ] Unit test (`test/unit/changes-tray.test.tsx`): «+», `c` и диапазон открывают popover; лоток показывает
      комментарии выбранной Session; смена «To» переносит комментарии к коду; Read only — без «+» и лотка.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/changes-tray.test.tsx) · mac - · 8d4712631278dd4d90184936eac4f7d1d928075d
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/changes-tray.test.tsx, 20 tests) · mac - · 229bf46b987096ae3467b33254d1dbbf6ffa2002
- [ ] Contract test (`test/contract/changes-targets.test.ts`): Session с Binding-ом на Ticket — в списке, Session другого
      Ticket-а — нет, Orchestrator — есть; значение по умолчанию по Q2.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/changes-targets.test.ts) · mac - · 8d4712631278dd4d90184936eac4f7d1d928075d
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/changes-targets.test.ts) · mac - · 229bf46b987096ae3467b33254d1dbbf6ffa2002
- [ ] e2e test (`test/e2e/changes-comments.spec.ts`, fake agent): карточка → Changes → два комментария к строке и
      диапазону → Send: fake agent получил одно сообщение с разделом «Comments on lines of the diff (2)», путями,
      строками и кодом; блок в пузыре открывает Changes на строке.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/changes-comments.spec.ts` exit 0 · mac dev · 8d4712631278dd4d90184936eac4f7d1d928075d
- [ ] e2e test: неотправленный комментарий переживает перезапуск окна.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/changes-comments.spec.ts` exit 0 (window.reload) · mac dev · 8d4712631278dd4d90184936eac4f7d1d928075d
- [ ] Снимок экрана лотка с «To» — в «Итог» (в scratchpad, в репозиторий не кладётся).
  - evidence: screenshot pass · changes-tray-light.png and changes-tray-dark.png in the scratchpad, named in «Итог» · mac dev · 8d4712631278dd4d90184936eac4f7d1d928075d
- [ ] Английская страница `docs/features/changes.md` описывает комментарии; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 8d4712631278dd4d90184936eac4f7d1d928075d
  - evidence: test-run pass · `pnpm lint` exit 0 (runs node scripts/check-feature-docs.mjs) · mac - · 229bf46b987096ae3467b33254d1dbbf6ffa2002
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 8d4712631278dd4d90184936eac4f7d1d928075d
  - evidence: gate pass · `gate fast` exit 0 · mac - · 229bf46b987096ae3467b33254d1dbbf6ffa2002
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44660840128/job/136050749596 · ci - · 00db8a874efb516e1b79d4d66a40866fb7c7097e

## Где в коде

- `src/renderer/changes/DiffPane.tsx` (Ticket 03), `src/renderer/changes/LineComment.tsx`, `src/renderer/changes/Tray.tsx`
  (новые)
- `src/renderer/session/QuotedPrompt.tsx` (переход к строке)
- `src/shared/ipc/changes.ts`, `src/main/ipc/changes.ts` (Ticket 02), `src/main/changes/targets.ts` (новый)
- `test/unit/changes-tray.test.tsx`, `test/contract/changes-targets.test.ts`, `test/e2e/changes-comments.spec.ts` (новые)
- `docs/features/changes.md`

Только читать: `src/renderer/session/quote-comments.ts:308`, `src/renderer/session/quote-store.ts:39`,
`src/main/actions/launch.ts:409-430`, `src/main/ipc/getting-started.ts:92`, `src/shared/ipc/agent.ts:69-75`.

## Вне скоупа

- «New session in this worktree» и Session самого Node-а в «To», комментарии к PR и Add to comments — часть 2.

## Итог

Сделано implementer-ом 2026-11-20, ветка `worfy-changes-view/05`.

- Комментарий к строке или диапазону одного файла и одной стороны: «+» в gutter строки под указателем, клавиша `c` на
  выбранных строках (клик, клик с Shift, выделение через строки), Comment в меню правого клика (рядом Copy line).
  Popover (`src/renderer/changes/LineComment.tsx`) — место, код строк, текст и до трёх картинок, ⌘↵ сохраняет; клик
  вне или Esc закрывает только неизменённый. Комментарий — черновик Session из «To» в общем store
  (`quote-store.ts`, `addDraft`/`editDraft`), под последней строкой — «not sent», Edit, Delete с Undo 6 с.
- Лоток (`src/renderer/changes/Tray.tsx`): «N comments on M files[ · K on messages]», chip на комментарий (переход к
  строке), Clear, «To», поле общего сообщения, Send. «Autopilot is running» — при Orchestrator-е в «To» и идущем Autopilot.
- «To» — канал `changes.targets` (`src/shared/ipc/changes.ts`, `src/main/ipc/changes.ts`, новый
  `src/main/changes/targets.ts`): Session-ы worfy с Binding-ом на Ticket (ручной Binding сильнее launch-а), не в архиве,
  по свежести последней записи, затем Orchestrator.
- Send (`src/renderer/changes/line-comments.tsx`) делает то же, что Send поля ввода Session: `composeRound` →
  `agent.send` → `markPending`; Session, которая не идёт, сначала запускается (`sessions.start` / `orchestrator.open`).
  Отправленные остаются тусклыми на строках: новый store `src/renderer/changes/sent-lines.ts` (localStorage, ключ
  `worfy.changes-sent:<project>/<epic>/<num>`, 200 последних на Ticket).
- После Refresh неотправленные ищутся заново в строках hunk-ов (`anchorLines`); не найденные — «Line changed».
- Блок комментария в пузыре чата (`src/renderer/session/QuotedPrompt.tsx`): путь — кнопка, открывает Node Changes
  Ticket-а ветки и прокручивает к строке с подсветкой (`openChangesAtLine` в `src/renderer/changes/open.ts`; запрос
  живёт 5 с, потому что Node перемонтируется при смене вида). `DiffPane.tsx` получил `renderBelow`, `isPicked`,
  `lineEvents`, `onFileRead` и `scrollToLine`.
- Read only (Linked machine): нет «+», `c`, Comment и лотка.
- Файлы вне списка «Где в коде»: `src/renderer/canvas/nodes/ChangesNode.tsx` (монтирует лоток и popover, клавиша `c`),
  `src/renderer/changes/line-comments.tsx`, `sent-lines.ts`, `open.ts`, `diff-window.ts` (`lineNumber` — из-за правила
  lint react-refresh), `changes.css`; `test/unit/link-access.test.ts` — новый канал `changes.targets` помечен как
  чтение (test требует решения по каждому каналу `project`).
- Страница `docs/features/changes.md`: раздел «Comments on lines», клавиша `c`, Read only.

Снимки лотка с «To» (Playwright `page.screenshot()` в e2e, в репозиторий не положены):
`/tmp/worfy-changes-view-w3/impl-05/changes-tray-light.png`, `/tmp/worfy-changes-view-w3/impl-05/changes-tray-dark.png`.

Test-ы написаны после кода, не до. Красный прогон проверен потом: новые test-ы на origin/main `bbf82a57f` (временный
worktree) — exit 1, 2 файла упали (нет модуля `sent-lines`, нет канала `changes.targets`).

Решено без владельца, подтвердить:

1. В «To» — Session-ы любого Vendor-а, не только Claude Code: комментарий — простой текст (действия на PR ограничены
   Claude, потому что шлют skill Claude).
2. Без предела в 24 часа на Session-ы в «To».
3. Значение по умолчанию — по Q2 спеки: привязанная Session с самой свежей записью, иначе Orchestrator.
4. Session или Orchestrator без session id держат комментарии под ключом `not-started`; когда Session сообщает id,
   комментарии переезжают на него.
5. Отправленные комментарии тусклые через отдельный store `sent-lines.ts`: `quote-store.ts` не хранит отправленные
   комментарии к коду и по Ticket-у — только для чтения.
6. Send запускает Session, если она не идёт (поле самой Session в этом случае только отказывает).
7. Send шлёт все черновики этой Session, включая комментарии к её сообщениям, — как её собственный Send.
8. «Line changed» — отметка только в памяти; повторная привязка после Refresh — по тексту hunk-ов, не всего файла.
9. `commit` комментария по scope: all / compare — новая сторона = worktree (null), если он есть, иначе head; старая =
   merge-base; uncommitted — новая = null, старая = head; commit — этот sha с обеих сторон.

Проверки (exit code): `pnpm typecheck` — 0; eslint изменённых файлов — 0; unit и contract test-ы
(`changes-tray`, `changes-view`, `changes-targets`, `changes-read`, `quote-comments*`, `quote-store`, `session-view`) —
0, 8 файлов, 245 test-ов; `pnpm test:e2e test/e2e/changes-comments.spec.ts` — 0, 1 passed;
`node scripts/check-feature-docs.mjs` — 0. Полная проверка `pnpm lint && pnpm typecheck && pnpm test` на `8d4712631` —
0 (862 файла test-ов, 19 744 test-а); первый её запуск был красным — `test/unit/link-access.test.ts` требовал решить,
чтение ли новый канал `changes.targets`, исправлено. `gate fast` — 0, `[gate] green (fast)`.

### Доработка, раунд 1 (2026-11-20, по отчёту проверки PR #2049)

- «To» заблокирован, пока Send ждёт запуска Session (`Tray.tsx`): раньше смена «To» в это время переносила черновики к
  другой Session, а `markPending` шёл по старому ключу — комментарии оставались неотправленными в новом лотке и уходили
  повторно. Send запоминает Session и ключ store-а при нажатии и составляет сообщение из store-а после запуска Session
  (`readQuotes`), а не из снимка на момент нажатия. Пока Send идёт, заблокированы ещё поле лотка (readOnly), ×
  и Clear, Edit и Delete под строкой, Save правки уже открытого popover-а.
- «To» держит Session, показанную в нём, как только у неё есть черновики или она приняла Send; значение main по
  умолчанию после Refresh или после Send его больше не сдвигает. Без черновиков и без Send «To» по-прежнему следует Q2.
- Повторная привязка после Refresh (`onFileRead`): `DiffPane` передаёт, для какого scope, Hide whitespace и Refresh
  прочитан файл; комментарии ищутся только в чтениях того вида (scope и Hide whitespace), в котором нажали Refresh, и
  только комментарий на том commit-е, который это чтение показывает на его стороне (worktree — null). Строки, которых
  чтение не показывает, «Line changed» не получают.
- Из «Consider»: popover с несохранённым текстом или картинками не заменяется «+», `c`, Comment и Edit — toast
  «Save or cancel the comment you are writing first»; поле лотка не теряет текст, набранный во время Send (оно
  заблокировано).
- Страница `docs/features/changes.md`: «To» держит Session, блокировки во время Send, Refresh в своём scope, popover.

Test-ы (`test/unit/changes-tray.test.tsx`, +11): блокировки во время Send; удалённый полем Session во время запуска
комментарий не уходит; «To» держит Session с черновиками и после Send, без них следует умолчанию; Refresh двигает
комментарий своего вида, отмечает «Line changed», не трогает его при Hide whitespace, на другом commit-е и на
непоказанных строках; изменённый popover остаётся. Каждое новое поведение проверено мутантом в своём worktree
(16 мутантов, все убиты: test-файл — exit 1).

Решено без владельца, подтвердить:

10. «To» закрепляется за показанной Session, когда у неё появились черновики или она приняла Send, а не сразу при
    первом показе: без черновиков «To» по-прежнему следует умолчанию main (Q2).
11. Повторная привязка только в виде (scope + Hide whitespace), где нажат Refresh, и только для комментария на commit-е
    этого чтения; комментарий из другого scope хранит свои строки, верные на его commit-е. Строки вне hunk-ов этого
    чтения — не повод для «Line changed» (лучше пропустить отметку, чем поставить ложную).
12. Во время Send правка и удаление комментариев заблокированы целиком (а не «досылаются»): сообщение уходит с
    комментариями такими, какими они были.

Проверки раунда 1 (на `229bf46b9`, после rebase на origin/main `ad2169058`): `pnpm lint && pnpm typecheck && pnpm test`
— exit 0 (862 файла test-ов, 19 756 test-ов); `gate fast` — exit 0, `[gate] green (fast)`. e2e
`test/e2e/changes-comments.spec.ts` в этом раунде не запускался.

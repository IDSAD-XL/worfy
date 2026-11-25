# 140 — Аудит повторного review: интерфейс Session, Dialog и rail

Type: bug
Status: done 2026-11-25T11:33Z
PR: #2198
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «Чинить сейчас»; checked open on main 3c9c06e8c 2026-11-25

Кто: агент. Глубина review — `low`. Не платформенный PR.

## Что происходит

Пять finding-ов аудита повторного review (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера ниже), все в
renderer и все ещё в коде на main 3c9c06e8c:

- **70. Метка «not sent» невидима.** `src/renderer/session/session.css:902` красит метку «not sent» очереди в чате
  Product Session token-ом `--danger-text`. Это цвет текста на заливке danger-кнопки
  (`src/renderer/autopilot/autopilot-modal.css:10`, `:16`): белый в светлой теме и `#121110` в тёмной, то есть цвет
  фона чата в обеих. К тому же всё сообщение в очереди приглушено (`.w-pmsg--queued { opacity: 0.55 }`,
  `session.css:891`), и даже красный `--danger` с этой прозрачностью виден с контрастом 2.7–2.9:1. Пользователь не видит,
  что сообщение не ушло.
- **141. Focus теряется при смене kit-окон.** `src/renderer/theme/kit/Dialog.tsx:94-102`: закрывающееся окно всегда
  возвращает focus тому, что его открыло, даже если более новое kit-окно уже взяло focus. Окно, закрытое под другим
  окном, уводит focus из нового окна на элемент страницы за ним. В triage сюда слит finding 142: Command palette —
  тоже kit Dialog (`src/renderer/palette/CommandPalette.tsx:40`, `:499`), и при закрытии она возвращала focus, даже
  когда её команда уже поставила его в другое место (заголовок Getting started).
- **189. Список Queued сам открывается и забирает focus.** `src/renderer/session/composer/Queue.tsx:27-29`: `open` не
  сбрасывается, когда очередь пустеет (ранний `return null`). Следующее сообщение в очереди открывает список само, и
  он забирает focus у поля ввода.
- **187. «Show all» не появляется после замены цитаты.** `src/renderer/session/QuotedPrompt.tsx:108-112`: высота
  цитаты меряется по `[quote, open]`, а показывается `sent?.quote ?? quote`. Когда полная цитата этого окна заменяет
  обрезанную, высота не перемеряется, и кнопки «Show all» нет.
- **133. Точка на rail горит для каждого Ticket в работе.** `src/renderer/shell/sidebar/PipelineSection.tsx:52`
  считает Ticket ждущим при `blocked !== null || waits !== null`. `waits` есть у каждого Ticket в работе (`agent` у
  Stage-й агентов), так что точка горит и когда Ticket ждёт агента. Нужное правило уже есть:
  `waitsForPerson` (`src/shared/ipc/project-pulse.ts:49`).

## Что делаем

1. Метка «not sent» — token `--danger` (красный в обеих темах), не `--danger-text`. Сообщение «not sent» — ошибка,
   его не приглушают: `opacity: 0.55` остаётся только у сообщений, которые ещё ждут в очереди.
2. Kit Dialog возвращает focus открывшему, только если focus потерян: остался в закрывающемся окне, упал на страницу
   (`<body>`). Новое окно или элемент, на который focus поставило действие окна (команда palette), его сохраняют.
3. Queue сбрасывает `open`, когда очередь пуста.
4. QuotedPrompt перемеряет цитату по тому тексту, который показывает (`sent?.quote ?? quote`).
5. PipelineSection считает точку по `waitsForPerson`. Страница `docs/features/workflow.md` — точка горит, когда
   Ticket ждёт человека, не агента. Перевод `docs/features/ru/` не правится (ADR-0088).

## Готово, когда

- [ ] 70: unit test `test/unit/contrast.test.ts` — метка «not sent», как её видит пользователь (цвет из правил
      `session.css`, смешанный с фоном по opacity метки и всех элементов вокруг), читается на `--bg` и `--surface` с
      контрастом не ниже 4.5:1 в обеих темах; сообщение в очереди остаётся приглушённым. Красный на origin/main.
      E2e `test/e2e/product-session.spec.ts` снимает сообщение «queued» и «not sent» в обеих темах.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/contrast.test.ts` exit 0 (120 passed), exit 1 on origin/main source (4 failed: --danger-text contrast 1.0-1.08) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/contrast.test.ts` exit 0 (120 passed); exit 1 with the session.css of 95bac09cc (5 failed: opacity 0.55, contrast 2.7-2.9) · mac - · e860af3116296a492d9bfd90dbaddcf5387943ed
  - evidence: screenshot pass · 4 shots of the message, queued and not sent, light and dark, from the e2e build by test/e2e/product-session.spec.ts (13 passed, exit 0): test-results/e2e/product-session-a-queued-m-*/140-{queued,not-sent}-{light,dark}.png in the PR worktree; the implementer looked at all four, fixture text only · mac dev · e860af3116296a492d9bfd90dbaddcf5387943ed
  - evidence: review pass · PR #2198 · - - · f45d193e2d7bd8a3242b709c10b4cb865859d040
- [ ] 141: unit test `test/unit/kit-dialog.test.tsx` — первое окно, закрытое под вторым, оставляет focus во втором;
      окно, действие которого поставило focus на элемент страницы (finding 142), оставляет его там; окно, закрытое
      одно, возвращает focus открывшему. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/kit-dialog.test.tsx` exit 0 (24 passed), exit 1 on origin/main source (focus went to the opener); mutant without the closing-window check exit 1 (3 failed) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/kit-dialog.test.tsx` exit 0 (25 passed); exit 1 with the Dialog.tsx of origin/main (2 failed: second window, focus moved to the page by an action) · mac - · e860af3116296a492d9bfd90dbaddcf5387943ed
  - evidence: review pass · PR #2198 · - - · f45d193e2d7bd8a3242b709c10b4cb865859d040
- [ ] 189: unit test `test/unit/composer-popovers.test.tsx` — список Queued закрывается, когда очередь пустеет; следующее
      сообщение показывает chip, не список, focus остаётся в поле ввода. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/composer-popovers.test.tsx` exit 0 (7 passed), exit 1 on origin/main source (the list reopened, aria-expanded true) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
  - evidence: review pass · PR #2198 · - - · f45d193e2d7bd8a3242b709c10b4cb865859d040
- [ ] 187: unit test `test/unit/quote-comments-ui.test.tsx` — после замены обрезанной цитаты полной появляется
      «Show all». Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quote-comments-ui.test.tsx` exit 0 (47 passed), exit 1 on origin/main source (no Show all after the whole quote replaced the cut one) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
  - evidence: review pass · PR #2198 · - - · f45d193e2d7bd8a3242b709c10b4cb865859d040
- [ ] 133: unit test `test/unit/pipeline-board.test.tsx` — точка rail считает только Ticket-ы, которые ждут человека;
      `docs/features/workflow.md` говорит то же. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pipeline-board.test.tsx` exit 0 (42 passed), exit 1 on origin/main source (the dot counted 4 Tickets, not 2) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
  - evidence: review pass · PR #2198 · - - · f45d193e2d7bd8a3242b709c10b4cb865859d040
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (914 files, 20690 tests passed) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45594047525/job/139174988366 · ci - · f45d193e2d7bd8a3242b709c10b4cb865859d040

## Где в коде

- `src/renderer/session/session.css:889-910` (приглушённое сообщение в очереди, правило «not sent»)
- `src/renderer/autopilot/autopilot-modal.css:8-18` — только читать (`--danger`, `--danger-text`)
- `src/renderer/theme/kit/Dialog.tsx:86-113` (возврат focus)
- `src/renderer/session/composer/Queue.tsx:25-29`
- `src/renderer/session/QuotedPrompt.tsx:104-130` (`QuoteBlock`)
- `src/renderer/shell/sidebar/PipelineSection.tsx:15-55`
- `src/shared/ipc/project-pulse.ts:46-52` — только читать (`waitsForPerson`)
- `docs/features/workflow.md:338-340`, `docs/features/product-session.md:123-126` («not sent» не приглушено)
- `src/renderer/palette/CommandPalette.tsx:40`, `:499` — только читать (palette открыта в kit Dialog)
- `test/unit/contrast.test.ts`, `test/unit/kit-dialog.test.tsx`, `test/unit/composer-popovers.test.tsx`,
  `test/unit/quote-comments-ui.test.tsx`, `test/unit/pipeline-board.test.tsx`
- `test/e2e/product-session.spec.ts`, `test/fixtures/agent-scripts/product-not-sent.jsonl` (снимки «queued» и «not sent»)

## Вне скоупа

- Своего возврата focus у Command palette нет: она открыта в kit Dialog, и finding 142 закрывает правка `Dialog.tsx`
  (пункт 2). Сама команда «Getting started» не менялась.

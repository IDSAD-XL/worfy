# 140 — Аудит повторного review: интерфейс Session, Dialog и rail

Type: bug
Status: claimed 2026-11-25T08:06Z
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «Чинить сейчас»; checked open on main 3c9c06e8c 2026-11-25

Кто: агент. Глубина review — `low`. Не платформенный PR.

## Что происходит

Пять finding-ов аудита повторного review (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера ниже), все в
renderer и все ещё в коде на main 3c9c06e8c:

- **70. Метка «not sent» невидима.** `src/renderer/session/session.css:902` красит метку «not sent» очереди в чате
  Product Session token-ом `--danger-text`. Это цвет текста на заливке danger-кнопки
  (`src/renderer/autopilot/autopilot-modal.css:10`, `:16`): белый в светлой теме и `#121110` в тёмной, то есть цвет
  фона чата в обеих. Пользователь не видит, что сообщение не ушло.
- **141. Focus теряется при смене kit-окон.** `src/renderer/theme/kit/Dialog.tsx:94-102`: закрывающееся окно всегда
  возвращает focus тому, что его открыло, даже если более новое kit-окно уже взяло focus. Окно, закрытое под другим
  окном, уводит focus из нового окна на элемент страницы за ним.
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

1. Метка «not sent» — token `--danger` (красный в обеих темах), не `--danger-text`.
2. Kit Dialog возвращает focus открывшему, только если focus потерян: остался в закрывающемся окне, упал на страницу
   или стоит на элементе, которого уже нет. Новое окно, взявшее focus, его сохраняет.
3. Queue сбрасывает `open`, когда очередь пуста.
4. QuotedPrompt перемеряет цитату по тому тексту, который показывает (`sent?.quote ?? quote`).
5. PipelineSection считает точку по `waitsForPerson`. Страница `docs/features/workflow.md` — точка горит, когда
   Ticket ждёт человека, не агента. Перевод `docs/features/ru/` не правится (ADR-0088).

## Готово, когда

- [ ] 70: unit test `test/unit/contrast.test.ts` — цвет правила «not sent» в `session.css` читается на `--bg` и
      `--surface` с контрастом не ниже 4.5:1 в обеих темах. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/contrast.test.ts` exit 0 (120 passed), exit 1 on origin/main source (4 failed: --danger-text contrast 1.0-1.08) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
- [ ] 141: unit test `test/unit/kit-dialog.test.tsx` — первое окно, закрытое под вторым, оставляет focus во втором;
      окно, закрытое одно, возвращает focus открывшему. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/kit-dialog.test.tsx` exit 0 (24 passed), exit 1 on origin/main source (focus went to the opener); mutant without the closing-window check exit 1 (3 failed) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
- [ ] 189: unit test `test/unit/composer-popovers.test.tsx` — список Queued закрывается, когда очередь пустеет; следующее
      сообщение показывает chip, не список, focus остаётся в поле ввода. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/composer-popovers.test.tsx` exit 0 (7 passed), exit 1 on origin/main source (the list reopened, aria-expanded true) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
- [ ] 187: unit test `test/unit/quote-comments-ui.test.tsx` — после замены обрезанной цитаты полной появляется
      «Show all». Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quote-comments-ui.test.tsx` exit 0 (47 passed), exit 1 on origin/main source (no Show all after the whole quote replaced the cut one) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
- [ ] 133: unit test `test/unit/pipeline-board.test.tsx` — точка rail считает только Ticket-ы, которые ждут человека;
      `docs/features/workflow.md` говорит то же. Красный на origin/main.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pipeline-board.test.tsx` exit 0 (42 passed), exit 1 on origin/main source (the dot counted 4 Tickets, not 2) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (914 files, 20690 tests passed) · mac - · 749675fe1bbd50c8ee08b68f1edd19ab94fcf39d

## Где в коде

- `src/renderer/session/session.css:902-905` (правило «not sent»)
- `src/renderer/autopilot/autopilot-modal.css:8-18` — только читать (`--danger`, `--danger-text`)
- `src/renderer/theme/kit/Dialog.tsx:86-113` (возврат focus)
- `src/renderer/session/composer/Queue.tsx:25-29`
- `src/renderer/session/QuotedPrompt.tsx:104-130` (`QuoteBlock`)
- `src/renderer/shell/sidebar/PipelineSection.tsx:15-55`
- `src/shared/ipc/project-pulse.ts:46-52` — только читать (`waitsForPerson`)
- `docs/features/workflow.md:338-340`
- `test/unit/contrast.test.ts`, `test/unit/kit-dialog.test.tsx`, `test/unit/composer-popovers.test.tsx`,
  `test/unit/quote-comments-ui.test.tsx`, `test/unit/pipeline-board.test.tsx`

## Вне скоупа

- Finding 142 (Command palette забирает focus у Getting started, `src/renderer/palette/CommandPalette.tsx`): в triage
  слит со 141, но palette — не kit Dialog, её возврат focus свой.
- Прозрачность `.w-pmsg--queued` (0.55) у сообщения «not sent»: правится только цвет метки.

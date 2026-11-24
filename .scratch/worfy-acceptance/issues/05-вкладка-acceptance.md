# 05 — Вкладка Acceptance: две панели, группы, пункт с Evidence вне focus mode, строка Stable copy, Pass и Fail

Type: task
Status: claimed 2026-11-24T02:21Z
Blocked by: 01, 02, 03
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Решение» → «Набросок функции» («Путь владельца», «Экран»); «Решения по
реализации» → «Вид», «Платформа, копия и commit строки»; «Решения по test-ам», Seam 3; «Риски», «Размер 05»; «Вопросы
владельцу», Q6 и «Место в очереди (Q2 раунда)»

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium`; снимки двух панелей в «Итог».

Вне Epic-а: Ticket начинается после merge `worfy-changes-view` 05 (комментарии к строкам в Changes) — решение владельца
2026-11-20, Q2 раунда: оба трогают окно и `src/renderer/shell/`. Поле Blocked by берёт только номера этого Epic-а.

Правило размера (Q7 раунда): если вид выходит больше примерно 600 строк кода, Ticket делится на два — список с группами
и панель пункта; деление записывается в «Итог», второй Ticket заводит Orchestrator.

## Что происходит

- После Ticket-ов 01–03 main отдаёт снимок очереди (`acceptance.get`, `acceptance.changed`) со строкой Stable copy, а
  канал `actions.ownerCheck` отправляет решение. Окна нет.
- Вкладки окна — `ShellView` (`src/renderer/shell/Toolbar.tsx:19`) и `VIEW_NAMES` (`src/renderer/shell/AppShell.tsx:78`);
  у `story` вкладки нет, так что Acceptance — шестая вкладка после Pull requests.
- Две панели и ↑ ↓ — образец Pull requests (`src/renderer/pr-inbox/PrInboxView.tsx`, `usePrInbox.ts`, `open.ts`,
  `docs/features/pr-inbox.md`, «Selecting»).
- Evidence пункта рисует `EvidenceMatrix` (`src/renderer/canvas/nodes/EvidenceMatrix.tsx`), превью —
  `EvidencePreview` (`src/renderer/canvas/nodes/EvidencePreview.tsx`); снимки и клипы отдаёт `worfy-image://`
  (`src/main/images/protocol.ts`). Сегодня они видны только в focus mode.

## Что делаем

1. `src/renderer/acceptance/AcceptanceView.tsx`, `useAcceptance.ts`, `open.ts`, `acceptance.css` (новые): вкладка
   «Acceptance» с числом Ready to check, tooltip «Checks that wait for you»; вкладка активна и без открытого Project-а.
2. Левая панель: группы spec-а со счётом, In work и Older свёрнуты; ↑ ↓ — как в Pull requests, новых сочетаний клавиш нет.
3. Правая панель: Project, Epic, Ticket, номер пункта; текст пункта через `src/renderer/markdown/Markdown.tsx`; `needs:`;
   строка Stable copy с Update worfy; Evidence пункта (матрица одного пункта, превью снимков и клип с contact sheet);
   «Prepared by the Orchestrator» — неручные пункты Ticket-а с состоянием; Open Ticket, Open PR.
4. Строка решения: поле комментария (обязательно для Fail; в Project-е с Full mode — подпись, что слова попадут в
   репозиторий), «Checked in: <платформа> · <копия> · <версия>» с выбором, Pass и Fail. Пока идёт Autopilot — кнопки
   неактивны с причиной (Q6 (а)). После отправки — «Sent · waits for the line» и следующий пункт; «Not recorded yet» и
   Send again через 24 часа.
5. Waits for you: `Blocked reason:`, Open Ticket и Open Orchestrator, без Pass и Fail.
6. Английская страница `docs/features/acceptance.md`: раздел о виде.

## Готово, когда

- [ ] Unit test (`test/unit/acceptance-view.test.tsx`, новый): группы и счёт, Fail без комментария неактивен, при
      Autopilot кнопки неактивны с причиной, Waits for you без Pass и Fail, «Sent» и «Not recorded yet». Красный до
      правки — в «Итог».
  - evidence: test-run pass · `pnpm exec vitest run test/unit/acceptance-view.test.tsx` exit 0 · mac - · 6588d01b3
- [ ] e2e test (`test/e2e/acceptance.spec.ts`, новый, fake agent): пункт со снимком и клипом из
      `test/fixtures/evidence-clip/`; Pass → текст в очереди fake Orchestrator-а; test дописывает строку `owner-check` в
      Ticket-файл → пункт уходит; ↑ ↓ выбирают пункты.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/acceptance.spec.ts` exit 0 · mac dev · 6588d01b3
- [ ] e2e test: снимки двух панелей при 1280 и 1600 px в обеих темах, как `test/e2e/pr-inbox.spec.ts` (в «Итог», в
      репозиторий не кладутся).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/acceptance.spec.ts` exit 0 (snapshots acceptance-1280 and acceptance-1600, both themes) · mac dev · 6588d01b3
- [ ] Английская страница `docs/features/acceptance.md` описывает вид; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 6588d01b3
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0; `gate fast` exit 0 · mac - · 6588d01b3

## Где в коде

- `src/renderer/acceptance/AcceptanceView.tsx`, `useAcceptance.ts`, `open.ts`, `acceptance.css` (новые)
- `src/renderer/shell/Toolbar.tsx` (`ShellView`), `src/renderer/shell/AppShell.tsx` (`VIEW_NAMES`, монтирование вида)
- `src/renderer/canvas/nodes/EvidenceMatrix.tsx`, `src/renderer/canvas/nodes/EvidencePreview.tsx` (вид одного пункта,
  если нужен)
- `test/unit/acceptance-view.test.tsx`, `test/e2e/acceptance.spec.ts` (новые)
- `docs/features/acceptance.md`

Только читать: `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/usePrInbox.ts`,
`src/main/images/protocol.ts`, `src/renderer/markdown/Markdown.tsx`, `test/e2e/pr-inbox.spec.ts`.

## Вне скоупа

- Секция боковой панели, бейдж rail-а, палитра и уведомление — Ticket 06. Окно Linked machine — Ticket 07.
- Комментарий к области снимка; снимки Stable copy из вида (spec, «Не в этом Epic-е»).

## Итог

- Вкладка Acceptance — шестая в `ShellView` (`src/renderer/shell/Toolbar.tsx`), со счётом Ready to check и tooltip
  «Checks that wait for you», активна без Project-а; вид смонтирован в `src/renderer/shell/AppShell.tsx`. Код вида —
  `src/renderer/acceptance/` (`AcceptanceView.tsx`, `useAcceptance.ts`, `open.ts`, `acceptance.css`): 463 строки
  TypeScript без комментариев и пустых строк, меньше порога ~600 — Ticket не делится.
- Красный до правки: `pnpm exec vitest run test/unit/acceptance-view.test.tsx` на коде без `src/renderer/acceptance/` и
  без правки вкладок — exit 1 («Failed to resolve import "../../src/renderer/acceptance/AcceptanceView"»). После правки
  — 17 test-ов, exit 0. Mutation testing: 12 мутантов, по одному на поведение (Fail без комментария, Autopilot, `itemText`,
  кнопки во время отправки, «Sent», In work свёрнута, Update worfy, счёт вкладки, ↑ ↓, следующий пункт после Pass, отказ
  main, `Blocked reason:`), все убиты.
- Снимки двух панелей (e2e `test/e2e/acceptance.spec.ts`, в репозиторий не кладутся):
  `test-results/worfy-acceptance-05-screens/acceptance-1280-light.png`, `acceptance-1280-dark.png`,
  `acceptance-1600-light.png`, `acceptance-1600-dark.png`.
- Решено без владельца:
  - счёт на вкладке стоит после подписи: обёртка иконки — `display: contents`, примитив `SegmentedControl` не меняется;
  - пустые группы в списке не показываются, как в Pull requests;
  - метка ручного пункта в начале текста (`(manual)`) в виде не показывается — строка «Item N · manual» говорит это сама;
    `itemText` уходит в main как есть, с меткой;
  - строка пункта — «Item N» без «of M»: в снимке очереди нет числа ручных пунктов Ticket-а;
  - commit копии (`sha`) известен, только когда окно — сама Stable copy, копия `stable` и платформа этой Machine; тогда
    рядом показана её версия; иначе `-`;
  - «Not recorded yet» снова делает Pass и Fail активными; Send again шлёт тот же вердикт с текущим комментарием (Fail —
    только с комментарием);
  - Open Ticket — карточка Ticket-а на Canvas его Project-а (Project выбирается сначала); Open Orchestrator — вид Session
    Orchestrator-а;
  - окно Linked machine с Read only: Pass и Fail неактивны с причиной `useReadOnly` (остальное — Ticket 07).
- Вне следа: `OWNER_CHECK_AUTOPILOT_HINT` переехал в `src/shared/actions/render-template.ts` (renderer не импортирует
  `src/main`), `src/main/actions/launch.ts` его реэкспортирует; списки вкладок в `test/unit/pr-inbox-view.test.tsx` и
  `test/unit/toolbar-runs.test.tsx` дополнены «Acceptance».

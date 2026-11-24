# 05 — Вкладка Acceptance: две панели, группы, пункт с Evidence вне focus mode, строка Stable copy, Pass и Fail

Type: task
Status: done 2026-11-24T06:05Z
PR: #2166
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
  - evidence: test-run pass · `pnpm exec vitest run test/unit/acceptance-view.test.tsx` exit 0 · mac - · 58c96fa3a
  - evidence: review pass · PR #2166 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e test (`test/e2e/acceptance.spec.ts`, новый, fake agent): пункт со снимком и клипом из
      `test/fixtures/evidence-clip/`; Pass → текст в очереди fake Orchestrator-а; test дописывает строку `owner-check` в
      Ticket-файл → пункт уходит; ↑ ↓ выбирают пункты.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/acceptance.spec.ts` exit 0 · mac dev · 58c96fa3a
  - evidence: review pass · PR #2166 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e test: снимки двух панелей при 1280 и 1600 px в обеих темах, как `test/e2e/pr-inbox.spec.ts` (в «Итог», в
      репозиторий не кладутся).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/acceptance.spec.ts` exit 0 (snapshots acceptance-1280, acceptance-1600 and acceptance-sent, both themes) · mac dev · 58c96fa3a
  - evidence: review pass · PR #2166 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Английская страница `docs/features/acceptance.md` описывает вид; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 58c96fa3a
  - evidence: review pass · PR #2166 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0; `gate fast` exit 0 · mac - · bcf9d49d5
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45334303688/job/138253916213 · ci - · 335193573cfd4d733db0d458a0be0910c416b28d

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
  - строка пункта — «Item N of M», M — пункты с флажком Ticket-а из модели его Project-а (ревью, раунд 1);
  - текст пункта в строке списка, в матрице Evidence и в «Prepared by the Orchestrator» — простой текст: без разметки
    Markdown и без метки `(manual)`; панель пункта рисует его через `Markdown.tsx`;
  - `sha` решения — commit Stable copy, который называет снимок очереди (`stableCommit`, тот же источник, что строка
    Stable copy в main: свой commit запуска, иначе файл рядом с копией), когда окно — этой Machine, копия `stable` и
    платформа этой Machine; иначе `-` (в окне Linked machine тоже `-`, ревью, раунд 2). Рядом показана версия, когда окно — сама Stable copy, иначе короткий commit (ревью, раунд 1);
  - Evidence пункта — `EvidenceMatrix` и `EvidencePreview` (полоса contact sheet и клип в `<video>`), а не кнопки
    `[light] [dark] [▶ clip]` наброска: текст Ticket-а («Что происходит», «Что делаем», 3) и spec-а («Вид») называет
    именно эти компоненты, кнопки есть только на рисунке;
  - «Not recorded yet» снова делает Pass и Fail активными; Send again шлёт тот же вердикт с текущим комментарием (Fail —
    только с комментарием);
  - Open Ticket — карточка Ticket-а на Canvas его Project-а (Project выбирается сначала); Open Orchestrator — вид Session
    Orchestrator-а;
  - окно Linked machine с Read only: Pass и Fail неактивны с причиной `useReadOnly` (остальное — Ticket 07).
- Вне следа: `OWNER_CHECK_AUTOPILOT_HINT` переехал в `src/shared/actions/render-template.ts` (renderer не импортирует
  `src/main`), `src/main/actions/launch.ts` его реэкспортирует; списки вкладок в `test/unit/pr-inbox-view.test.tsx` и
  `test/unit/toolbar-runs.test.tsx` дополнены «Acceptance». Ревью, раунд 1: снимок очереди получил поле `stableCommit`
  (`src/shared/ipc/acceptance.ts`, `src/main/acceptance/stable-line.ts`, `src/main/acceptance/service.ts`,
  `src/main/ipc/acceptance.ts`, проверка в `test/contract/acceptance-stable-copy.test.ts`).
- Ревью, раунд 1 (9 замечаний): модель Project-а открыта одна на вид и только пока вид показан (↑ ↓ не переоткрывают её,
  скрытый вид не держит fetch); `sha` из `stableCommit`; фокус клавиатуры идёт за выбором; счёт вкладки без Sent;
  «Item N of M»; простой текст пункта; test на двойной `sendDecision`. Каждое — test в `describe('review round 1')`
  `test/unit/acceptance-view.test.tsx` и contract test `stableCommit`; шесть из них красные до правки, test двойного
  `sendDecision` зелёный и до правки (защита уже была) и убивает мутанта без неё. Mutation testing: 9 мутантов, 8 убиты;
  выжил `pane-keyed` (ключ на панели пункта) — эквивалентный: модель теперь живёт в `AcceptanceView`, ключ панели её не
  переоткрывает. e2e указывает `WORFY_UPDATE_STABLE` на пустую папку: `sha` решения там `-`, какая бы Stable copy ни стояла
  на машине. Строка evidence пункта 5 не заявляет `ci-ok` — его пишет land.
- Ревью, раунд 2 (3 замечания): окно Linked machine шлёт `sha` `-` (его `stableCommit` — той Machine); пункт «Not
  recorded yet» снова в счёте вкладки; неактивная primary-кнопка (`src/renderer/theme/button.css`, вне следа, по
  замечанию ревью) теряет заливку и тень — прозрачный фон, рамка, приглушённый текст, как неактивная кнопка действия
  F-SPEC; в тёмной теме приглушённая заливка читалась как активный Pass. Test-ы: «a window on a Linked machine sends
  sha "-"…», «the tab counts an item in "Not recorded yet"…» (`test/unit/acceptance-view.test.tsx`), «an inactive
  primary drops its fill and its shadow…» (`test/unit/button.test.tsx`); все три красные до правки. 4 мутанта — все
  убиты. e2e снимает ещё Sent-пункт с неактивными Pass и Fail: `acceptance-sent-light.png`, `acceptance-sent-dark.png`.
- CI PR #2166 (run 45328133350), красные e2e на macOS и Windows:
  - `flight-recorder.spec.ts:408`, `pipeline.spec.ts:115` и `:180`, `pr-inbox.spec.ts:226` перечисляли пять вкладок
    View switch: новая шестая вкладка Acceptance — законное изменение, test-ы дописаны (`pipeline.spec.ts:180` ещё
    принимает tooltip вкладки «Checks that wait for you»);
  - `two-windows.spec.ts:130` (Windows) — поломка продукта: счёт вкладки подписывает каждое окно на `acceptance.get`,
    и это одиннадцатый `ClientHolders` со своим слушателем `destroyed` на webContents окна; Node печатал
    `MaxListenersExceededWarning`. Теперь все `ClientHolders` одного клиента делят один слушатель
    (`src/main/clients.ts`, вне следа); test `test/unit/client-holders.test.ts` (новый) красный до правки.

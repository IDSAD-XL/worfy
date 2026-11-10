# 03 — Вид «Pull requests», раздел sidebar, Command palette, переключатель в Project settings, термин PR inbox

Type: task
Status: claimed 2026-11-10T01:26Z
Blocked by: 02
Source: [spec.md](../spec.md), «Что видит пользователь», п. 1–3; «Как работает» → «Вид и sidebar (Ticket 03; Q1, Q7)»;
«Ticket-ы», «Волны» (Wave 2); решения Q1, Q7, Q10;
[критика](../../../docs/product/critic/worfy-pr-inbox-2026-11-09.md), возражение 1

Платформенный Ticket: нет (renderer). Глубина ревью — `medium`.

Вид показывает снимок из Ticket-а 02 (`prInbox.get`, `prInbox.changed`). Этот Ticket владеет и входом «открыть вид на
одном PR»: им пользуются badge Ticket-а 06 и уведомления и сводка Ticket-а 07 (критика, возражение 1).

## Что происходит

- `src/renderer/shell/Toolbar.tsx:17` — `ShellView` = `'canvas' | 'session' | 'pipeline' | 'history'`;
  `src/renderer/shell/AppShell.tsx:66` — `VIEW_NAMES`.
- Разделы sidebar собираются по файлам `src/renderer/shell/sidebar/*Section.tsx` (`Sidebar.tsx:8`); образец —
  `PipelineSection.tsx`.
- Command palette — группа `View` в `src/renderer/palette/commands.ts:82`.
- Образец входа «открыть вид Project-а» — `openPipelineOf` (`src/renderer/pipeline/open.ts:12`): сразу для активного
  Project-а, после выбора — для другого.

## Что делаем

1. `ShellView` получает `'pull-requests'`, `VIEW_NAMES` — `Pull requests` (Q7); кнопка в toolbar.
2. `src/renderer/pr-inbox/PrInboxView.tsx` и `usePrInbox.ts`: группы Needs my review, Needs my answer, Needs a fix,
   Ready, Waiting on others; строка — заголовок, `repo#N`, chip Ticket-а (если PR — Ticket-а), точка CI, решение
   ревью, число нерешённых нитей, «N new since you looked», возраст; «via team» у запроса через команду.
3. Строка раскрывается: нити с последними комментариями, ссылка на строку кода на GitHub. Открытие строки и
   «Mark seen» вызывают `prInbox.markSeen`.
4. Строка состояния: время следующего поиска, причина ошибки чтения, если есть, и `notice` снимка, если он не
   `null` (его заполняет триггер уведомлений Ticket-а 08, например «GitHub notifications unavailable for this token —
   checking every 5 minutes»). Вид не знает, откуда `notice`.
5. `src/renderer/shell/sidebar/PullRequestsSection.tsx` — счётчики групп; щелчок открывает вид на группе.
6. Command palette: «Pull requests» в группе `View`.
7. Вход `openPrInboxOf(projectId, activeId, pr?)` в `src/renderer/pr-inbox/open.ts` по образцу `openPipelineOf`:
   без `pr` — вид Project-а; с `pr` (`{repo, number}`) — вид с раскрытой строкой этого PR, прокрученной в поле зрения;
   PR нет в снимке — вид открыт и пишет «This pull request is not in the inbox». Ответ — почему вид не открылся.
8. Project settings (`src/renderer/shell/ProjectSettings.tsx`): переключатель «Read pull requests from GitHub» —
   поле `prInbox` (Q10); на Linked machine с Read only неактивен.
9. `CONTEXT.md`, раздел Workflow — термин **PR inbox** (Q7): вид «Pull requests» Project-а — открытые PR пользователя и
   запросы ревью у него по репозиториям Project-а, нити ревью и черновики ответов; ничего не публикует без щелчка
   Send. `_Avoid_`: inbox (без PR), входящие, dashboard.
10. Feature page `docs/features/pr-inbox.md` (новая, английская, ADR-0088); строка в `docs/features/README.md`; виды в
   `docs/features/app-shell.md`.

## Готово, когда

- [ ] Unit test: снимок из fixture-а — пять групп в порядке spec-а, строки со всеми полями, «via team».
- [ ] Unit test: строка состояния — время следующего поиска, строка ошибки, `notice` из снимка.
- [ ] E2e test: toolbar → Pull requests открывает вид; sidebar показывает счётчики; Command palette открывает вид.
- [ ] Unit test: `openPrInboxOf` с PR — вид открыт, строка этого PR раскрыта; PR нет в снимке — строка «This pull
      request is not in the inbox»; другой Project — сначала выбор Project-а.
- [ ] E2e test: `openPrInboxOf` с PR из другого Project-а окна открывает его вид на этом PR.
- [ ] E2e test: раскрытие строки показывает нити; «N new since you looked» гаснет после открытия.
- [ ] E2e test: переключатель Project settings выключает чтение — журнал stub-а gh пуст после выключения.
- [ ] E2e test: с открытым видом и раскрытой нитью журнал stub-а gh не содержит ни одной записи.
- [ ] `CONTEXT.md` — термин PR inbox; `docs/features/pr-inbox.md` описывает вид.
- [ ] Снимок вида на fixture-проекте в `.scratch/worfy-pr-inbox/evidence/03-pull-requests-view.png` (выдуманные
      данные).
- [ ] Владелец в Mac Stable открыл вид на командном проекте: группы и счётчики совпадают с GitHub.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Unit `test/unit/pr-inbox-view.test.tsx`, `test/unit/pr-inbox-open.test.ts` (новые); e2e `test/e2e/pr-inbox.spec.ts` (новый).
- Сначала падающий: на `main` в toolbar нет вида Pull requests.
- Ни настоящего GitHub, ни модели: e2e идёт со stub-ом gh (`WORFY_GH`, `test/e2e/launch-env.ts`); fixture-ы —
  выдуманные владельцы, репозитории, login-ы и тексты.
- Без щелчка Send на GitHub не уходит ничего: e2e проверяет журнал stub-а после всех действий вида.

## Где в коде

- `src/renderer/shell/Toolbar.tsx`
- `src/renderer/shell/AppShell.tsx`
- `src/renderer/shell/sidebar/PullRequestsSection.tsx` (новый)
- `src/renderer/pr-inbox/PrInboxView.tsx` (новый)
- `src/renderer/pr-inbox/usePrInbox.ts` (новый)
- `src/renderer/pr-inbox/pr-inbox.css` (новый)
- `src/renderer/pr-inbox/open.ts` (новый)
- `src/renderer/palette/commands.ts`
- `src/renderer/shell/ProjectSettings.tsx`
- `CONTEXT.md`
- `docs/features/pr-inbox.md` (новый), `docs/features/README.md`, `docs/features/app-shell.md`
- `test/unit/pr-inbox-view.test.tsx` (новый)
- `test/unit/pr-inbox-open.test.ts` (новый)
- `test/e2e/pr-inbox.spec.ts` (новый)

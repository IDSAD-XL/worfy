# worfy-pr-inbox: PR inbox — открытые PR Project-а, нити ревью и черновики ответов

Status: принят владельцем 2026-11-10 (принят Orchestrator-ом под карт-бланш владельца 2026-11-09); ответы Q1–Q10 подтверждены владельцем 2026-11-10 (они —
в разделе «Решения Orchestrator-а под карт-бланш владельца»)
Critic: [docs/product/critic/worfy-pr-inbox-2026-11-09.md](../../docs/product/critic/worfy-pr-inbox-2026-11-09.md) — Reorder; все три возражения и альтернатива приняты Orchestrator-ом 2026-11-09, ответ — раздел «Ответ на критику»
Source: вопрос владельца 2026-11-09: где добавить сводку открытых PR, слежение за комментариями в них и черновики
ответов — «это сильно упростит работу в командных проектах»; исследование Orchestrator-а того же дня (файл вне
репозитория; строки сверены с `main` `1c651328e`);
[ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy — вид над workflow);
[ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md) (собственное состояние worfy);
[ADR-0042](../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) (Silent mode);
[ADR-0102](../../docs/adr/0102-private-project-skills-in-profile-folder.md) (частные skill-ы в папке Profile-а);
[ADR-0104](../../docs/adr/0104-one-ticket-several-repositories.md) (один Ticket — несколько репозиториев);
[ADR-0105](../../docs/adr/0105-pr-reply-only-on-the-users-click.md) (принят Orchestrator-ом под карт-бланш владельца 2026-11-09); spec
[worfy-human-review](../worfy-human-review/spec.md) (Team reviewer, решения 8 и 9).
Ticket-ы: Epic `worfy-pr-inbox`, 8 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` /
`Source:`. Ticket-ы — `issues/01`–`issues/08`.

## Цель

В командном проекте в Silent mode работу пользователя ждут люди: ревью чужих PR, ответы в нитях ревью на его PR,
правки по замечаниям. Сегодня worfy этого не показывает:

1. **PR tracker видит только ветки Ticket-ов.** `src/main/github/prs.ts` читает `gh pr list` по Project-у, а
   `src/main/ipc/checks.ts:5-7` ограничивает его ветками `<epic>/<NN>` и ветками из строк `Branch:`. PR коллеги и
   собственный PR пользователя, открытый вне worfy, не видны никогда.
2. **Нити ревью не читаются вовсе.** `FIELDS` (`prs.ts:47`) — без `reviewThreads`, без `isResolved`, без
   `mergeStateStatus`. Комментарии читаются только ради строк `NARROW:` Autopilot-а (`narrowRoundsOf`, `prs.ts:276`).
3. **Pipeline знает, *что* Ticket ждёт людей, но не *что* они спросили.** Стадия `human-review` проходит только по
   `reviewDecision === 'APPROVED'` (`src/shared/workflow/pipeline.ts:248-249`).
4. **Ответить можно только руками на GitHub** или попросив Session «запости это» — тогда шаг публикации держит модель.

После Epic-а у Project-а есть вид «Pull requests»: все открытые PR пользователя и запросы ревью у него по
репозиториям Project-а, сгруппированные по тому, чей ход. Нити ревью видны в worfy; черновики ответов пишет Session
Claude Code с доступом к коду; пользователь правит черновик и сам жмёт Send. Ничего не уходит на GitHub без его
щелчка.

## Для какого Project-а

Главный пользователь — командный проект в Silent mode: три частных репозитория, в одном из них тысячи PR
(`.scratch/worfy-human-review/issues/14-review-history-504-на-большом-репозитории.md:7-8`), ревьюят люди, вливают
люди (`workflow.merge: null`), одна рабочая папка (`parallel: single`). В самом worfy людей-ревьюеров нет (0 ревью в
последних 100 PR, `.scratch/worfy-human-review/spec.md:40`): вид там почти пуст, и это нормально.

## Что видит пользователь

1. В toolbar пятый вид — **Pull requests** (рядом с Canvas, Session, Pipeline, Run history). В sidebar — раздел
   Pull requests со счётчиками групп. Command palette открывает вид.
2. Вид — список по группам: **Needs my review**, **Needs my answer**, **Needs a fix**, **Ready**, **Waiting on
   others**. Строка: заголовок, `repo#N`, chip Ticket-а (если PR — Ticket-а), точка CI, решение ревью, число
   нерешённых нитей, «N new since you looked», возраст.
3. Строка раскрывается: нити ревью с последними комментариями, ссылка на строку кода на GitHub.
4. Кнопка **Draft replies** на PR открывает новую Session Claude Code с `/worfy:pr-reply <repo>#N`. Session читает
   diff и код, пишет черновики ответов в файлы на этой машине и ничего не публикует.
5. Под нитью — черновик в поле для правки и три кнопки: **Send**, **Discard**, **Ask the Session to rewrite**.
   **Send all** открывает диалог со всеми текстами. Send публикует ровно текст из поля — один раз, от аккаунта
   Project-а.
6. На Ticket Node, чей PR ждёт ответов, — badge «3 open threads» или «changes requested»; на карточке Pipeline в
   `human-review` — строка «Waits: 2 answers».
7. Новый запрос ревью или ответ на PR пользователя без фокуса окна — уведомление ОС, одно на PR и событие. Первый
   фокус окна за день — одно action toast с утренней сводкой.

## Как работает

### Чтение в main (Ticket 02; Q3, Q10)

- **Кто и откуда.** Main процесс, по Project-у, с аккаунтом Project-а: `readGithubAccount`
  (`src/main/workflow/profile.ts:670`) → `accountAuth` (`src/main/github/prs.ts:171`) → `GH_TOKEN` только в окружении
  дочернего gh. Глобальный аккаунт gh не переключается. Все вызовы gh — через `ghRunner` (`prs.ts:117`), который
  берёт `WORFY_GH`: test-ы подставляют stub (`test/fixtures/gh/gh-stub.mjs`).
- **Какие репозитории** (Q3): только репозитории Project-а — `layout.repos` (`src/main/ipc/checks.ts:135-136`), для
  Project-а из одного репозитория — его `origin`. Чужие репозитории того же аккаунта не читаются.
- **Поиск** — два GraphQL `search(type: ISSUE)` на Project раз в 5 минут, одна страница, только
  `number, updatedAt, headRefOid`:
  - `is:pr is:open archived:false repo:o/r1 repo:o/r2 review-requested:@me`;
  - `is:pr is:open archived:false repo:o/r1 repo:o/r2 involves:@me`.
- **Детали** — отдельный GraphQL-запрос только для PR, чей `updatedAt` сдвинулся, по 10 PR: `title, url, isDraft,
  author, headRefName, headRefOid, reviewDecision, mergeable, mergeStateStatus, statusCheckRollup { state },
  reviewRequests(first:10), latestOpinionatedReviews(first:10), reviewThreads(first:50) { id isResolved isOutdated path
  line viewerCanReply comments(last:3) { id databaseId author{login} body createdAt url } }, comments(last:5)`. Без
  `diffHunk` и `files`: на большом репозитории крупные страницы падали по 504. Повтор на 502/503/504 и деление
  страницы пополам — как в `harness/bin/review-history` (Ticket 14 Epic-а `worfy-human-review`).
- **Темп.** Поиск раз в 5 минут — этого достаточно для рабочего вида (критика, возражение 3). Ошибка — интервал
  удваивается до 30 минут, первый успех возвращает базовый (как `src/main/github/gate-queue.ts:25-26`). Меньше 10 %
  rate limit (`rateLimit { remaining resetAt }`) — пауза до `resetAt`. Кэш — по аккаунту: два Project-а одного
  аккаунта не читают один PR дважды. Вход `refresh(repo, number)` читает детали одного PR вне очереди — его зовёт
  триггер уведомлений (Ticket 08).
- **Linked machine.** Читает только Machine Project-а. Linked machine получает снимок через канал `project` с доступом
  `read`.
- **Группы** считает main, детерминированно:
  1. Needs my review — запрос ревью у меня (лично или через команду; строка помечает «via team»), или запрос снова
     после моего ревью. Сначала старые.
  2. Needs my answer — мой PR, нерешённая нить, последний комментарий не мой; упоминания.
  3. Needs a fix — мой PR: CI красный, `CHANGES_REQUESTED` или конфликт (`mergeStateStatus: DIRTY`).
  4. Ready — одобрен, зелёный, без конфликта. В командном проекте вливают люди: группа значит «напомнить тому, кто
     вливает».
  5. Waiting on others — мой PR, моего хода нет; возраст с последней активности.
- **Seen-state** — `<Project data folder>/pr-inbox.json` (рядом с `settings.json`,
  `src/main/projects/settings.ts:1-6`): по PR `seenAt`, `seenHeadOid`, id последнего увиденного комментария; курсор
  `Last-Modified` уведомлений (Ticket 08). Ни одного текста коллег. Тексты нитей main держит только в памяти.
- **Включено по умолчанию** (Q10) для каждого Project-а с remote на GitHub. Выключатель — поле `prInbox` в
  `settings.json` Project-а (`false` — не читать); переключатель — в окне Project settings.

### Триггер уведомлений (Ticket 08; Q4)

- REST `GET /notifications?participating=true` с `If-Modified-Since`, через `gh api -i`: строка статуса и заголовки
  `Last-Modified` и `X-Poll-Interval` читаются из вывода. Темп — без фокуса окна раз в 5 минут, с фокусом или открытым
  видом — `X-Poll-Interval` (обычно 60 с).
- **304 — «без перемен», не сбой.** gh на 304 печатает `gh: HTTP 304` и выходит с кодом 1 (критика, возражение 2).
  Триггер читает это как «ничего не изменилось»: без ошибки, без удвоения интервала, без чтения деталей. Ответ 304 не
  тратит rate limit. Stub gh в test-ах повторяет настоящий exit 1.
- 200 — уведомления о PR репозиториев Project-а; каждый такой PR — `refresh(repo, number)` у читателя Ticket-а 02.
- Только чтение: worfy никогда не помечает уведомление прочитанным (`PATCH`) — это inbox самого пользователя на сайте
  GitHub. Токен без scope `notifications`/`repo` (fine-grained PAT, GitHub App) получает 403: триггер выключается, вид
  пишет «GitHub notifications unavailable for this token — checking every 5 minutes» (поле `notice` снимка), поиск
  идёт как был.

### Вид и sidebar (Ticket 03; Q1, Q7)

- `ShellView` (`src/renderer/shell/Toolbar.tsx:17`) получает `'pull-requests'`; `VIEW_NAMES`
  (`src/renderer/shell/AppShell.tsx:66`) — `Pull requests`. Раздел sidebar — по образцу
  `src/renderer/shell/sidebar/PipelineSection.tsx`.
- PR без Ticket-а — полноправные строки вида. Canvas ради них не меняется.
- «Mark seen» сбрасывает «N new since you looked»; открытие строки — тоже.
- Вход «открыть вид на одном PR» (`openPrInboxOf`) — тоже Ticket 03: им пользуются badge Ticket-а 06 и уведомления
  Ticket-а 07 (критика, возражение 1).
- Термин в `CONTEXT.md` — **PR inbox** (раздел Workflow), подпись в UI — «Pull requests» (Q7). Feature page —
  `docs/features/pr-inbox.md`.

### Связь с Ticket-ом (Ticket 06)

- PR → Ticket по паре (repo, N) из `repoFactsOf().prs` (`src/shared/workflow/types.ts:95`), до номера PR — по паре
  (repo, branch). Ticket с несколькими репозиториями показывает свои PR вместе (ADR-0104, пункт 3: PR друг о друге не
  говорят, связь — только в worfy).
- Badge — новый файл `src/renderer/canvas/badges/ReviewThreads.tsx`: слот badge-ей добавляется файлом, файлы Node-ов
  не меняются (`src/renderer/canvas/badges/index.ts:1-12`). Щелчок открывает вид на этом PR.
- Карточка Pipeline в `human-review` — строка «Waits: N answers». Файлы — те же, что правит Ticket 06 Epic-а
  `worfy-multi-repo-ticket` (Pipeline board и Ticket Node с несколькими PR): этот Ticket идёт после него.

### Черновики ответов (Ticket 04; Q8)

- **Draft replies** — новая Session Node, всегда Claude Code и с человеком, никогда не Autopilot. Первое сообщение —
  action template `prReply` (по умолчанию `/worfy:pr-reply {repo}#{pr}`), запуск — как «Ship ticket»
  (`src/main/actions/launch.ts:10-17`, шаблоны `src/shared/projects/action-templates.ts`).
- Skill `/worfy:pr-reply`:
  1. `gh pr view`, diff и нерешённые нити (GraphQL), только чтение;
  2. по каждой нити — метка (needs code change / needs answer / FYI / resolved by push), проверка утверждения по коду
     на head PR (`git show <sha>:<path>`; в `parallel: single` ветку не переключает), черновик ответа;
  3. голос — примеры Team reviewer-а, если есть `state/human-review/`; иначе язык команды Profile-а
     (`language.team`);
  4. `review-draft-lint --reply` — следы workflow, подпись ИИ, личные данные, длина;
  5. пишет `<Profile folder>/state/pr-inbox/drafts/<owner>-<repo>-<N>.json`.
- **Skill не публикует ничего.** Его текст это запрещает; guard (Ticket 01) проверяет на следы workflow любую
  запись `gh api` в PR.
- **Черновики — только на этой машине** (Q8), в папке Profile-а, вне истории git Harness home
  (`harness/bin/project-connect:108-118`: `/projects/*/state/` в `.gitignore`). Никогда не GitHub pending review.
- Формат файла черновика:

```json
{
  "schema": 1,
  "repo": "example-org/app",
  "pr": 118,
  "headOid": "0123abc…",
  "items": [
    { "kind": "thread", "threadId": "PRRT_…", "replyTo": 4211, "label": "needs answer",
      "body": "…", "fixPlan": null, "state": "draft", "sentUrl": null }
  ]
}
```

  `kind: "conversation"` — ответ в разговоре PR, без `threadId` и `replyTo`. `state` — `draft`, `sent`, `discarded`.

### Send по щелчку (Ticket 05; Q2, ADR-0105)

- Send — IPC `prInbox.send` (канал `local`: с Linked machine недоступен ни при каком уровне доступа).
- Main перечитывает черновик, берёт текст **ровно как в поле** и снова запускает `review-draft-lint --reply`.
  Находка — не публикует, показывает строку находки, черновик остаётся.
- Main публикует этот текст один раз, от аккаунта Project-а:
  - ответ в нити — `POST /repos/{o}/{r}/pulls/{n}/comments/{comment_id}/replies` (только на верхний комментарий
    нити);
  - ответ в разговоре PR — `POST /repos/{o}/{r}/issues/{n}/comments`.
- Потом пишет в файл черновика `state: "sent"` и `sentUrl`. Автоматического повтора нет: ошибка сети — черновик
  остаётся `draft` с причиной; перед повторным Send main перечитывает нить и, если этот текст от этого аккаунта уже
  там, только отмечает `sent`.
- **Send all** — диалог со всеми текстами (как диалог `worfy.ask`, `docs/features/cards.md:174-180`), потом по одному
  POST подряд: предел GitHub на создание контента — 80 в минуту.
- Больше main не пишет на GitHub ничего: ни resolve, ни re-request review, ни отправку review, ни pending review, ни
  «прочитано», ни push.

### Guard на `gh api` (Ticket 01)

`harness/hooks/guard.mjs` проверяет на следы workflow тексты `gh pr create|edit|comment|review|merge`
(`guard.mjs:230-237`, `ghCommand` :540-552), а `gh api` не проверяет вовсе. Поэтому отправка Team reviewer-а
(`gh api --method POST "repos/<owner>/<repo>/pulls/<n>/reviews" --input …`,
`harness/skills/human-review-setup/template/SKILL.template.md:150`) и ответ `…/comments/{id}/replies` проходят без
проверки. Ticket 01 добавляет записи `gh api` в PR и issue (`POST`/`PATCH`/`PUT`, а также неявный `POST` gh при
`-f`/`-F`/`--input`) и мутации GraphQL с текстом комментария или ревью.

### Уведомления и утренняя сводка (Ticket 07; Q6)

- `PrInboxNotices` в `src/main/notify.ts` по образцу `GateQueueNotices` (`notify.ts:38-40`, :518): новый запрос ревью
  у меня, новый ответ на мой PR — одно уведомление на PR и событие, только без фокуса окна.
- Утренняя сводка — первый фокус окна за день: одно action toast (`docs/features/notifications.md:47-51`),
  например «3 reviews wait for you (oldest 2 days) · 2 PRs have new comments · 1 ready to merge», кнопка Open. Модель
  не нужна.
- Два переключателя в Settings, оба включены по умолчанию.

## Что остаётся как есть

- PR tracker Ticket-ов (`prs.ts`, badge-и PR и CI) — без изменений; PR inbox — отдельный читатель.
- Team reviewer (`/human-review`) публикует свой review, как сегодня, после «да» в разговоре; guard теперь проверяет
  его текст (Ticket 01).
- Linked machine с Read only видит снимок PR inbox и ничего не меняет (`docs/features/link.md:197`).
- Одно окно приложения (ADR-0090): вид — внутри окна, не отдельное окно ОС.
- worfy не пишет в репозитории Project-ов (ADR-0005).

## Решено без владельца, подтверждено владельцем 2026-11-10

- Тексты нитей main держит только в памяти; на диск (`pr-inbox.json`) идут id, sha и время. После рестарта тексты
  читаются снова.
- Needs my review берёт `review-requested:@me` (лично и через команду); строка запроса только через команду помечена
  «via team».
- Автоматического повтора Send нет; повтор — новый щелчок, и перед ним main проверяет, не опубликован ли текст.
- Draft replies — только Claude Code, как «Ship ticket» (skill-ы Harness идут под Claude Code).
- Ticket 06 ждёт Ticket 06 Epic-а `worfy-multi-repo-ticket`: общие файлы Ticket Node и Pipeline board.
- Feature page — только английская (ADR-0088); перевод `docs/features/ru/pr-inbox.md` — по правилам Epic-а feature
  docs.

## Ticket-ы

| Ticket | Что | Глубина ревью | Платформенный | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | Guard: записи `gh api` в PR и issue и мутации GraphQL проверяются на следы workflow | `high` | да | — |
| 02 | Чтение PR inbox в main: поиск раз в 5 минут, детали, темп, кэш по аккаунту, группы, seen-state, выключатель Project-а | `high` | нет | — |
| 03 | Вид «Pull requests», вход «открыть вид на одном PR», раздел sidebar, Command palette, переключатель в Project settings, термин PR inbox, feature page | `medium` | нет | 02 |
| 04 | Skill `/worfy:pr-reply`, формат черновика, `review-draft-lint --reply`, action template `prReply` и запуск Session | `high` | да | 01, 02 |
| 05 | Редактор черновика и Send по щелчку: main перепроверяет и публикует ровно показанный текст (ADR-0105) | `max` | нет | 02, 03, 04 |
| 06 | Badge нитей на Ticket Node и строка «Waits: N answers» на карточке Pipeline | `medium` | нет | 02, 03, `worfy-multi-repo-ticket` 06 |
| 07 | Уведомления ОС и утренняя сводка; переключатели в Settings | `medium` | нет | 02, 03 |
| 08 | Триггер уведомлений GitHub: `gh api -i`, 304 (gh exit 1) — «без перемен», 403 — только поиск | `high` | нет | 02 |

Платформенный Ticket — скрипт Harness, hook или путь ОС: PR ждёт Windows verdict до merge (ADR-0056).

## Волны

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/hooks/guard.mjs`, `harness/hooks/tests/guard-silent.test.sh` | 1 |
| 02 | `src/main/github/inbox.ts` (новый), `src/shared/ipc/pr-inbox.ts` (новый), `src/main/ipc/pr-inbox.ts` (новый), `src/main/index.ts`, `src/main/projects/pr-inbox-state.ts` (новый), `src/shared/projects/action-templates.ts` (поле `prInbox`), `test/contract/pr-inbox.test.ts` (новый), `test/unit/pr-inbox-groups.test.ts` (новый), `test/fixtures/gh/gh-stub.mjs` | 1 |
| 03 | `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/sidebar/PullRequestsSection.tsx` (новый), `src/renderer/pr-inbox/PrInboxView.tsx` (новый), `src/renderer/pr-inbox/usePrInbox.ts` (новый), `src/renderer/pr-inbox/pr-inbox.css` (новый), `src/renderer/pr-inbox/open.ts` (новый), `src/renderer/palette/commands.ts`, `src/renderer/shell/ProjectSettings.tsx`, `CONTEXT.md`, `docs/features/pr-inbox.md` (новый), `docs/features/README.md`, `docs/features/app-shell.md`, `test/unit/pr-inbox-view.test.tsx` (новый), `test/unit/pr-inbox-open.test.ts` (новый), `test/e2e/pr-inbox.spec.ts` (новый), `.scratch/worfy-pr-inbox/evidence/03-*` | 2 |
| 04 | `harness/skills/pr-reply/SKILL.md` (новый), `harness/bin/review-draft-lint`, `src/shared/projects/action-templates.ts`, `src/shared/ipc/actions.ts`, `src/main/actions/launch.ts`, `test/contract/harness-review-draft-lint.test.ts`, `test/contract/actions.test.ts`, `harness/evals/pr-reply-*` (новые) | 2 |
| 08 | `src/main/github/inbox-notifications.ts` (новый), `src/main/github/inbox.ts`, `src/main/projects/pr-inbox-state.ts`, `test/fixtures/gh/gh-stub.mjs`, `test/contract/pr-inbox-notifications.test.ts` (новый), `docs/features/gate-and-github.md` | 2 |
| 05 | `src/renderer/pr-inbox/DraftThread.tsx` (новый), `src/renderer/pr-inbox/PrInboxView.tsx`, `src/shared/ipc/pr-inbox.ts`, `src/main/ipc/pr-inbox.ts`, `src/main/github/pr-reply-send.ts` (новый), `docs/features/pr-inbox.md`, `test/contract/pr-inbox-send.test.ts` (новый), `test/unit/draft-thread.test.tsx` (новый), `test/e2e/pr-inbox.spec.ts` | 3 |
| 06 | `src/renderer/canvas/badges/ReviewThreads.tsx` (новый), `src/renderer/pipeline/board.ts`, `src/renderer/pipeline/PipelineBoard.tsx`, `test/unit/review-threads-badge.test.tsx` (новый), `test/unit/pipeline-board.test.tsx`, `test/e2e/checks-badges.spec.ts`, `docs/features/gate-and-github.md` | 3 |
| 07 | `src/main/notify.ts`, `src/main/index.ts`, `src/shared/settings/app-settings.ts`, `src/renderer/settings/PullRequestsSection.tsx` (новый), `src/renderer/toast/ToastRegion.tsx`, `docs/features/notifications.md`, `test/unit/pr-inbox-notices.test.ts` (новый), `test/e2e/pr-inbox-digest.spec.ts` (новый) | 4 |

- **Wave 1 — 01, 02.** Общих файлов нет. Guard и читатель друг от друга не зависят.
- **Wave 2 — 03, 04, 08.** Все три ждут читатель из 02. 04 правит `action-templates.ts`, как 02, поэтому
  `Blocked by: 01, 02`. Общих файлов между 03, 04 и 08 нет: кнопка Draft replies — в Ticket-е 05; строку триггера вид
  показывает через поле `notice` снимка, которое 02 заводит, а 08 заполняет. После Wave 2 вид работает на поиске раз
  в 5 минут; триггер только ускоряет его.
- **Wave 3 — 05, 06.** 05 ждёт вид из 03 и формат черновика из 04. 06 читает `usePrInbox.ts` из 03 и не правит его;
  правит `docs/features/gate-and-github.md` после 08; идёт, когда влит Ticket 06 Epic-а `worfy-multi-repo-ticket`,
  иначе — в следующую Wave.
- **Wave 4 — 07.** Последний, по решению Q6; `Blocked by: 02, 03` — ему нужен вид и вход «открыть вид на одном PR»
  из 03; общий с 02 файл `src/main/index.ts`.

Имена новых файлов — предложение; implementer сверяет их с `main`.

## Не в этом Epic-е

- **Разбор комментариев Haiku** (needs code change / needs answer / FYI / resolved by push) по пути Live summary
  (`src/main/vendors/claude/narrator.ts:1-14`). Решение Q5 его разрешает и задаёт форму — переключатель в Settings,
  включён по умолчанию; Ticket — следующим шагом после MVP. В Epic-е — только детерминированные группы.
- **Fix** — передача плана правки implementer-у на ветке PR (Q9: push всегда отдельный щелчок). Подпись кнопки — не
  «Fix»: этим словом в `CONTEXT.md` уже назван шаг Terminal AI.
- Resolve thread и Re-request review — отдельными щелчками, позже.
- «What changed since my review» и Draft review через Team reviewer.
- Напоминание о застрявшем PR, «Make a Ticket from this comment», блок нитей в rail Session, поле `prs` в снимке
  Card, метрики Work track, свои разделы строкой поиска.

## Риски

- **Rate limit.** Один токен служит PR tracker-у, Flight Recorder-у, Work track, `review-history` и Session-ам.
  Закрывают: уведомления с бесплатным 304 (Ticket 08), кэш по аккаунту, пауза ниже 10 %, малые страницы без `diffHunk`, поиск не
  чаще раза в 5 минут. Оценка для командного проекта — меньше 1 % часового бюджета REST и GraphQL.
- **Следы в Silent mode.** Ответ не несёт номеров Ticket-ов и ADR, имён Epic-ов, путей Workflow folder и подписи ИИ.
  Lint идёт дважды: в Session и в main над правленым текстом. Слова коллег — только в памяти main и в папке Profile-а
  на этой машине, никогда в репозитории worfy, его test-ах и evidence. Fixture-ы — выдуманные владельцы,
  репозитории и login-ы.
- **Публикация по ошибке.** Main публикует только по Send; Send all — с диалогом; канал `local`; guard проверяет
  `gh api` (Ticket 01). Session `/worfy:pr-reply` стартует, как «Ship ticket», в `bypassPermissions`
  (`src/main/actions/launch.ts:10-11`) и технически может вызвать `gh api` сама. Её текст это запрещает, guard
  ловит следы, но чистый текст пройдёт: это сила самого агента, и по правилу соразмерности защиты она описана, а не
  закрыта (ADR-0105, «Последствия»).
- **Scope токена.** Уведомлениям нужен classic token или OAuth со scope `notifications` или `repo`; логин gh имеет
  `repo`. Fine-grained PAT — 403 и только поиск. Организация с SAML SSO требует авторизовать токен для неё. Публикации
  у fine-grained нужен «Pull requests: write»; без него Send показывает причину GitHub, черновик остаётся.
- **Общие файлы с `worfy-multi-repo-ticket`.** Ticket 06 правит Ticket Node и Pipeline board после Ticket-а 06 того
  Epic-а.

## Ответ на критику

Критика: [docs/product/critic/worfy-pr-inbox-2026-11-09.md](../../docs/product/critic/worfy-pr-inbox-2026-11-09.md),
verdict Reorder. Orchestrator 2026-11-09 принял все три возражения и альтернативу критика.

1. **`Blocked by:` не говорили о зависимостях из таблицы Волн.** Принято. Ticket 07 — `Blocked by: 02, 03` (ему нужен
   вид), Ticket 04 — `Blocked by: 01, 02` (общий с 02 файл `action-templates.ts`). Вход «открыть вид на одном PR»,
   которым пользуются 06 и 07, перешёл в Ticket 03.
2. **gh выходит с кодом 1 на 304.** Принято. Ticket 08 читает ответ через `gh api -i`; `gh: HTTP 304` с exit 1 —
   «без перемен», а не сбой, без удвоения интервала; stub gh повторяет настоящий exit 1, и test проверяет, что 304 не
   читает деталей и не удваивает интервал.
3. **Триггер уведомлений в самом большом Ticket-е.** Принято. Триггер вынесен из 02 в новый Ticket 08
   (`Blocked by: 02`, Wave 2 рядом с 03 и 04). Ticket 02 работает на одном поиске раз в 5 минут; вид после Wave 2
   рабочий без триггера.

## Решения Orchestrator-а под карт-бланш владельца 2026-11-09

Каждый ответ — рекомендация исследования; решено Orchestrator-ом под карт-бланш владельца 2026-11-09, подтверждено
владельцем 2026-11-10 («По всем вопросам — да»).

- **Q1 — где живёт.** Пятый вид «Pull requests» и раздел sidebar со счётчиками; badge нитей ревью на Ticket Node. Не
  Node Canvas, не Card, не панель Product Session, не отдельное окно.
- **Q2 — кто публикует.** Main, ровно показанный текст, только по щелчку пользователя; модель не публикует никогда.
- **Q3 — какие PR.** Только репозитории Project-а.
- **Q4 — API уведомлений.** Только чтение, никогда не помечать прочитанным; для fine-grained токена — только поиск.
- **Q5 — Haiku.** Разбор комментариев коллег Haiku — за переключателем в Settings, включённым по умолчанию (Ticket —
  после MVP, раздел «Не в этом Epic-е»).
- **Q6 — уведомления и сводка.** В Epic-е: уведомления ОС и утренняя сводка — Ticket 07, последняя Wave.
- **Q7 — имя.** Подпись в UI «Pull requests», термин `CONTEXT.md` — «PR inbox».
- **Q8 — где черновики.** Только на этой машине, в папке Profile-а (`state/pr-inbox/`); никогда не pending review на
  GitHub.
- **Q9 — Fix и push.** Fix (после MVP) никогда не делает push сам; push — отдельный щелчок.
- **Q10 — по умолчанию.** Включено для каждого Project-а с remote на GitHub; выключатель в Project settings.

## Готово, когда

- [x] Orchestrator принял spec и ADR-0105 под карт-бланш владельца 2026-11-09, после критики (Reorder).
- [x] Владелец подтвердил решения Q1–Q10, spec и ADR-0105; строка `Status:` — `принят владельцем 2026-11-10`. Ответ владельца 2026-11-10 «По всем вопросам — да» на вопросы об ответах Q1–Q10 и о решениях без владельца.
- [x] Заведены Ticket-ы 01–08 с разделами «Где в коде» из таблицы Волн.
- [ ] Ни один test Epic-а не ходит на настоящий GitHub и к настоящей модели: только stub-ы.
- [ ] Test-ы Ticket-ов 02, 05, 07 и 08 проверяют, что без щелчка Send на GitHub не уходит ни одна запись.

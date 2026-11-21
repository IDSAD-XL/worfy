# 11 — Finish review и `pr-review-submit.ts`: диалог с каждым комментарием ровно, lint, проверка head, один POST ревью по Submit человека, новый ADR

Type: task
Status: claimed 2026-11-20T23:02Z
Blocked by: 10
Source: [spec.md](../spec.md), «Ticket-ы», 11; «Решение», 4 и 6; «Как пользователь идёт по экрану», A (шаги 7–8), C и E
(шаг 4); «Факты GitHub API» → «Отправка ревью»; «Решения по реализации», 7, 10 и 13; «Риски», «Новая запись на GitHub»,
«Agent review одобряет чужой код»; «Вопросы владельцу», Q2 и Q7 раунда

Кто: агент.

Платформенный Ticket: правка `harness/bin/review-draft-lint` (обычный режим без `lint.json`) — платформенный PR
(ADR-0056), вердикт Windows — job-ы Windows в CI. Глубина ревью — `max` (решение владельца 2026-11-20, Q2 (а) и Q7
раунда): новая запись main на GitHub, одобрение влияет на merge чужого кода.

## Что происходит

- ADR-0105, пункт 4: main пишет на GitHub только две записи — ответ в нити и комментарий в разговоре PR; отправки
  review нет (`docs/adr/0105-pr-reply-only-on-the-users-click.md:31-34`). Решение владельца 2026-11-20, Q2 (а): Submit
  review из worfy — локальный черновик и один запрос из диалога, который показывает каждый комментарий ровно; новый ADR.
- Образец порядка «показать → lint → отметка → один POST» — Send ответа (`src/main/github/pr-reply-send.ts`, `:15-17`,
  `:372`).
- `review-draft-lint` без `--rules` работает только в режиме `--reply` (`harness/bin/review-draft-lint:264`, `:271`).
- После Ticket-а 10 полоса Your review держит неактивную кнопку Finish review. Черновик может быть написан агентом
  (Ticket 08): в нём есть `suggestedEvent` и комментарии `by: 'agent'`.
- Не проверено: что делает POST, если у пользователя висит pending review, начатый на github.com (раздел «Факты»).

## Что делаем

1. Диалог Finish review (Dialog kit-а) по прототипу Ticket-а 01: Summary, переключатель Comment / Approve / Request
   changes — всегда начинается с Comment; при `suggestedEvent` — строка «The agent suggests: …»; список «N comments will
   be posted on <sha>» с `path:line` и текстом каждого, у комментариев агента без правки — «by the agent» и Remove;
   строка lint-а; Submit review и Cancel. Approve и Request changes неактивны на своём PR; Request changes и Comment без
   Summary и без комментариев неактивны. Диалог держит тексты, с которыми открылся. Submit — не кнопка по умолчанию для
   Enter (щелчок или ⌘↵).
2. `src/main/github/pr-review-submit.ts` (новый): перечитать файл и взять ровно показанные тексты →
   `review-draft-lint` над `payload` → перечитать head PR (сдвинулся — диалог говорит «Your comments are on <a>; the
   head is <b>» и Submit on <a>) → `state: 'submitting'` → один `POST /repos/{o}/{r}/pulls/{n}/reviews` с `commit_id =
   startedOn`, `event`, `body`, `comments` — тело ровно как `payload` → `submitted` и `reviewUrl`, `refresh` PR inbox и
   строки результата.
3. Сбой — черновик остаётся с «GitHub did not confirm the review: <reason>»; без автоматического повтора. Новый Submit
   после сбоя или `submitting` сначала читает `GET …/pulls/{n}/reviews` и ищет отзыв этого аккаунта на том же
   `commit_id` с тем же `body`; нашёл — только отмечает `submitted`.
4. Никогда: запрос без `event` (pending review на GitHub), второй POST по одному щелчку, resolve, re-request review,
   dismiss, merge. Profile без `github.account` — Submit отказывает, как Send.
5. `harness/bin/review-draft-lint`: обычный режим без `--rules` берёт длины шаблона, как `--reply`.
6. Канал `prReview.submit` — `'local'`. Ошибки раздела 10 spec-а (нет «Pull requests: write», свой PR, PR закрыт,
   pending review с github.com) — причиной GitHub в диалоге, черновик остаётся.
7. Новый ADR «worfy отправляет ревью PR только по Submit пользователя» (номер — следующий свободный в `docs/adr/`);
   Amendment-ы ADR-0105 (пункт 4 — третья запись) и ADR-0002 (исключение «main пишет»).
8. Проверка на тестовом репозитории (sandbox): pending review с github.com + Submit из worfy — что ответил GitHub, в
   «Итог».

## Готово, когда

- [x] Contract `test/contract/pr-review-submit.test.ts` (новый) на gh stand-in: lint-находка — ни одного POST; head
      сдвинулся — комментарии на `startedOn`; ровно один POST с телом байт в байт как показанный `payload`; свой PR;
      сбой и повтор без второго POST; `submitting` после обрыва; stand-in валит test на любой записи, кроме одного
      POST Submit-а, и на POST без щелчка. Красный до правки — в «Итог».
  - evidence: test-run pass · `pnpm test test/contract/pr-review-submit.test.ts` exit 0 · mac - · 3b8895cb2db0f0d9459d35823b6b649729977a5c
- [x] Тот же contract: черновик Agent review — `event` в POST тот, что выбрал человек, а не `suggestedEvent`;
      убранный в диалоге комментарий агента в POST не попал.
  - evidence: test-run pass · `pnpm test test/contract/pr-review-submit.test.ts` exit 0 · mac - · 3b8895cb2db0f0d9459d35823b6b649729977a5c
- [x] Unit `test/unit/finish-review-dialog.test.tsx` (новый): переключатель начинается с Comment; «The agent suggests»;
      неактивные события на своём PR и без текста; Enter не отправляет.
  - evidence: test-run pass · `pnpm test test/unit/finish-review-dialog.test.tsx` exit 0 · mac - · 3b8895cb2db0f0d9459d35823b6b649729977a5c
- [x] `test/contract/harness-review-draft-lint.test.ts`: обычный режим без `--rules`.
  - evidence: test-run pass · `pnpm test test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · 3b8895cb2db0f0d9459d35823b6b649729977a5c
- [x] e2e `test/e2e/pr-review.spec.ts`: полный путь A (поиск → Review myself → комментарий → Submit → stand-in получил
      один POST) и C (head сдвинулся); путь E (Agent review → правка → Submit); chip `1/2` → `2/2`.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/pr-inbox.spec.ts` exit 0 · mac dev · 3b8895cb2db0f0d9459d35823b6b649729977a5c
- [x] Новый ADR и Amendment-ы ADR-0105 и ADR-0002 влиты в этом PR.
  - evidence: commit pass · worfy-pr-review/11: ADR-0112, Amendments of ADR-0105 and ADR-0002, feature page, ticket result · - - · 3b8895cb2db0f0d9459d35823b6b649729977a5c
- [ ] Ревью ступени `max` (skill `worfy:max-review`) — вердикт в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные
      (платформенный PR).

## Где в коде

- `src/main/github/pr-review-submit.ts` (новый)
- `src/renderer/pr-review/FinishReviewDialog.tsx` (новый), `src/renderer/pr-review/ReviewBar.tsx` (Ticket 10)
- `src/shared/ipc/pr-review.ts`, `src/main/ipc/pr-review.ts`
- `harness/bin/review-draft-lint`
- `docs/adr/0111-…` (новый; номер — следующий свободный), `docs/adr/0105-pr-reply-only-on-the-users-click.md`,
  `docs/adr/0002-worfy-is-a-view-over-the-workflow.md`
- `test/contract/pr-review-submit.test.ts` (новый), `test/unit/finish-review-dialog.test.tsx` (новый),
  `test/contract/harness-review-draft-lint.test.ts`, `test/e2e/pr-review.spec.ts`

Только читать: `src/main/github/pr-reply-send.ts`, `test/contract/pr-inbox-send.test.ts` (образец «ни одной записи без
щелчка»), `src/main/github/pr-review-draft.ts`.

Образец вида — Card `card-53b21f06` («Prototype: PR search and review», Ticket 01), состояния `finish`,
`finish-agent`, `submitted`. Состояние открывается сразу по `#state=<name>&theme=dark`.

## Вне скоупа

- Pending review на GitHub и продолжение ревью, начатого на github.com; resolve нитей, re-request review, dismiss,
  merge — вне Epic-а (ADR-0105 в силе).

## Итог

Сделано implementer-ом 2026-11-21, ветка `worfy-pr-review/11`, от `main` 01e70ebc0. ADR-0112.

- Диалог Finish review — `src/renderer/pr-review/FinishReviewDialog.tsx` (новый, kit Dialog): Summary; Comment /
  Approve / Request changes (radio group, всегда начинается с Comment); «The agent suggests: … — you choose»; «N
  comments will be posted on <sha>, exactly as below» — `path:line` и текст каждого, у неправленого комментария агента
  «by the agent», Remove у каждого; строка lint-а (канал `prReview.check`, 400 ms после последней правки); Submit review
  и Cancel. Submit — щелчок или ⌘↵, Enter на кнопке не отправляет. Approve и Request changes неактивны на своём PR
  (`viewer` из PR inbox), Comment и Request changes — без Summary и без комментариев. Открывается кнопкой Finish
  review полосы и ⌘⇧↵.
- `src/main/github/pr-review-submit.ts` (новый, `PrReviewSubmitter`): перечитать черновик и взять ровно показанные
  тексты → `review-draft-lint` → `GET repos/{o}/{r}/pulls/{n}` (head, base, автор) → проверка каждого комментария по
  diff-у GitHub его commit-а → `submitting` → один `POST …/reviews` через `--input` с
  `{commit_id, event, body, comments}` → `submitted`, `reviewUrl`, в файле только ушедшие комментарии. Канал
  `prReview.submit` — `local`. После `submitted` PR inbox читает PR сразу (`PrInbox.refresh`): chip одобрений.
- Полоса (`ReviewBar.tsx`): Finish review активна; «Submitting did not finish»; причина сбоя; после отправки «You
  reviewed this pull request · Approve», Open the review on GitHub, Start a new review. Комментарии отправленного
  черновика — «Submitted · on GitHub» (`DraftComment.tsx`).
- `harness/bin/review-draft-lint`: обычный режим без `--rules` — длины шаблона (`lint.json` skill-а
  human-review-setup), каждому тексту наибольший `max_chars`; `--rules <lint.json> --untiered` — так же по своему
  файлу (раунд 2; `--rules` без tier-ов и без флага по-прежнему exit 2).
- Документы: ADR-0112 (новый); Amendment-ы ADR-0105 (пункт 4 — третья запись) и ADR-0002; Amendment в spec.md
  (поток решения 7, шаг 3: `commit_id = anchoredOn ?? startedOn`); `docs/features/pr-inbox.md` — Finish review and
  Submit, How it works, Implementation, Tests.

Test-ы, красный до правки → зелёный:
- `test/contract/harness-review-draft-lint.test.ts`: на старом скрипте 2 failed / 60 passed, exit 1 → зелёный.
- `test/contract/pr-review-submit.test.ts` (новый, 19 test-ов, gh stand-in `test/fixtures/gh/gh-stub.mjs` с
  `reviews.json`): до модуля — exit 1 (импорт не найден) → exit 0. Случай «PR inbox читает PR после Submit» добавлен
  позже: 1 failed / 18 passed, exit 1 → 19 passed, exit 0.
- `test/unit/finish-review-dialog.test.tsx` (новый, 12): exit 1 (импорт) → 12 passed, exit 0.
- `test/unit/review-comments.test.tsx`: «Submitted · on GitHub» у отправленного — 1 failed / 26 passed, exit 1 → exit 0.
- e2e `test/e2e/pr-review.spec.ts` целиком, под `/tmp/worfy-e2e.lock`: первый прогон — путь E красный (chip PR из inbox
  оставался `0/1`: inbox не перечитывал PR после Submit), exit 1 → после правки 7 passed, exit 0. Новые test-ы: путь A
  (поиск → Review myself → комментарий → диалог → Enter ничего не шлёт → щелчок → один POST байт в байт, chip `1/2` →
  `2/2`, полоса «You reviewed…»), путь C (head сдвинулся: «Your comments are on 0041a1c; the head is c0ffee0.», Submit
  on 0041a1c, POST на 0041a1c), путь E (агент советует Request changes, человек правит один комментарий, убирает
  другой, выбирает Approve — в POST его событие и один комментарий). Снимки обеих тем в
  `test-results/worfy-pr-review-09-screens/` (`finish-1280`, `finish-moved-1280`, `finish-agent-1280`,
  `submitted-pane-1280`, `submitted-bar-1280`), в репозиторий не кладутся. Вместе с `test/e2e/pr-inbox.spec.ts` (тот
  же gh stand-in и `review-draft-lint --reply`) — 18 passed, exit 0. Spec-и, которые таблица `scripts/e2e-specs.table.json`
  даёт на `harness/bin/`, — 85 passed, 1 skipped (`packaged.spec.ts`), exit 0. Остальные пути ветки вне таблицы: CI
  гоняет весь набор.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (882 файла, 20203 test-а).
- Mutation testing `pr-review-submit.ts`: 15 mutant-ов (commit_id = startedOn, без look-first, без проверки своего
  PR, head, строк вне diff-а, агента пишущего, 4xx как неподтверждённый, без lint-а, без проверки пустого ревью, без
  очереди, без аккаунта, тексты не по файлу, диапазон через hunk-и, look-first без state и без commit) — все убиты.

Отличия от прототипа (Card `card-53b21f06`, состояния `finish`, `finish-agent`, `submitted`):
- Комментарий не на изменённой строке прототип отправлял без него и помечал «Not posted»; здесь он останавливает весь
  Submit, пока его не уберут или не перенесут (GitHub отверг бы ревью целиком).
- После отправки Review mode закрывается с toast; «You reviewed this pull request · Approve», ссылка на ревью и Start
  a new review — на полосе Review mode при следующем открытии, а не строкой next step в панели PR, как в прототипе.
- В toast нет хвоста «The chip now reads 2/2»: chip обновляется сам, когда PR перечитан.
- Полоса сдвинутого head не называет комментарии на строках, которые новый head изменил (поток C.3 spec-а, «GitHub will
  likely show it as outdated: <path:line>») — не сделано.

Решено без владельца:
- `commit_id = anchoredOn ?? startedOn`, а не `startedOn` (spec.md:528): по брифу Orchestrator-а; Amendment в spec и
  ADR-0112, пункт 5.
- Какие строки изменены — по diff-у GitHub на commit-е комментариев: `pulls/{n}/files`, когда commit — head, иначе
  `compare/{base}...{commit}`.
- 4xx (кроме 408) — «GitHub refused the review: <сообщение GitHub>», ревью нет; 5xx, обрыв, timeout gh — «GitHub did
  not confirm the review», следующий Submit сначала читает до 30 страниц `…/reviews` и ищет ревью по ушедшим текстам
  (как именно — раунд 2 ниже).
- Head сдвинулся с открытия диалога — первый Submit отказывает без записи, диалог показывает оба commit-а, второй
  щелчок «Submit on <a>» отправляет.
- Remove в диалоге убирает комментарий только из этого Submit-а; в файле `submitted` остаются только ушедшие.
- Summary, набранный и не отправленный, держится в памяти окна, пока worfy работает; в файл черновика не пишется.
- Start a new review удаляет файл отправленного черновика и начинает новый на head PR.
- `review-draft-lint` без `--rules` — наибольший `max_chars` шаблона каждому тексту (у черновика человека нет tier-ов).
- PR inbox перечитывает PR сразу после `submitted` (`PrInbox.refresh`), а не ждёт своего цикла.
- Вне списка файлов Ticket-а: `PrReviewDrafts.changeNow` в `src/main/github/pr-review-draft.ts` (в Ticket-е «только
  читать»: отметка `submitting` без отложенной записи); `viewer` в `src/renderer/pr-inbox/PrInboxView.tsx`;
  флаг `submitted` в `src/renderer/pr-review/DraftComment.tsx` и `review-comments.tsx`; `test/fixtures/gh/gh-stub.mjs`
  (`reviews.json`, `posted-reviews.json`, отправленное ревью в `latestOpinionatedReviews`).

### Раунд 2 (ревью PR #2122)

Ветка перенесена на `main` 7d511a51b. Находки ревью `max` и что сделано:
- A (high): Submit, который GitHub не подтвердил (5xx, timeout), открывал диалог на Comment с правимыми текстами, а
  поиск сверял state нового выбора — ушедший Approve не находился, уходило второе ревью. Теперь черновик с «GitHub did
  not confirm the review» заперт, как `submitting` (`submitPending` в `src/shared/ipc/pr-review.ts`): диалог открывается
  на ушедших событии, Summary и комментариях без правки; Review mode не правит, не удаляет и не добавляет; Discard, Ask
  и Take over скрыты или неактивны; main отказывает Submit-у других текстов.
- Поиск идёт первым — до проверок head, lint-а и diff-а; сверяет ушедший `payload`, state не сверяет.
- B (med): поиск сужен. Отметка `submitting` хранит `submittingAt`; берётся ревью этого аккаунта на том же commit-е, с
  тем же body, данное не раньше отметки минус 2 минуты, и с теми же комментариями к строкам
  (`GET …/reviews/{id}/comments`, путь и текст каждого, как мультимножество). ADR-0112, пункт 6, обновлён.
- C (med): ответ 4xx возвращает черновику комментарии и anchors, какими они были до отметки; 5xx оставляет ушедшие.
- D (med): `review-draft-lint --rules` без tier-ов снова exit 2, как в `main`; Submit передаёт новый флаг `--untiered`
  (`submitLintArgs`).
- Low: отсутствующий anchor при отметке — теперь ошибка, а не `anchors.push(undefined)`.

Test-ы, красный до правки → зелёный:
- `test/contract/pr-review-submit.test.ts`: 5 новых или изменённых — 5 failed / 18 passed, exit 1 → 23 passed, exit 0;
  затем test `lint.json` Profile-а с `--untiered` — 24 passed, exit 0.
- `test/contract/harness-review-draft-lint.test.ts`: `--rules` без tier-ов — отказ, `--untiered` — 1 failed / 61
  passed, exit 1 → 62 passed, exit 0.
- `test/unit/finish-review-dialog.test.tsx`, `test/unit/review-comments.test.tsx`: запертый неподтверждённый черновик —
  2 failed / 39 passed, exit 1 → exit 0.
- Mutation testing, 13 mutant-ов — все убиты: запирает только `submitting` (main, диалог, Review mode, полоса), без
  поиска первым, черновик не освобождается после «не нашёл», без фильтра по времени, без сверки комментариев, отметка
  без времени, 4xx не возвращает комментарии и оставляет время, `--untiered` игнорируется, Submit без `--untiered`.
- Test-ы модуля (13 файлов) — 280 passed, exit 0; `plugin-neutral`, `harness-home`, `agents-text` — exit 0.
- e2e `pr-review.spec.ts` + `pr-inbox.spec.ts` под `/tmp/worfy-e2e.lock` — 18 passed, exit 0; spec-и таблицы для
  `harness/bin/` — 53 passed и 31 passed + 1 skipped, exit 0 (`packaged.spec.ts` прогнан после commit-а: он требует
  чистый `harness/` в git).

Решено без владельца (раунд 2):
- Допуск часов — 2 минуты до отметки: часы машины и GitHub расходятся.
- Комментарии сверяются по пути и тексту: строки GitHub может вернуть `null` для устаревших.
- Отдельный флаг `--untiered`, а не запуск без `--rules`: запреты `lint.json` Profile-а остаются.
- «Не нашёл» освобождает черновик (снова обычный, без `submittingAt`), и Submit идёт как новый. Заменено в раунде 3.

### Раунд 3 (ревью PR #2122, последний)

Вердикт ревьюера — MERGE. Три находки low касались правила «никогда второго ревью»; исправлены:
- «Не нашёл» сразу снимал отметку, до lint-а и проверки head. GitHub может показать ревью в списке с опозданием (POST
  упал по timeout 30 s или 502, а ревью создано): немедленный Submit не нашёл бы его и отправил второе. Теперь в
  первые 5 минут после отметки «не нашёл» — отказ «GitHub did not confirm the review, and it has not listed it yet —
  try again in a minute», отметка остаётся. Позже — те же тексты идут через lint, head, diff и один POST; старую
  отметку заменяет только `markSubmitting` этого POST, так что отказ lint-а или head-а оставляет тексты запертыми.
- Запрет правки держал только renderer. Теперь main тоже отказывает: `putComment` и `removeComment`
  (`src/main/github/pr-review-draft.ts`, `textsEditable`) и запуск Agent review (`src/main/github/pr-review-agent.ts`) —
  с текстом `TEXTS_LOCKED`.
- Черновик, чей поиск падает каждый раз (403/404: доступ потерян, репозиторий удалён), застревал: Submit отказывал, а
  Discard, Take over и Ask были выключены. Теперь Discard такого черновика доступен и спрашивает «Discard this
  review?» с предупреждением, что ревью может уже быть на GitHub. Main удаляет и `submitting` старше 5 минут (worfy
  закрылся во время POST); моложе — нет, его POST может ещё идти.
- ADR-0112, пункт 6, обновлён; в ADR-0005 дописана строка Amendment о поле `submittingAt`.

Test-ы, красный до правки → зелёный: `pr-review-submit` (2 изменённых test-а и 1 с относительным временем), новые в
`pr-review-draft` (2), `pr-review-agent` (1), `review-comments` (1) — 7 failed / 88 passed, exit 1 → 95 passed, exit 0.
Mutation testing, 10 mutant-ов — все убиты: нет ожидания списка; отметка снимается до lint-а и head-а; ожидание 0;
main правит неподтверждённый черновик; Agent review запускается на нём; старая отметка `submitting` не удаляется
Discard-ом; молодая удаляется; полоса держит Discard выключенным; Review mode не вызывает Discard; нет предупреждения.

Решено без владельца (раунд 3):
- Ожидание списка — 5 минут (`LISTING_WAIT_MS` в `src/shared/ipc/pr-review.ts`): POST gh ограничен 30 s, GitHub обычно
  показывает новое ревью за секунды; 5 минут — запас для медленного ответа GitHub, а человек ждёт не дольше.
- Отметка без времени (черновик до раунда 2) считается старой: ждать нечего.
- Discard отметки `submitting` — с той же границей 5 минут, что и ожидание списка.
- Не сделано (необязательный пункт ревью): граница по наибольшему id ревью, прочитанному до POST, вместо 2 минут на
  расхождение часов. Нужен лишний GET перед каждым POST; граница по времени и сверка комментариев уже отсекают прежнее
  ревью с теми же текстами.

Не проверено:
- Пункт 8, sandbox: что GitHub отвечает на POST ревью при висящем pending review с github.com. Запросы к настоящему
  GitHub бриф запретил; при приёмке — вручную на тестовом репозитории.
- Ревью ступени `max` — делает Orchestrator.

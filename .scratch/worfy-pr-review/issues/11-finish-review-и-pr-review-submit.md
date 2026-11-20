# 11 — Finish review и `pr-review-submit.ts`: диалог с каждым комментарием ровно, lint, проверка head, один POST ревью по Submit человека, новый ADR

Type: task
Status: open
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

- [ ] Contract `test/contract/pr-review-submit.test.ts` (новый) на gh stand-in: lint-находка — ни одного POST; head
      сдвинулся — комментарии на `startedOn`; ровно один POST с телом байт в байт как показанный `payload`; свой PR;
      сбой и повтор без второго POST; `submitting` после обрыва; stand-in валит test на любой записи, кроме одного
      POST Submit-а, и на POST без щелчка. Красный до правки — в «Итог».
- [ ] Тот же contract: черновик Agent review — `event` в POST тот, что выбрал человек, а не `suggestedEvent`;
      убранный в диалоге комментарий агента в POST не попал.
- [ ] Unit `test/unit/finish-review-dialog.test.tsx` (новый): переключатель начинается с Comment; «The agent suggests»;
      неактивные события на своём PR и без текста; Enter не отправляет.
- [ ] `test/contract/harness-review-draft-lint.test.ts`: обычный режим без `--rules`.
- [ ] e2e `test/e2e/pr-review.spec.ts`: полный путь A (поиск → Review myself → комментарий → Submit → stand-in получил
      один POST) и C (head сдвинулся); путь E (Agent review → правка → Submit); chip `1/2` → `2/2`.
- [ ] Новый ADR и Amendment-ы ADR-0105 и ADR-0002 влиты в этом PR.
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

# 05 — Редактор черновика и Send по щелчку: main перепроверяет и публикует ровно показанный текст

Type: task
Status: open
Blocked by: 02, 03, 04
Source: [spec.md](../spec.md), «Что видит пользователь», п. 4–5; «Как работает» → «Send по щелчку (Ticket 05; Q2,
ADR-0105)»; «Решено без владельца»; «Риски» («Публикация по ошибке», «Scope токена»); «Ticket-ы», «Волны» (Wave 3);
решения Q2, Q8, Q9; [ADR-0105](../../../docs/adr/0105-pr-reply-only-on-the-users-click.md), пункты 2–6

Платформенный Ticket: нет (main и renderer). Глубина ревью — `max`: первая запись на GitHub из main.

## Что происходит

- Main сегодня только читает GitHub (`src/main/github/prs.ts:23-25`, `src/main/github/gate-queue.ts:3-4`).
- Черновики пишет skill `/worfy:pr-reply` (Ticket 04) в `<Profile folder>/state/pr-inbox/drafts/`; папку Profile-а
  main находит через `readProfileFolder` (`src/main/workflow/profile.ts:634`).
- Образец диалога «показать точный текст и Send» — `worfy.ask` (`docs/features/cards.md:174-180`).

## Что делаем

1. В виде (`PrInboxView.tsx`) — кнопка **Draft replies** на PR: `actions.prReply` из Ticket-а 04.
2. `src/renderer/pr-inbox/DraftThread.tsx`: под нитью — исходные комментарии, черновик в поле для правки, кнопки
   **Send**, **Discard**, **Ask the Session to rewrite** (сообщение Session, которая писала черновик, если она жива).
   **Send all** — диалог со всеми текстами и кнопками Send all / Cancel.
3. IPC (каналы `local`, с Linked machine недоступны): `prInbox.drafts` (черновики PR), `prInbox.saveDraft` (правка
   пользователя в файл черновика), `prInbox.discard`, `prInbox.send` (один черновик или список после диалога).
4. `src/main/github/pr-reply-send.ts`:
   1. читает черновик из файла, берёт текст ровно как сохранён из поля;
   2. запускает `review-draft-lint --reply` над этим текстом; находка — публикации нет, строка находки в ответе;
   3. публикует один раз, с `GH_TOKEN` аккаунта Project-а (`accountAuth`): ответ в нити —
      `POST repos/{o}/{r}/pulls/{n}/comments/{replyTo}/replies`, ответ в разговоре —
      `POST repos/{o}/{r}/issues/{n}/comments`; тело — `body` из файла, без добавок;
   4. пишет в файл `state: "sent"` и `sentUrl`; повторный Send отправленного черновика — отказ;
   5. ошибка сети или GitHub — `draft` с причиной; без автоматического повтора; перед ручным повтором перечитывает
      нить и, если этот текст от этого аккаунта уже опубликован, только отмечает `sent`;
   6. Send all — по одному POST подряд (предел GitHub — 80 записей в минуту).
5. Никаких других записей: ни resolve, ни re-request review, ни review, ни pending review, ни «прочитано», ни push.
6. `docs/features/pr-inbox.md` — черновики, Send, Send all, что worfy никогда не делает на GitHub.

## Готово, когда

- [ ] Contract test: Send — журнал stub-а gh содержит ровно один `POST …/replies` с телом, байт в байт равным
      сохранённому тексту поля; файл черновика — `sent` и `sentUrl`.
- [ ] Contract test: черновики есть, вид открыт, нити раскрыты, `saveDraft` и `discard` вызваны — ни одной записи в
      журнале stub-а без `prInbox.send`.
- [ ] Contract test: след workflow в правленом тексте — lint находит, публикации нет, черновик `draft` с причиной.
- [ ] Contract test: ответ GitHub 500 — публикации больше не было, `draft` с причиной; повтор, когда текст уже
      опубликован (stub отдаёт его в нити), — только отметка `sent`, второго POST нет.
- [ ] Contract test: `prInbox.send` с Linked machine (любой уровень доступа) — отказ до handler-а.
- [ ] Contract test: повторный Send отправленного черновика — отказ, второго POST нет.
- [ ] Unit test: `DraftThread` — Send неактивен на пустом тексте; Send all открывает диалог со всеми текстами;
      Cancel — ни одного вызова `prInbox.send`.
- [ ] E2e test: правка черновика и щелчок Send — один POST с правленым текстом в журнале stub-а; без щелчка — ни
      одного.
- [ ] Владелец в Mac Stable отправил один ответ на настоящем PR командного проекта: на GitHub ровно текст из поля,
      без следов workflow и подписи ИИ.
  - needs: mac stable
- [ ] `docs/features/pr-inbox.md` описывает черновики и Send.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Contract `test/contract/pr-inbox-send.test.ts` (новый); unit `test/unit/draft-thread.test.tsx` (новый); e2e
  `test/e2e/pr-inbox.spec.ts`.
- Сначала падающий: `prInbox.send` на `main` нет; test с журналом stub-а ждёт один POST.
- Ни настоящего GitHub, ни модели: gh — stub через `WORFY_GH` с журналом вызовов; Session — fake agent; fixture-ы —
  выдуманные владельцы, репозитории, login-ы и тексты.
- Никогда не публиковать без щелчка: каждый test, кроме тех, что жмут Send, проверяет, что журнал stub-а не содержит
  записей.

## Где в коде

- `src/renderer/pr-inbox/DraftThread.tsx` (новый)
- `src/renderer/pr-inbox/PrInboxView.tsx`
- `src/shared/ipc/pr-inbox.ts`
- `src/main/ipc/pr-inbox.ts`
- `src/main/github/pr-reply-send.ts` (новый)
- `docs/features/pr-inbox.md`
- `test/contract/pr-inbox-send.test.ts` (новый)
- `test/unit/draft-thread.test.tsx` (новый)
- `test/e2e/pr-inbox.spec.ts`

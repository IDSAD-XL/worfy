# 141 — Аудит повторного review: PR inbox и pr-reply

Type: bug
Status: open
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «Чинить сейчас»; checked open on main 3c9c06e8c 2026-11-25

Кто: агент. Глубина review — `low`. Не платформенный PR.

Четыре находки аудита `.scratch/audit-pr-rereview-2026-11-13/` (полный текст — `spec.md`, порядок — `triage.md`), все
про PR inbox и skill `pr-reply`. Каждая проверена на `main` 3c9c06e8c 2026-11-25: все четыре ещё открыты, ни одна не
снята.

## Что происходит

- **162.** Skill `pr-reply` (`harness/skills/pr-reply/SKILL.md:65`, раздел «3. What waits for an answer») считает, что
  review thread ждёт ответа, когда он не resolved и последний комментарий не пользователя (viewer). На PR коллеги так
  выходит каждый нерешённый thread, даже где пользователь не писал и ход не за ним: skill пишет drafts ответов, которых
  пользователь не должен. Приложение считает иначе: `owesAnswer` в `src/main/github/inbox-groups.ts:90` и
  `waitingThreads` в `src/shared/pr-inbox/rows.ts:18` — на чужом PR ждёт только thread, где пользователь писал.
- **169.** Заголовок «Answer N open threads» полосы «what to do next» (`src/renderer/pr-inbox/usePrInbox.ts:501`,
  `nextStep`, группа `needs-answer`) берёт N из `row.unresolvedThreads` — все нерешённые threads. На PR коллеги число
  включает threads, где ход не за пользователем; рядом есть `waitingThreads` (`src/shared/pr-inbox/rows.ts:18`), по
  которому считают badge на Card и группу «Needs my answer».
- **168.** Drafts ответов выбранного PR читаются по `setInterval(load, 5 s)` и на focus окна
  (`src/renderer/pr-inbox/DraftThread.tsx:160`), пока `PrDrafts` смонтирован. Виды shell-а остаются смонтированными и
  только скрываются (`src/renderer/shell/AppShell.tsx:136`), так что скрытый вид Pull requests каждые 5 s зовёт
  `prInbox.drafts` (а main при этом запускает `bin/profile`) всё время, пока открыто окно.
- **171.** `CommentBody` (`src/renderer/pr-inbox/CommentBody.tsx:7`) разбирает markdown комментария заново на каждый
  render родителя: на каждое чтение drafts и каждое нажатие клавиши в поле ответа, хотя `body` и `repo` те же. По
  аудиту ~195 ms на раз, ввод тормозит.

## Что делаем

1. 162: в разделе 3 skill-а `pr-reply` правило review thread — как `owesAnswer` приложения: не resolved, последний
   комментарий (`latest`) не viewer-а, и на PR, автор которого не viewer, только thread, в котором viewer писал.
   Shell test текста skill-а, красный до правки.
2. 169: `nextStep` в группе `needs-answer` считает N через `waitingThreads(row, viewer)`. В группе `needs-review`
   («N open threads from others») число остаётся `unresolvedThreads`.
3. 168: drafts читаются (сразу, по таймеру и на focus окна), только пока показан вид Pull requests
   (`useNavigation`, `view === 'pull-requests'`); при показе — одно чтение сразу.
4. 171: `CommentBody` — `React.memo`: тот же `body` и `repo` — markdown не рисуется заново.
5. `docs/features/pr-inbox.md` — N в «Answer N open threads» и чтение drafts только при показанном виде. Перевод
   `docs/features/ru/` не правится (ADR-0088).

## Готово, когда

- [ ] 162: `harness/bin/tests/pr-reply-text.test.sh` — раздел 3 skill-а `pr-reply` требует для review thread на чужом
      PR комментарий viewer-а в thread-е, как `owesAnswer`. Красный на origin/main.
- [ ] 169: unit test `test/unit/pr-inbox-view.test.tsx` — PR коллеги в «Needs my answer» с двумя нерешёнными
      threads, из которых пользователь писал в одном: заголовок «Answer 1 open thread». Красный на origin/main.
- [ ] 168: unit test `test/unit/draft-thread.test.tsx` — пока вид Pull requests скрыт, ни таймер, ни focus окна не
      зовут `prInbox.drafts`; при показе вида — одно чтение. Красный на origin/main.
- [ ] 171: unit test `test/unit/pr-inbox-comment-body.test.tsx` — render родителя с тем же `body` и `repo` не рисует
      markdown заново; другой `body` рисует. Красный на origin/main.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `harness/skills/pr-reply/SKILL.md:63-71` (раздел «3. What waits for an answer»)
- `harness/bin/tests/pr-reply-text.test.sh` — новый
- `src/renderer/pr-inbox/usePrInbox.ts:500-525` (`nextStep`)
- `src/renderer/pr-inbox/DraftThread.tsx:124-168` (`usePrReplyDrafts`)
- `src/renderer/pr-inbox/CommentBody.tsx:7-13`
- `test/unit/pr-inbox-view.test.tsx:712-721`
- `test/unit/draft-thread.test.tsx:84-112`
- `test/unit/pr-inbox-comment-body.test.tsx` — новый
- `docs/features/pr-inbox.md:93`, `:297`
- `src/shared/pr-inbox/rows.ts:13-26`, `src/main/github/inbox-groups.ts:85-99` — только читать (правило `owesAnswer`)
- `src/renderer/shell/AppShell.tsx:121-138`, `src/renderer/session/navigation.ts:44` — только читать

## Вне скоупа

- Остальные находки `triage.md`, в том числе 170 (выбор PR при старте окна, а не при открытии вида).
- Комментарии conversation в skill-е `pr-reply` — их правило не меняется.

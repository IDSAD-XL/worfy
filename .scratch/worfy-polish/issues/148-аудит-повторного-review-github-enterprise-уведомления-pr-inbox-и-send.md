# 148 — Аудит повторного review: GitHub Enterprise, уведомления PR inbox и Send

Type: bug
Status: open
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «В Ticket-ы»; checked open on main b0e073620 2026-11-25

Кто: агент. Глубина review — `low`. Не платформенный PR.

Четыре finding-а аудита повторного review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера 157,
158, 165, 181), все про вызовы GitHub из main process. Каждое проверено на main b0e073620: все открыты; 165 — в
сузившемся виде (сказано ниже).

## Что происходит

- **157. На GitHub Enterprise Server доступ на запись проверяется под активным аккаунтом.** `src/main/github/accounts.ts:136`
  зовёт `gh api repos/<owner>/<repo> --jq .permissions.push --hostname <host>` с окружением аккаунта, а
  `accountAuth` (`src/main/github/prs.ts:171-191`) даёт только `{ GH_TOKEN: token }`. Для host-а, отличного от
  github.com, `gh` берёт `GH_ENTERPRISE_TOKEN`, а `GH_TOKEN` не смотрит. Сценарий: у пользователя два аккаунта на
  `ghe.example.com`; право на запись Project-а проверяется под активным аккаунтом `gh`, и Project получает неверный
  финиш (`local-green` вместо `pr-green-ci` или наоборот).
- **158. `gh auth token -u` вызывается без `--hostname`.** `prs.ts:179`:
  `options.run(['auth', 'token', '-u', account], root)`. Token аккаунта Enterprise ищется на github.com. Сценарий:
  аккаунт Project-а живёт на GitHub Enterprise Server — PR inbox и Work track этого Project-а всегда показывают «no gh
  login for <account>».
- **165. Неполное первое чтение становится baseline уведомлений.** `PrInboxNotices.read`
  (`src/main/notify.ts:672-684`) принимает первый snapshot с `readAt` за baseline. Случай «запрос details упал» уже
  закрыт: с #1884 (1673088fe) `readAt` ставится только после чтения details (`src/main/github/inbox.ts:751-753`), и
  упавшее чтение baseline не даёт. Остался rate limit: когда `noteRate` ставит паузу посреди чтения details, цикл
  страниц останавливается (`inbox.ts:748`), а `readAt` всё равно ставится, с `error` = причиной паузы (`:753-755`).
  Snapshot без PR-ов непрочитанных страниц становится baseline. Сценарий: первое чтение Project-а с сотней PR упирается в
  rate limit; после reset приходит пачка уведомлений «review requested» о старых PR.
- **181. Сбой записи in-flight mark не проверен.** `src/main/github/pr-reply-send.ts:358-366`: если отметку «отправка
  идёт» (`IN_FLIGHT`) не удалось записать в файл drafts, Send отвечает `refused` и не публикует. Ни один test не
  проверяет эту ветку (`test/contract/pr-inbox-send.test.ts` проверяет `refused` по другим причинам, `:291`, `:308`,
  `:568`). Сценарий: если ветку сломать так, что post идёт без отметки, сбой посреди отправки и повтор публикуют один
  ответ дважды, а test-ы зелёные.

## Что делаем

1. 158: `accountAuth` знает host repository Project-а и зовёт `gh auth token -u <account> --hostname <host>`.
2. 157: для host-а не github.com `accountAuth` отдаёт token в `GH_ENTERPRISE_TOKEN` (и `GH_TOKEN` для github.com, как
   сейчас); проверка записи в `accounts.ts` идёт с ним.
3. 165: notifier не берёт за первый baseline snapshot, у которого `error` не null; baseline — первое чтение без ошибки.
4. 181: test на ветку сбоя записи отметки.

## Готово, когда

- [ ] 158: test `test/contract/github-prs.test.ts` (stand-in `gh` из `test/contract/gh-world.ts`) — аккаунт на
      `ghe.example.com`: `gh auth token` получает `--hostname ghe.example.com`. Красный на origin/main.
- [ ] 157: test `test/contract/github-accounts.test.ts` — проверка записи для repository на `ghe.example.com` идёт с
      `GH_ENTERPRISE_TOKEN` аккаунта Project-а; для github.com — с `GH_TOKEN`, как сейчас. Красный на origin/main.
- [ ] 165: test `test/contract/pr-inbox-notifications.test.ts` — первое чтение с паузой rate limit посреди details (часть
      PR без строк), следующее полное: уведомлений о старых PR нет. Красный на origin/main.
- [ ] 181: test `test/contract/pr-inbox-send.test.ts` рядом с `:582` — запись отметки in-flight падает: исход `refused`
      с «could not be marked before the post», stand-in `gh` не получил POST, draft не помечен отправленным; mutant «post
      после неудачной отметки» — красный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/github/prs.ts:160-191` (`accountAuth`)
- `src/main/github/accounts.ts:132-140` (`pushAccess`)
- `src/main/notify.ts:665-695` (`PrInboxNotices.read`)
- `src/main/github/inbox.ts:725-765` (чтение Project-а, `readAt`, пауза), `:843-850` (`noteRate`) — только читать
- `src/main/github/pr-reply-send.ts:350-370`
- `test/contract/github-prs.test.ts`, `test/contract/github-accounts.test.ts`, `test/contract/gh-world.ts`,
  `test/contract/pr-inbox-notifications.test.ts`, `test/contract/pr-inbox-send.test.ts`

## Вне скоупа

- Остальные находки `triage.md`.
- Прочие вызовы `gh` с `GH_TOKEN` вне `accountAuth` (Harness-hook `gh-token-env.mjs`): отдельный Ticket, если
  понадобится.

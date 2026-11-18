# 07 — Молчаливые сбои GitHub → Health check: PR inbox, PR badges, gate-queue, Flight recorder, проба ревью, pr-reply

Type: task
Status: open
Blocked by: 04, 05
Source: [spec.md](../spec.md), «Ticket-ы», 7; «Проблема», пункты «PR inbox», «PR badges, gate-queue, Flight recorder»,
«`github.account` пуст или невалиден», «Прочее»; «Решение», пункты 4 и 5; «Решения по реализации», 4; «Решения по
test-ам»; «Истории пользователя», 1, 2 и 6; «Волны», Wave 3 и пересечение с `worfy-pr-follow`

Кто: агент.

Не платформенный Ticket (main process и renderer, без веток по платформе). Глубина ревью — `medium`; снимок экрана
строки ошибки PR inbox и tooltip PR badge.

Не стартует, пока не слит `worfy-pr-follow` 04 (кнопки в Pull requests): оба правят
`src/renderer/pr-inbox/PrInboxView.tsx` (spec, «Волны»).

## Что происходит

- PR inbox: ошибка gh попадает в `state.error` (`src/main/github/inbox.ts:382`, `:552`) и в строку `pr-inbox-error`
  (`src/renderer/pr-inbox/PrInboxView.tsx:596-598`). Rate limit имеет свой текст (`inbox.ts:639`). Пустой ответ поиска
  без ошибки показывает пустой список.
- Нет `github.account`: PR inbox и тот не пишет — `log: () => undefined` (`src/main/ipc/pr-inbox.ts:79`); PR badges
  пишут причину один раз на Project (`src/main/ipc/checks.ts:170-178`).
- PR badges, gate-queue, Flight recorder: ошибка только в log (`src/main/ipc/checks.ts:160-180`;
  `src/main/github/gate-queue.ts:240`; `src/main/flight-recorder/github.ts:12-15`).
- Проба ревью: `ghEnv` (`accountAuth`) — `src/main/projects/review-offer.ts:202`; любой сбой — одна строка log
  (`:243`, `:260`), текста для человека нет.
- `src/main/github/pr-reply-send.ts`: отказ без `github.account` — `:87`.
- Ticket 04 дал `openHealthCheck()` (`src/renderer/settings/settings-window.ts`) и иконку; Ticket 05 — строку GitHub
  access Project-а с причиной; Ticket 03 — `reportFailure` и `reportOk` (`src/main/first-run/health-reports.ts`).

## Что делаем

1. PR inbox (`inbox.ts`): сбой входа — `state.error` с причиной строки GitHub access Project-а и `reportFailure`;
   успешное чтение — `reportOk`. Текст причины берётся из строки, поэтому SSO-текст появится в PR inbox сам, когда его
   даст Ticket 06; этот Ticket его не ждёт.
2. `PrInboxView.tsx:596-598`: строка причины простыми словами и ссылка «Open Health check» (`openHealthCheck()`).
3. `src/main/ipc/pr-inbox.ts:79`: причина «нет `github.account`» больше не глотается — одно сообщение на Project.
4. PR badges (`src/main/ipc/checks.ts:170-178`), gate-queue (`gate-queue.ts:240`), Flight recorder
   (`flight-recorder/github.ts`), проба ревью (`review-offer.ts:243`, `:260`), `pr-reply-send.ts`: `reportFailure`
   вместо log или рядом с ним; успех — `reportOk`. Причина — только login, имя переменной, имя организации; никогда
   значение токена.
5. Tooltip PR badge (`src/renderer/canvas/badges/ChecksBadges.tsx`): при сбое входа — одна строка причины и «Open
   Health check».
6. Своих панелей нет; toast и системных уведомлений нет (Q9).
7. Английская страница `docs/features/pr-inbox.md`: строка причины и ссылка. Перевод — Ticket 09.

## Готово, когда

- [ ] Contract test (`test/contract/pr-inbox.test.ts`): отказ stand-in gh (401) → `state.error` с причиной строки и
      `reportFailure`; следующее успешное чтение → `reportOk`; нет `github.account` — одно сообщение на Project.
- [ ] Contract test-ы (`test/contract/gate-queue.test.ts`, `test/contract/flight-recorder-github.test.ts`,
      `test/contract/pr-inbox-send.test.ts`, новый `test/contract/review-offer.test.ts`): сбой входа каждой фичи —
      `reportFailure` с причиной, успех — `reportOk`.
- [ ] Unit test (`test/unit/pr-inbox-view.test.tsx`): строка ошибки со ссылкой «Open Health check» зовёт
      `openHealthCheck()`.
- [ ] Unit test (`test/unit/checks-badges.test.tsx`): tooltip PR badge при сбое входа — одна строка и ссылка.
- [ ] e2e test (`test/e2e/pr-inbox.spec.ts`, stand-in gh): отказ GitHub в PR inbox → иконка Health check краснеет без
      нового запроса в сеть; щелчок открывает Settings → Health со строкой Project-а. Без реальной сети.
- [ ] Test, что ни одна строка, log и `state.error` не содержат значение токена: stand-in gh печатает известный токен,
      test ищет его во всём выводе.
- [ ] Все unit и contract test-ы модуля зелёные: `test/contract/pr-inbox.test.ts`, `test/contract/pr-inbox-send.test.ts`,
      `test/contract/gate-queue.test.ts`, `test/contract/flight-recorder-github.test.ts`,
      `test/unit/flight-recorder-github.test.ts`, `test/unit/pr-inbox-view.test.tsx`, `test/unit/checks-badges.test.tsx`,
      `test/unit/review-offer-toast.test.ts`, `test/unit/pr-inbox-notices.test.ts`.
- [ ] Снимок экрана строки ошибки PR inbox и tooltip PR badge — в «Итог» (снимок ревью — в scratchpad, в репозиторий не
      кладётся).
- [ ] Английская страница `pr-inbox.md` описывает строку причины и ссылку.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/github/inbox.ts`, `src/main/ipc/pr-inbox.ts`
- `src/main/ipc/checks.ts`
- `src/main/github/gate-queue.ts`
- `src/main/flight-recorder/github.ts`
- `src/main/projects/review-offer.ts`
- `src/main/github/pr-reply-send.ts`
- `src/renderer/pr-inbox/PrInboxView.tsx`
- `src/renderer/canvas/badges/ChecksBadges.tsx`
- `docs/features/pr-inbox.md`
- `test/contract/pr-inbox.test.ts`, `test/contract/review-offer.test.ts` (новый), `test/unit/pr-inbox-view.test.tsx`,
  `test/unit/checks-badges.test.tsx`, `test/e2e/pr-inbox.spec.ts`

Только читать: `src/main/first-run/health-reports.ts`, `src/renderer/settings/settings-window.ts`,
`src/main/github/auth-diagnosis.ts`.

## Вне скоупа

- Разбор SSO — Ticket 06. Codex, Browser, Link — Ticket 08.
- Update без токена (`src/main/update/github.ts:5-7`, ADR-0089) — так и задумано.

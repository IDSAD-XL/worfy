# 08 — Codex, Browser, Link: строка входа Codex в своём модуле, `notice` Session Codex, сообщения Browser и Link

Type: task
Status: open
Blocked by: 04, 05
Source: [spec.md](../spec.md), «Ticket-ы», 8; «Проблема», пункты «Codex» и «Прочее»; «Решение», пункты 1, 4 и 5;
«Починка», строки Codex, Browser profile, Linked machine; «Решения по реализации», 5; «Решения по test-ам»; «Решения
владельца», Q11; [critic 2026-11-18](../../../docs/product/critic/worfy-auth-check-2026-11-18.md), возражение 1 и
«Alternative» (строка Codex — в своём модуле)

Кто: агент.

Не платформенный Ticket (новые строки и сообщения в main и renderer, ветки по платформе Codex и Link не меняются).
Глубина ревью — `medium`.

Blocked by 04 — ради `openHealthCheck()`; 05 — ради строки подключения в `src/main/first-run/checks.ts`: оба Ticket-а
правят этот файл.

## Что происходит

- Codex: app-server не стартовал — «не вошёл» только в log (`src/main/vendors/codex/account.ts:166`); чтение аккаунта —
  `readCodexAccount` (`account.ts:123`); вход — путь `account.ts:223-229`.
- Session Codex без `GH_TOKEN` — только log (`src/main/vendors/codex/session.ts:936`); строки `notice` Session Codex
  уже умеет (`session.ts:560`, `:582`).
- Browser: `signInExpiry` (`src/main/mcp/browser-server.ts:136`) отдаёт «sign-in expired» только агенту (`:175-178`,
  `:248-249`).
- Link: нечитаемый файл секретов откладывается в `<name>.unreadable-<time>` с одной строкой log
  (`src/main/link/secrets.ts:54-58`); смена сертификата Linked machine — `certificate-changed`
  (`src/main/link/service.ts:487-489`, снимается — `:532`), в sidebar — chip «Certificate changed»
  (`src/renderer/shell/sidebar/MachinesSection.tsx:97`).
- Ticket 03 дал `reportFailure` / `reportOk` и ids строк; Ticket 04 — `openHealthCheck()`; Ticket 05 — строки Project-а
  в `checks.ts`.

## Что делаем

1. Строка входа Codex в своём модуле `src/main/first-run/vendor-checks.ts` (новый); в `checks.ts` — одна строка
   подключения. Чтение — через `codex/account.ts`; app-server не стартовал — `unknown`, не `fail`. Уровень всегда
   non-critical (Q11). Кнопка «Sign in to Codex…» — путь `account.ts:223-229`. `opensFirstRun: false`.
2. Session Codex (`session.ts:936`): нет `GH_TOKEN` — `notice` с причиной и «Open Health check» вместо одной строки log;
   `reportFailure` строки GitHub access Project-а этой Session.
3. Browser (`browser-server.ts:175-178`, `:248-249`): истёкший вход — `reportFailure` строки этого Browser profile, шаг
   «войти в Browser этого profile», кнопка «Open Browser»; удачная проверка под profile — `reportOk`.
4. Link: смена сертификата (`service.ts:487-489`) и `.unreadable-<time>` (`secrets.ts:54-58`) — строка Linked machine,
   шаг «связать заново по коду», кнопка «Link a machine…»; повторная связь (`service.ts:532`) — `reportOk`.
5. Все строки этого Ticket-а non-critical по таблице `src/shared/health/severity.ts`; таблицу не править.
6. Английские страницы: `docs/features/vendors.md` (строка Codex, `notice`), `docs/features/browser.md`,
   `docs/features/link.md`, `docs/features/storage-and-diagnostics.md` (сообщения фич в Health check). Перевод — Ticket 09.

## Готово, когда

- [ ] Contract test (`test/contract/codex-account.test.ts`): строка Codex — `ok` при входе, needs-user с «Sign in to
      Codex…» без входа, `unknown` при app-server, который не стартовал; уровень non-critical.
- [ ] Contract test (`test/contract/codex-session-gh-token.test.ts`): без `GH_TOKEN` — `notice` с «Open Health check»
      и `reportFailure`; токен в `notice` и log не попадает.
- [ ] Contract test (`test/contract/browser-tools.test.ts`): истёкший вход — `reportFailure` строки profile; удачная
      проверка — `reportOk`.
- [ ] Unit или contract test Link: файл секретов отложен — строка Linked machine; смена сертификата и повторная связь —
      строка появляется и снимается.
- [ ] Test, что ни одна строка, `notice`, log и текст ошибки не содержат значение токена: stand-in gh печатает
      известный токен, test ищет его во всём выводе; секреты Link в строку не попадают.
- [ ] Все unit и contract test-ы модуля зелёные: `test/contract/codex-account.test.ts`,
      `test/contract/codex-session-gh-token.test.ts`, `test/contract/codex-session.test.ts`,
      `test/contract/browser-tools.test.ts`, `test/unit/link-secrets-write.test.ts`, `test/unit/machines-section.test.tsx`,
      `test/contract/first-run-checks.test.ts`.
- [ ] Английские страницы `vendors.md`, `browser.md`, `link.md`, `storage-and-diagnostics.md` описывают новые строки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/first-run/vendor-checks.ts` (новый), `src/main/first-run/checks.ts` (одна строка подключения)
- `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/account.ts`
- `src/main/mcp/browser-server.ts`
- `src/main/link/secrets.ts`, `src/main/link/service.ts`
- `docs/features/vendors.md`, `docs/features/browser.md`, `docs/features/link.md`,
  `docs/features/storage-and-diagnostics.md`
- `test/contract/codex-account.test.ts`, `test/contract/codex-session-gh-token.test.ts`,
  `test/contract/browser-tools.test.ts`

Только читать: `src/main/first-run/health-reports.ts`, `src/shared/health/severity.ts`,
`src/renderer/settings/settings-window.ts`, `src/renderer/shell/sidebar/MachinesSection.tsx`.

## Вне скоупа

- Проверки Linked machine-ом чужой Machine: Health check описывает свою Machine (`docs/features/onboarding.md:107`).
- GitHub-сбои PR inbox и прочих фич — Ticket 07.

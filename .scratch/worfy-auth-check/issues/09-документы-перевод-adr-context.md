# 09 — Документы: переводы страниц Feature, ADR Health check, Amendment к ADR-0042, термин в CONTEXT.md

Type: task
Status: claimed 2026-11-19T06:30Z
Blocked by: 01, 03, 04, 05, 07, 08
Source: [spec.md](../spec.md), «Ticket-ы», 9; «Решения по реализации», 6; «Волны», Wave 4; «Решения владельца», Q1;
«Готово, когда», пункт о документах

Кто: агент.

Не платформенный Ticket (документы). Глубина ревью — `low`.

Ticket 06 (SSO) его не держит: spec ставит 09 после 03–08, но SSO-часть дописывается после 06, а приёмка 10 ждёт 09
без 06. SSO-часть переводов и ADR — отдельным PR этого Ticket-а или в PR Ticket-а 06, если 06 влит раньше.

## Что происходит

- Английские страницы Feature правят Ticket-ы своего поведения (ADR-0088): `onboarding.md` и `app-shell.md` (04),
  `gate-and-github.md` и `projects.md` (05, SSO — 06), `pr-inbox.md` (07), `vendors.md`, `browser.md`, `link.md`,
  `storage-and-diagnostics.md` (08). Перевод в PR с поведением не считается, поэтому `docs/features/ru/` отстаёт.
- ADR о Health check нет: уровни строк, состояния `ok | fixable | needs-user | unknown` и сообщения фич о сбоях нигде не
  записаны.
- ADR-0042, пункт 9 (`docs/adr/0042-profile-on-machine-full-and-silent-modes.md:78`): аккаунт GitHub — свойство
  Project-а, `GH_TOKEN` из `gh auth token -u`. Что gh берёт токен из окружения, когда `github.account` пуст, и что
  делает тогда Health check, — не сказано. Раздел `## Amendments` — `:147`.
- Термин Health check в CONTEXT.md уже есть (`CONTEXT.md:328-330`, принят со spec-ом): критичность строк, иконка на
  rail, отличие от First run.

## Что делаем

1. Переводы в `docs/features/ru/`: `onboarding.md`, `app-shell.md`, `gate-and-github.md`, `pr-inbox.md`, `projects.md`,
   `vendors.md`, `browser.md`, `link.md`, `storage-and-diagnostics.md` — по английским страницам на `main`.
2. Новый ADR «Health check: уровни строк и сообщения фич о сбоях» (номер резервирует ship-ticket): таблица уровней,
   состояния строки, `unknown` никогда не critical, сообщения `reportFailure` / `reportOk`, когда проверять (старт,
   Settings → Health, «Check again», фокус окна после 5 минут, события фич; таймера нет), `opensFirstRun: false` для
   новых строк, иконка без toast и системных уведомлений, токены никогда не логируются.
3. Датированный Amendment к ADR-0042, пункт 9 (`## Amendments`, по `rules-adr.md`): источник токена — keyring или
   переменная окружения (только имя); пустой `github.account` при рабочем токене окружения — non-critical строка с
   «Use <login>», запись по щелчку через `profile-set`; переменные окружения worfy не меняет.
4. CONTEXT.md: сверить статью Health check (`CONTEXT.md:328-330`) с тем, что влито (имена состояний, иконка, Command
   palette «Health check», «First-run checks» — только окно First run); править только расхождения.

## Готово, когда

- [ ] Девять страниц `docs/features/ru/` совпадают по смыслу с английскими на `main` (review по каждой).
- [ ] Новый ADR влит; номер зарезервирован ship-ticket-ом.
- [ ] Amendment к ADR-0042 влит, текст ADR выше него не изменён.
- [ ] Статья Health check в CONTEXT.md совпадает с влитым поведением.
- [ ] `node scripts/check-personal.mjs` и `node scripts/check-feature-docs.mjs` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `docs/features/ru/onboarding.md`, `docs/features/ru/app-shell.md`, `docs/features/ru/gate-and-github.md`,
  `docs/features/ru/pr-inbox.md`, `docs/features/ru/projects.md`, `docs/features/ru/vendors.md`,
  `docs/features/ru/browser.md`, `docs/features/ru/link.md`, `docs/features/ru/storage-and-diagnostics.md`
- `docs/adr/<NNNN>-health-check-row-levels-and-feature-reports.md` (новый, имя — предложение)
- `docs/adr/0042-profile-on-machine-full-and-silent-modes.md`
- `CONTEXT.md`

## Вне скоупа

- Английские страницы — в Ticket-ах поведения.
- Тексты агенту в Harness (`harness/hooks/gh-token-env.mjs`, `harness/bin/preflight`) — не меняются.

## Итог

Сделано 2026-11-19, ветка `worfy-auth-check/09`. SSO-часть (Ticket 06) не входит: 06 не влит.

- **Переводы.** Девять страниц `docs/features/ru/` сверены с английскими на `main` (`5d1efe69`) по всему diff-у с прошлой
  метки перевода, а не только по Ticket-ам 03–08: в `vendors.md` дописаны и старые хвосты (конец хода и Stop hook Codex,
  модель и effort по умолчанию в заголовке, Code story только на Claude Code, fake Codex в собранном приложении), в
  `onboarding.md` — «Use Codex too» и «Remove project…» у demo, в `link.md` — точка Machines на rail, tooltip-ы
  read-only, ответ новой формы на старой сборке, в `browser.md` — `worfy-browser` у Session Codex. Строка «Перевод …
  commit» на всех девяти — `5d1efe69`; `node scripts/feature-docs-lag.mjs` их больше не называет.
- **ADR.** Новый [ADR-0109](../../../docs/adr/0109-health-check-row-levels-and-feature-reports.md): таблица уровней,
  состояния строки, `unknown` никогда не critical, `reportFailure` / `reportOk`, когда проверять, `opensFirstRun: false`,
  иконка без toast-ов, token-ы не логируются. Amendment к ADR-0042, пункт 9: источник token-а и строка при пустом
  `github.account`; текст выше раздела `## Amendments` не тронут.
- **CONTEXT.md.** Статья Health check: «не проверено» → «Couldn't check» (так пишет UI), состояния `ok | fixable |
  needs-user | unknown`, gh critical только при `origin` на GitHub, серое кольцо и жёлтая точка для непроверенной строки,
  Command palette «Health check» и «First-run checks» только для First run, ссылка на ADR-0109.
- **Расхождение тикета с кодом.** Тикет и spec («Уровни») говорят: non-critical, когда `github.account` пуст, а
  работает token окружения. Код (`src/main/first-run/checks.ts`, конец `githubAccess`) делает строку `warn` и
  non-critical при пустом `github.account` всякий раз, когда gh работает с тем token-ом, который берёт сам, — из
  переменной окружения или активного аккаунта keyring; флаг называется `environmentTokenOnly`, но ставится в обоих
  случаях. «Use <login>» есть только при одном логине с push во все репозитории, иначе строка `needs-user`. Amendment
  и ADR-0109 записаны по коду.
- **Повторная проверка.** Spec называет повторную проверку после сбоя и при фокусе для всех строк; в коде своя проверка
  (`registerRecheck`) есть только у `github-access`, строки Machine ждут «Check again». ADR-0109 записан по коду, как и
  английская страница `onboarding.md`.
- **Английские страницы (вне скоупа, не тронуты).** `docs/features/onboarding.md` говорит «Codex has no row», а строка
  «Codex sign-in» в Health check есть (Ticket 08, `src/main/first-run/vendor-checks.ts`); `docs/features/gate-and-github.md`
  называет notice Session Codex без `GH_TOKEN` «a later Ticket (worfy-auth-check 08)», а 08 влит. Перевод следует
  английской странице.

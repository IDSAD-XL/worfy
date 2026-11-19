# 0109 — Health check: уровни строк и сообщения фич о сбоях
Дата: 2026-11-19. Статус: принят.

**Контекст.** До Epic-а `worfy-auth-check` Health check (Settings → Health, те же строки, что в окне First run) знал
только строки Machine со статусом `ok | warn | fail`. Всё, что ломалось после первой настройки — вход в GitHub для
Project-а, вход в Codex, истёкший вход Browser profile, сертификат Linked machine, — фичи писали только в свой log, и
человек узнавал о поломке по пустому PR inbox или по красному chip-у без причины. Строки не говорили, насколько поломка
важна, и строку, которую не удалось проверить из-за сети, нельзя было отличить от настоящей поломки. Решения владельца —
grilling 2026-11-18, «на все да», Q1–Q11 (`.scratch/worfy-auth-check/spec.md`, «Решения владельца»). Ticket-ы 03, 04,
05, 07 и 08 влиты; разбор SAML SSO (Ticket 06) ещё не влит, и его часть в этот ADR не входит.

**Решение.**

1. **Уровень у каждой строки (Q2; Ticket 03).** Строка несёт `severity`: `critical` — без неё основная работа не идёт,
   `non-critical` — фича работает хуже. Таблица одна, `src/shared/health/severity.ts` (`severityOf`), со всеми id строк
   Epic-а сразу; Ticket-ы строк её не правят.

   | Строки | Уровень |
   |---|---|
   | `claude-login`, `git`, `node`, `harness`, `harness-scripts`; на Windows `git-bash`, `powershell` (ADR-0057) | critical |
   | `gh`, `gh-auth` | critical, пока у Project-а этой Machine `origin` на GitHub; иначе non-critical (Demo project работает без GitHub) |
   | `github-access` — GitHub access Project-а | critical; non-critical, когда `github.account` пуст, а gh работает с тем token-ом, который берёт сам (Amendment к ADR-0042, пункт 9) |
   | `claude-version`, `limits`, `windows`, `arch`, `jq`, `git-identity`, `worfy-update`, `legacy-harness`, `harness-dependencies`, `qmd`, `qmd-models`, `qmd-collections` | non-critical |
   | `codex-login` — вход в Codex | non-critical: Vendor по умолчанию — Claude Code (ADR-0094), Session Codex сама говорит, чего ей не хватает (Q11) |
   | `browser-profile`, `linked-machine` | non-critical: деградирует одна проверка агента или пропадает одна Linked machine |

2. **Состояние строки.** К статусам добавлен `unknown`: строку не удалось проверить — нет сети, timeout, GitHub 5xx
   или его rate limit. `unknown` никогда не critical: `severityOf` даёт ему `non-critical`, а худший уровень отчёта его
   critical-уровень не учитывает (Q2). Что строка просит у человека, выводится, а не хранится (`checkState` в
   `src/shared/ipc/first-run.ts`): `ok`; `unknown`; `fixable` — у строки есть кнопка с пометкой `safe`, то есть она
   делает только обратимое и не трогает чужих данных; `needs-user` — шаг для человека. Безопасная кнопка показывается
   как **Fix** основным цветом. Сейчас такая кнопка одна — «Use <login>» строки GitHub access.
3. **Иконка, а не оповещения (Q3, Q4, Q9; Ticket 04).** Кнопка Health check стоит на rail sidebar-а прямо над Machines
   и открывает Settings → Health; строка «Health check» в Command palette делает то же, «First-run checks» остаётся
   окном First run (Q1). Точка — худший уровень отчёта Machine и всех открытых Project-ов (`worstLevel`): красная —
   critical-строка не в `ok`; жёлтая — не в `ok` только non-critical или `unknown`; нет точки — всё `ok`; серое кольцо —
   отчёта ещё нет или идёт «Check again». Toast-а и системного уведомления о новой поломке нет: только точка и строка на
   месте сбоя («Open Health check» в PR inbox, на chip-е `GitHub sign-in`, в notice Session Codex).
4. **Сообщения фич (Ticket-ы 03, 07, 08).** Фича, у которой сбой на своей строке, вызывает
   `healthReports().reportFailure(id, project, reason, step, actions?)` (`src/main/first-run/health-reports.ts`):
   строка сразу выходит из `ok` — `fail` с причиной и шагом, — без запроса в сеть, поэтому иконка краснеет сразу. Если у
   строки есть своя проверка (`registerRecheck`; сейчас только у `github-access`), за сообщением идёт одна проверка этой
   строки, не чаще раза в минуту на Project. `reportOk(id, project)` — фича снова работает — возвращает строку в `ok`
   без проверки. Побеждает самое новое: проверка, начатая после сообщения, его заменяет. Сообщают: о GitHub — PR inbox,
   PR badges, gate queue, Flight recorder, проба предложения ревью, Send черновиков ответов и старт Session Codex без
   `GH_TOKEN`; о Browser profile — истёкший вход страницы; о Linked machine — другой сертификат или отложенный файл
   секретов. О GitHub сообщается только отказ во входе (нет входа gh для аккаунта, HTTP 401, у gh нет token-а, SAML);
   нет сети, timeout, 5xx и rate limit строк не меняют.
5. **Когда проверять (Q8).** При старте; при открытии Settings → Health и по «Check again»; по сообщению фичи — как в
   пункте 4; при фокусе окна worfy — только строки не в `ok`, последняя проверка которых старше 5 минут, и только те,
   у которых есть своя проверка. Таймера и опроса сети нет. Строки GitHub access проверяются по сети после локальных
   (`checkNetwork`) и в отчёт, по которому старт решает об окне First run, не входят: старт сеть не ждёт.
6. **First run — только для настройки Machine (Q7).** Каждая строка Project-а, каждая строка, проверенная по сети, и
   каждая строка, созданная сообщением фичи, несут `opensFirstRun: false`: её `fail` сам не открывает First run при
   старте. О поломке после первой настройки говорит иконка.
7. **Token-ы не логируются и не показываются.** Причина и шаг сообщения проходят через `redactSecrets()`, а сам модуль
   отчёта их не логирует; в log-е — только имя ошибки. Строки называют логин, имя переменной (`GH_TOKEN`,
   `GITHUB_TOKEN`), Project, profile, Machine или файл — никогда token. Угроза, для которой нужны права самого
   пользователя или его агента, только описывается (правило соразмерности владельца 2026-11-07).

**Последствия.** Новая строка Health check — это id в `checkIdSchema` и строка в таблице `severity.ts`; фича, которая
о ней сообщает, зовёт `reportFailure` и `reportOk`, а не пишет в log. Строки, которые рождает только сообщение, имеют
заголовок и группу из `REPORTED_ROWS`. Порядок строк в First run и в Settings → Health — по уровню: сначала critical не
в `ok`, затем остальные не в `ok`, затем `ok` (`FirstRunChecks.tsx`, `checkBlocks`, `rowRank`). Страницы Feature —
`docs/features/onboarding.md` (First run), `app-shell.md` (кнопка), `gate-and-github.md` (GitHub access).

## Considered Options

- **Toast или системное уведомление о новой critical-строке.** Отвергнуто владельцем (Q9): о поломке говорят только
  точка иконки и строка на месте сбоя.
- **Проверять по таймеру, опрашивать сеть каждые N секунд.** Отвергнуто владельцем (Q8): проверки идут на старте, в
  Settings → Health, по «Check again», по сообщениям фич и при фокусе окна для строк не в `ok`.
- **Считать `unknown` (нет сети, timeout, GitHub 5xx) поломкой своего уровня.** Отвергнуто владельцем (Q2):
  `unknown` никогда не critical, tooltip иконки говорит «Couldn't check: <reason>».
- **Открывать First run на новой поломке строки Project-а или строки из сообщения фичи.** Отвергнуто владельцем (Q7):
  First run — окно первой настройки Machine, о поломке после неё говорит иконка; сетевые строки, кроме того,
  задержали бы старт.

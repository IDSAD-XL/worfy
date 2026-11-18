# worfy-auth-check: Health check проверяет входы и настройку, чинит обратимое и говорит, что сделать человеку; иконка на rail sidebar

Status: принят владельцем 2026-11-18 («на все да»: Q1–Q11 grilling-а, раздел «Решения владельца»)
Critic: [Split](../../docs/product/critic/worfy-auth-check-2026-11-18.md) — применён: spike и GitHub access разделены на локальную часть и SAML SSO; `opensFirstRun` решает Ticket 03; «Use <login>» пишет через `bin/profile-set`
Source: запрос владельца 2026-11-18: «Давай сделаем проверку на правильность всего что связано с авторизацией, чтобы
это могло починиться либо сказать юзеру, что ему нужно сделать». Два уточнения того же дня: «Где-то в интерфейсе нужна
индикация, всё ли работает и правильно ли сконфижено. Например, слева над Devices в sidebar — иконка. Но нужно разделять
важные ошибки, типа git, и некритические, типа qmd» и «Думаю, можно это всё в Health check и сделать, давай импрувить
эту часть, вместо создания новых вьюшек». Повод — отчёт нового тестера (ниже, «Проблема»). Строки кода сверены с
`a8f1faef5` (2026-11-18).
Depends on: [worfy-pr-inbox](../worfy-pr-inbox/spec.md) (closed: чтение GitHub из main),
[worfy-onboarding](../worfy-onboarding/spec.md) (First run и Settings → Health). ADR
[0009](../../docs/adr/0009-claude-code-login-check-account-info.md) (вход Claude Code через `accountInfo`),
[0020](../../docs/adr/0020-profile-shared-and-personal-parts.md) и
[0042](../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md), пункт 9 (аккаунт GitHub — свойство Project-а,
`GH_TOKEN` из `gh auth token -u`), [0045](../../docs/adr/0045-one-ticket-one-repository.md),
[0048](../../docs/adr/0048-harness-plugin-spike-results.md) (`GH_TOKEN` агенту через `CLAUDE_ENV_FILE`),
[0052](../../docs/adr/0052-machines-and-linking.md), [0057](../../docs/adr/0057-agent-environment-on-windows.md)
(окружение агента на Windows), [0066](../../docs/adr/0066-read-only-access-for-a-linked-machine.md),
[0070](../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md),
[0078](../../docs/adr/0078-browser-node.md), [0089](../../docs/adr/0089-update-builds-main-in-own-clone.md),
[0094](../../docs/adr/0094-vendor-seam.md), [0105](../../docs/adr/0105-pr-reply-only-on-the-users-click.md);
[CONTEXT.md](../../CONTEXT.md) — термины Settings, Machine, Linked machine, Project, Profile, Session, Vendor, PR inbox.
Ticket-ы: Epic `worfy-auth-check`, 10 Ticket-ов в [issues/](issues/).

## Проблема

У нового тестера `GH_TOKEN` выставлен на всю систему через `launchctl setenv`. Токен не авторизован для SAML SSO
организации (единый вход организации GitHub: токен надо отдельно разрешить для неё). gh получает HTTP 403, PR inbox
молча пустой (в snapshot `"pulls": {}`), хотя токен gh из keyring (хранилище паролей системы) видит repo. В Profile
нет `github.account`. Health check при этом зелёный. Человек видит пустой экран без причины.

Это частный случай общей беды: сбой входа или настройки виден только в log, а Health check проверяет не всё.

- **Чей токен у gh.** С `github.account` gh получает `GH_TOKEN` этого аккаунта поверх окружения
  (`src/main/github/prs.ts:172-191`, extra env поверх env в `:125-133`). Без аккаунта — `{}` (`prs.ts:175`), и gh
  идёт с окружением login shell. Login shell стартует с коротким списком переменных `SHELL_BASE_KEYS`, в нём нет
  `GH_TOKEN` (`src/main/agent/env.ts:35`, `:49-56`). Значит, токен `launchctl` доходит до gh иначе: через rc-файл
  shell-а или через путь с `process.env` (`prs.ts:125`, когда `env` не передан). Как именно — не проверено (Ticket 01).
  На Windows окружение строится из registry (ADR-0057), и `setx GH_TOKEN` доходит прямо.
- **PR inbox.** Ошибка gh попадает в `state.error` (`src/main/github/inbox.ts:382`, `:552`) и в строку
  `pr-inbox-error` (`src/renderer/pr-inbox/PrInboxView.tsx:596-598`). Rate limit имеет свой текст (`inbox.ts:639`).
  SSO и SAML не распознаются нигде (grep по `src/` пуст). Поиск идёт одним `gh api graphql` с
  `review-requested:@me` (`inbox.ts:88`). Гипотеза: GitHub отвечает 200 и молча выкидывает PR организации, для
  которой токен не авторизован, — отсюда пустой список без ошибки.
- **PR badges, gate-queue, Flight recorder.** Ошибка только в log, один раз на Project (`src/main/ipc/checks.ts:160-180`;
  `src/main/flight-recorder/github.ts:12-15`).
- **`github.account` пуст или невалиден.** Только `console.warn` (`src/main/workflow/profile.ts:670-694`, `:673`). PR
  inbox и тот не пишет: `log: () => undefined` (`src/main/ipc/pr-inbox.ts:79`).
- **Health check.** Строка `gh-auth` читает `gh auth status` (`src/main/first-run/checks.ts:502-508`) и зелёная, если
  найден хоть один login. Запись токена из окружения gh печатает с пометкой `(GH_TOKEN)`, а без login пропускается
  (`src/main/github/auth-text.ts:12-13`, `:31`). Что gh взял токен из окружения, а не из keyring, строка не говорит.
  Проверок Project-а в Health check нет: он описывает только Machine.
- **Codex.** Нет `GH_TOKEN` для Session — только log (`src/main/vendors/codex/session.ts:936`); app-server не
  стартовал — «не вошёл» в log (`src/main/vendors/codex/account.ts:166`).
- **Прочее.** Сбой `accountAuth` при пробе ревью без текста для человека (`src/main/projects/review-offer.ts:201`).
  Browser отдаёт «sign-in expired» только агенту (`src/main/mcp/browser-server.ts:177`, `:249`). Нечитаемый файл
  секретов Link откладывается в `.unreadable-<time>` (`src/main/link/secrets.ts:33-44`), Linked machine с другим
  сертификатом — chip «Certificate changed» в sidebar (`src/renderer/shell/sidebar/MachinesSection.tsx:97`).

### Что уже есть в Health check

Строки (`src/main/first-run/checks.ts:208-228`), статус `ok | warn | fail` (`src/shared/ipc/first-run.ts:12`), у строки
detail, hint, command и кнопки (`first-run.ts:60-76`, ids кнопок `:52`):

- Claude Code: `claude-login`, `claude-version`, `limits`;
- Windows: `windows`, `arch`, `powershell`;
- Command-line tools: `git`, `git-identity`, `git-bash`, `gh`, `node`, `jq`;
- GitHub: `gh-auth`;
- worfy: `worfy-update`;
- Harness: `harness`, `harness-dependencies`, `harness-scripts`, `legacy-harness`;
- qmd: `qmd`, `qmd-models`, `qmd-collections`.

Как он открывается сейчас: сам при старте, если упала новая проверка (`firstRunStartup`, `first-run.ts:90-100`); в
Settings → Health (`src/renderer/settings/HealthSection.tsx:10-11`, проверяет при открытии, `:22`); в Command palette
строкой «First-run checks», которая открывает окно First run (`src/renderer/palette/commands.ts:357-367`). То есть он
доступен в любой момент, но спрятан: на экране нет знака, что что-то не так.

## Решение

Новых экранов и панелей нет. Всё — улучшение Health check.

1. **Health check проверяет больше.** К строкам Machine добавляются:
   - строка входа Codex;
   - группа Projects: для каждого Project-а этой Machine с origin на GitHub одна строка «GitHub access». Она
     проверяет, что Profile читается, задан ли `github.account`, есть ли у gh login этого аккаунта, чей токен gh
     возьмёт (keyring или переменная окружения — только имя переменной), есть ли доступ к каждому repo и не закрыт ли
     он SSO;
   - строки, которые рождает сбой фичи: Browser profile с истёкшим входом, Linked machine с другим сертификатом или
     нечитаемыми секретами.
2. **У каждой строки — состояние и уровень.** Состояние: `ok | fixable | needs-user | unknown`. Fixable — есть
   безопасная кнопка «Fix», needs-user — точный шаг для человека, unknown — проверить не удалось (нет сети, timeout).
   Уровень из таблицы ниже: critical — без этого не работает основное; non-critical — фича деградирует.
3. **Иконка Health check на rail sidebar** над вкладкой Machines (её владелец назвал «Devices»; вкладка —
   `MachinesSection.tsx:19-21`, `order = 15`, `railEnd`). Иконка — только вход: щелчок открывает Settings → Health
   (`openSettings('HealthSection')`, `src/renderer/settings/settings-window.ts:32`). Цвет — по худшему уровню.
4. **Сбой фичи сразу меняет строку.** PR inbox, PR badges, gate-queue, Flight recorder, Codex, Browser и Link сообщают
   о сбое входа в Health check. Иконка краснеет без нового запроса в сеть. Успешное чтение той же фичи снимает строку.
5. **На месте молчаливых сбоев — одна строка и ссылка.** Причина простыми словами и «Open Health check». Своих панелей
   нет. Места: строка ошибки PR inbox, tooltip PR badge на Ticket Node, `notice` Session Codex.
6. **Command palette.** Строка «Health check» открывает Settings → Health; «First-run checks» остаётся для окна First
   run (Q1).
7. **Токены никогда не логируются и не показываются.** В тексте — login, имя переменной (`GH_TOKEN`, `GITHUB_TOKEN`),
   имя организации и ссылка SSO. Угроза, которой нужны права самого пользователя или его агента, только описывается
   (правило соразмерности владельца 2026-11-07).

### Уровни: проверка → уровень

| Проверка | Уровень | Почему |
|---|---|---|
| `claude-login`, `git`, `node`, `harness`, `harness-scripts` | critical | без них нет Session и скриптов Harness |
| `git-bash`, `powershell` (Windows) | critical | без них нет Bash агента и окружения (ADR-0057) |
| `gh`, `gh-auth` | critical, если у Machine есть Project с origin на GitHub; иначе non-critical | Demo project работает без GitHub |
| GitHub access Project-а: нет login аккаунта, нет доступа, SSO | critical | нет PR, push, PR inbox |
| GitHub access: `github.account` пуст, а токен окружения работает | non-critical, fixable | работает, но держится на чужой переменной |
| `claude-version`, `limits`, `windows`, `arch`, `jq` | non-critical | как сейчас (warn) |
| `git-identity` | non-critical | решение onboarding: только предупреждает (`docs/features/onboarding.md:191`) |
| `worfy-update`, `legacy-harness`, `harness-dependencies` | non-critical | не блокирует работу (`worfy-update` уже не открывает First run) |
| `qmd`, `qmd-models`, `qmd-collections` | non-critical | поиск падает на grep |
| Вход Codex | non-critical | Claude Code — Vendor по умолчанию (ADR-0094); Session Codex говорит сама |
| Browser profile с истёкшим входом | non-critical | деградирует одна проверка агента |
| Linked machine: сертификат, секреты | non-critical | пропадает одна Linked machine |

Цвет иконки: красная точка — есть critical не в `ok`; жёлтая — проблемы только у non-critical; без точки — всё в `ok`;
серое кольцо — первого отчёта ещё нет или идёт «Check again». `unknown` никогда не красит в красный: tooltip
«Couldn't check: <reason>». Сама иконка видна всегда — это вход в Health check.

### Когда проверять

- при старте (как сейчас) и при открытии Settings → Health и «Check again» (как сейчас);
- при фокусе окна worfy — только строки не в `ok`, если последней проверке больше 5 минут (Q8): после авторизации SSO
  в браузере строка сама становится `ok`;
- по событию сбоя от фичи — сразу, без запроса в сеть; затем одна повторная проверка строки этого Project-а, не чаще
  раза в минуту на Project;
- по событию успеха — строка снимается без проверки.

Таймера нет, опроса сети каждые N секунд нет. Toast и системных уведомлений о новой critical-строке нет — только иконка и строка на месте сбоя (Q9). Иконка отражает Machine и все открытые Project-ы (Q4).

### Починка

Без человека — только обратимое и без чужих данных:

- **Предложить `github.account`.** Если в gh ровно один login на хосте origin с push во все repo Project-а — кнопка
  «Use <login>». Push-доступ уже считает диалог Project-а (`src/main/github/accounts.ts:155-210`); запись — одним полем
  через `harness/bin/profile-set --field github.account` (как `src/main/ipc/code-stories-setting.ts:3` и кнопка Allow
  MCP, `src/main/ipc/agent.ts:371`), не через черновик `connect.ts`; `profile-set` делает commit в Harness home
  (`harness/bin/profile-set:46`). Это щелчок, а не тихая запись (Q5).

С человеком: строка даёт шаг и, где можно, кнопку.

| Сбой | Шаг | Кнопка |
|---|---|---|
| SSO | «Authorize the token for <org>» — ссылка из заголовка `X-GitHub-SSO` | Open link (браузер системы) |
| Нет login аккаунта | `gh auth login`, войти как `<login>` | Sign in… (есть, `gh-login`) |
| Токен из окружения не тот | «GH_TOKEN comes from your environment»; варианты: авторизовать его, задать `github.account`, убрать переменную | Use <login>, Copy command |
| Claude Code | `/login` в Terminal Node (как сейчас, `checks.ts:311`) | — |
| Codex | вход Codex | Sign in to Codex… (путь `codex/account.ts:223-229`) |
| Browser profile | войти в Browser этого profile | Open Browser |
| Linked machine | связать заново по коду | Link a machine… |

Переменные окружения пользователя worfy не меняет никогда (`launchctl unsetenv` — только Copy command).

## Как это сделано у конкурентов

Не исследовано. Ближайший известный образец — команды-«doctor» (`brew doctor`, `flutter doctor`): список проверок с
шагом починки. `gh auth status` с 2.40 сам проверяет токен каждого аккаунта (`auth-text.ts:6-13`).

## Истории пользователя

1. Как тестер с `GH_TOKEN` в окружении и SSO-организацией, я вижу красную точку на иконке Health check, а в Health check
   — строку моего Project-а: «GitHub refused: the token from GH_TOKEN is not authorized for <org>», ссылку
   авторизации и кнопку «Use <login>».
2. Как пользователь с пустым PR inbox, я вижу под заголовком строку с причиной и «Open Health check», а не пустой список.
3. Как пользователь, у которого не скачаны модели qmd, я вижу жёлтую точку, а не красную, и могу её игнорировать.
4. Как пользователь, я всегда открываю Health check одним щелчком по иконке на rail или строкой «Health check» в
   Command palette.
5. Как пользователь Codex, при сбое входа я вижу в Session `notice` с причиной и «Open Health check».
6. Как пользователь, я не вижу токенов ни в Health check, ни в log, ни в тексте ошибки.

## Решения по реализации

### 1. Модель строки и сообщения о сбоях (Ticket 03)

- `src/shared/ipc/first-run.ts`: статус `unknown`; поле `severity: 'critical' | 'non-critical'`; поле `project` у
  строки Project-а (id и имя); группа `Projects`; новые ids строк и кнопок. Состояние `fixable | needs-user`
  выводится: есть кнопка с пометкой `safe` — fixable, иначе needs-user.
- Таблица уровней — одна функция в `src/shared/health/severity.ts`, со всеми ids этого Epic-а сразу. Ticket-ы 05, 06 и 08
  её не правят.
- `src/main/first-run/health-reports.ts`: `reportFailure(id, project?, reason, step)` и `reportOk(id, project?)` для
  фич; отчёт Health check сливает строки проверок и сообщения; событие в renderer при изменении. Без Electron —
  contract test-ы.
- First run сам открывается при старте на новой строке в `fail`, если у неё не `opensFirstRun: false`
  (`src/main/ipc/first-run.ts:215`, `src/shared/ipc/first-run.ts:71-75`). Все строки Project-а и все строки из
  сообщений фич ставят `opensFirstRun: false`: окно First run — для первой настройки Machine, о поломке позже говорит
  иконка (Q7). Сетевые строки (`gh api` на repo) не входят в отчёт, по которому решается открытие First run при
  старте: они дописываются в отчёт после, чтобы старт не ждал сети.
- Худший уровень для иконки — чистая функция рядом с таблицей.

### 2. Иконка, palette и вид строк (Ticket 04)

- Кнопка на rail над Machines: `src/renderer/shell/Sidebar.tsx` (вкладки `:158`, Settings `:160`). Не вкладка
  sidebar — она ничего не показывает в sidebar, а открывает Settings → Health. Точка — тот же вид, что у badge rail
  (`Sidebar.tsx:44`, тона `src/renderer/shell/sidebar-scope.ts:106`); жёлтого тона там нет — Ticket берёт его из
  ui-kit (ADR-0106) или добавляет.
- `src/renderer/shell/FirstRunChecks.tsx`: сначала critical не в `ok`, затем non-critical, затем `ok`; метка уровня;
  кнопка Fix.
- `src/renderer/palette/commands.ts`: строка «Health check».
- Функция `openHealthCheck()` в `settings-window.ts` — её берут ссылки Ticket-ов 07 и 08.

### 3. GitHub: источник токена и доступ (Ticket 05), SSO (Ticket 06)

Ticket 05 закрывает случай тестера без ответа про SAML: токен окружения, пустой `github.account`, 401 и 404,
«Use <login>». Ticket 06 добавляет только разбор SSO и `partial-results` и ссылку SSO — на fixtures Ticket-а 02.

- `src/main/github/auth-diagnosis.ts`: чей токен возьмёт gh (имена `GH_TOKEN`, `GITHUB_TOKEN` в окружении gh, запись
  `(GH_TOKEN)` в `gh auth status`); разбор ответа GitHub: `X-GitHub-SSO: required; url=…` → SSO со ссылкой,
  `partial-results; organizations=…` → часть организаций скрыта (Ticket 06), 401 → токен не работает, 404 → нет
  доступа (Ticket 05). Способ разбора SSO (сообщение gh или заголовок через `gh api -i`) решает spike SAML (Ticket 02).
- `gh-auth` (`checks.ts:502-508`) называет источник: «alice (keyring), GH_TOKEN from the environment overrides it».
- Строка GitHub access Project-а: `readGithubAccount` → `accountAuth` → `gh api -i repos/<owner>/<repo>` с тем
  окружением, с которым gh идёт в PR inbox (`src/main/ipc/pr-inbox.ts:73-76`). Кнопка «Use <login>».

### 4. Молчаливые сбои GitHub → Health check (Ticket 07)

- PR inbox: `state.error` с причиной строки GitHub access Project-а; `reportFailure`. Текст причины берётся из строки,
  поэтому SSO-текст появится в PR inbox сам, когда его даст Ticket 06; Ticket 07 его не ждёт.
  `PrInboxView.tsx:596-598` — ссылка «Open Health check».
- PR badges (`src/main/ipc/checks.ts:170-176`), gate-queue (`src/main/github/gate-queue.ts:240`), Flight recorder
  (`flight-recorder/github.ts`), проба ревью (`review-offer.ts:201`), `pr-reply-send.ts`: `reportFailure` вместо или
  рядом с log. Tooltip PR badge (`src/renderer/canvas/badges/ChecksBadges.tsx`) — одна строка и ссылка.
- Нет `github.account` — сообщение один раз на Project (`ipc/pr-inbox.ts:79` перестаёт глотать причину).

### 5. Codex, Browser, Link (Ticket 08)

- Строка входа Codex в своём модуле `src/main/first-run/vendor-checks.ts`, в `checks.ts` — одна строка подключения (чтение аккаунта `codex/account.ts`; app-server не стартовал → `unknown`, не fail).
- Session Codex: `notice` вместо log при отсутствии `GH_TOKEN` (`codex/session.ts:936`), с «Open Health check».
- Browser: `signInExpiry` (`browser-server.ts:177`, `:249`) → `reportFailure` строки этого profile.
- Link: смена сертификата и `.unreadable-<time>` (`link/secrets.ts:33-44`) → строка Linked machine.

### 6. Документы (Ticket 09)

Английские страницы Feature правит Ticket своего поведения (ADR-0088): `onboarding.md`, `app-shell.md`,
`gate-and-github.md`, `pr-inbox.md`, `projects.md`, `vendors.md`, `browser.md`, `link.md`, `storage-and-diagnostics.md`.
Ticket 09 — переводы в `docs/features/ru/`, новый ADR «Health check: уровни строк и сообщения фич о сбоях» (номер
резервирует ship-ticket), Amendment к ADR-0042 пункт 9 (источник токена), термин Health check в
CONTEXT.md.

## Решения по test-ам

- Unit: таблица уровней и худший уровень; разбор `X-GitHub-SSO` и `gh auth status` с записью `(GH_TOKEN)` на fixtures
  из spike-а (scrub: без токенов, организаций и login тестера); слияние сообщений и строк.
- Contract: `health-reports` + отчёт Health check; строка GitHub access на stand-in gh (`WORFY_GH`), сценарии: нет
  аккаунта и один login с push → fixable; SSO 403 → needs-user со ссылкой; 401; 404; `partial-results`.
- Test, что ни одна строка, log и `state.error` не содержат значение токена: stand-in gh печатает известный токен,
  test ищет его во всём выводе.
- e2e: иконка краснеет после SSO-ответа stand-in gh в PR inbox, щелчок открывает Settings → Health со строкой
  Project-а; palette «Health check». Без реальной сети.
- Каждый Ticket гоняет все unit и contract test-ы своего модуля.

## Не в этом Epic-е

- Новые экраны, панели и вкладки sidebar.
- Изменение переменных окружения пользователя (`launchctl`, `setx`) — только Copy command.
- Тексты агенту в Harness: hook `gh-token-env.mjs:66-67` и `harness/bin/preflight:491-510` остаются как есть.
- Update без токена (`src/main/update/github.ts:5-7`) — так и задумано (ADR-0089).
- Проверки Linked machine-ом чужой Machine: Health check описывает свою Machine (`onboarding.md:107`).
- Scope-ы токена (`repo`, `workflow`) сверх доступа к repo — после приёмки, если всплывут.

## Ticket-ы

1. **Spike локальный** — воспроизвести путь `GH_TOKEN` из `launchctl setenv` (macOS) и `setx` (Windows) в gh worfy на
   Mac и PC владельца: rc-файл, `process.env` или иначе; список вызовов `ghRunner` без `env`. Проверить, что
   `gh auth token -u` берёт keyring, а не переменную; ответы 401 и 404. Итог: `.scratch/worfy-auth-check/spike.md` и
   scrubbed fixtures. Blocked by: —.
2. **Spike SAML SSO** — read-only скрипт: REST и `gh api graphql` поиска на организации с SAML, есть ли
   `X-GitHub-SSO` и `partial-results`, что печатает gh. Запускает тот, у кого есть такая организация (Q6); итог —
   раздел в `spike.md` и scrubbed fixtures. Blocked by: —. Ждёт человека: не держит другие Ticket-ы, кроме 06.
3. **Модель Health check** — статус `unknown`, `severity`, строки Project-а, таблица уровней, `health-reports`,
   `opensFirstRun: false` для новых строк, сетевые строки вне решения о First run; событие в renderer; contract
   test-ы. Blocked by: —.
4. **Иконка, palette, вид** — кнопка на rail над Machines, цвет по худшему уровню, `openHealthCheck()`, порядок строк и
   кнопка Fix, строка palette; `app-shell.md`, `onboarding.md`; unit и e2e. Blocked by: 03.
5. **GitHub access** — `auth-diagnosis.ts` без SSO, честный `gh-auth`, строка Project-а с 401 и 404, «Use <login>»
   через `profile-set`; `gate-and-github.md`, `projects.md`. Blocked by: 01, 03.
6. **GitHub SSO** — разбор `X-GitHub-SSO` и `partial-results`, ссылка SSO в строке Project-а; `gate-and-github.md`.
   Blocked by: 02, 05.
7. **Молчаливые сбои GitHub** — PR inbox, PR badges, gate-queue, Flight recorder, проба ревью, pr-reply → Health check;
   строка и ссылка в PR inbox и tooltip badge; `pr-inbox.md`; e2e. Blocked by: 04, 05.
8. **Codex, Browser, Link** — строка входа Codex в своём модуле, `notice` Session Codex, сообщения Browser и Link;
   `vendors.md`, `browser.md`, `link.md`, `storage-and-diagnostics.md`. Blocked by: 04 (`openHealthCheck`), 05 (строка
   подключения в `checks.ts`).
9. **Документы** — ru-переводы, ADR, Amendment к ADR-0042. Blocked by: 01, 03, 04, 05, 07, 08; SSO-часть дописывается после 06.
10. **Приёмка владельцем** — на Mac и PC: токен окружения, нет `github.account`, нет моделей qmd, Codex без входа;
    цвет иконки, шаги и Fix; SSO — если 06 готов, иначе отдельной приёмкой после него. Blocked by: 01, 03–05, 07–09.

## Волны

| Wave | Ticket-ы | Blocked by | Почему так |
|---|---|---|---|
| 1 | 01, 02, 03 | — | spike-и пишут только в `.scratch/worfy-auth-check/` (разные разделы `spike.md`: 02 пишет в свой файл `spike-saml.md`); модель — `src/shared/ipc/first-run.ts`, `src/shared/health/`, `src/main/first-run/health-reports.ts`, `src/main/ipc/first-run.ts` |
| 2 | 04, 05 | 04 — 03; 05 — 01, 03 | renderer (`Sidebar.tsx`, `FirstRunChecks.tsx`, `settings-window.ts`, `commands.ts`) и main GitHub (`auth-diagnosis.ts`, `checks.ts`, `auth-text.ts`, `profile-set`): общих файлов нет. После Wave 2 случай тестера закрыт |
| 3 | 07, 08 | 07 — 04, 05; 08 — 04, 05 | 07 — `inbox.ts`, `ipc/checks.ts`, `gate-queue.ts`, Flight recorder, `PrInboxView.tsx`, `ChecksBadges.tsx`; 08 — `vendors/codex/`, `vendor-checks.ts`, `browser-server.ts`, `link/`: общих файлов нет |
| 4 | 09 | 01, 03, 04, 05, 07, 08 | документы по сделанному |
| 5 | 10 | 01, 03–05, 07–09 | приёмка |
| когда придёт ответ | 06 | 02, 05 | SSO; правит `auth-diagnosis.ts` и `checks.ts` — не в одной Wave с 05 |

Wave вычисляется заново в момент запуска (CONTEXT.md, термин Wave); таблица — прогноз. Пересечение с открытыми
Ticket-ами `worfy-pr-follow` 04 (`PrInboxView.tsx`) и 05 (`palette/commands.ts`): Ticket-ы 04 и 07 этого Epic-а не
стартуют, пока те не слиты.

## Риски

- **Гипотеза о GraphQL не подтвердится.** Если поиск отвечает 200 без заголовка, PR inbox не отличит «нет PR» от
  «скрыто SSO». Мера: строка Project-а проверяет каждый repo через REST, где 403 с `X-GitHub-SSO` документирован;
  spike SAML (Ticket 02) решает до Ticket-а 06.
- **Нет организации с SAML для spike-а.** SAML SSO есть только у GitHub Enterprise Cloud; скрипт запускает тестер (Q6).
- **Ложная красная точка.** Нет сети, timeout, GitHub 5xx — это `unknown`, не critical; повтор не чаще раза в минуту.
- **Запросы к GitHub.** Строка Project-а — `gh api` на каждый repo при старте и открытии Health check. Для 10 Project-ов
  по 2 repo — 20 вызовов из 5000 в час; rate limit PR inbox (`inbox.ts:639`) учитывает их же.
- **Токен в выводе.** gh не печатает токен в ошибках, `gh api -i` показывает заголовки ответа, а не запроса. Test из
  «Решений по test-ам» ловит утечку. Ссылка SSO — не секрет, но в log не пишется.
- **Общий `checks.ts`.** Его правят 03, 05, 06 и строкой подключения 08 — поэтому они в разных Wave или идут друг за другом.

## Решения владельца

Grilling 2026-11-18, ответ «на все да» — все рекомендации приняты.

1. **Q1 — термин.** «Health check»: tooltip иконки, раздел Settings и строка palette. «First-run checks» — только окно
   First run. Термин записан в CONTEXT.md. Раздел rail называется Machines (в запросе — «Devices»).
2. **Q2 — уровни.** Списки critical и non-critical — как в «Уровни»; `unknown` (нет сети, timeout, GitHub 5xx) никогда
   не critical.
3. **Q3 — иконка.** Красная — critical не в `ok`; жёлтая — только non-critical; без точки — всё `ok`; серое кольцо — до
   первого отчёта. Жёлтую показываем.
4. **Q4 — охват.** Иконка — Machine и все открытые Project-ы; строки Health check сгруппированы по Project-ам.
5. **Q5 — токен окружения не работает, `github.account` пуст.** «Use <login>» пишет `github.account` по щелчку через
   `profile-set`. Тихого перехода на keyring нет.
6. **Q6 — SSO.** Read-only скрипт Ticket-а 02 запускает тестер и присылает scrubbed вывод; скрипт готовит orchestrator,
   владелец передаёт. Ticket 06 ждёт ответа, остальные — нет.
7. **Q7 — First run.** Новые строки ставят `opensFirstRun: false`; о поломке после первой настройки говорит иконка.
8. **Q8 — когда проверять.** Старт, Settings → Health, «Check again», события сбоя и успеха фич; при фокусе окна —
   строки не в `ok`, если проверке больше 5 минут. Таймера нет.
9. **Q9 — оповещения.** Ни toast, ни системного уведомления — только иконка и строка на месте сбоя.
10. **Q10 — git identity.** Non-critical; шаг строки говорит, что commit-ы не пройдут.
11. **Q11 — Codex.** Всегда non-critical; Session Codex сама говорит о сбое (Ticket 08).

## Готово, когда

- [ ] На rail над Machines — иконка Health check; красная при critical, жёлтая при non-critical, без точки при `ok`,
      серая до первого отчёта; щелчок открывает Settings → Health.
- [ ] Health check показывает строку GitHub access каждого Project-а с origin на GitHub: источник токена (имя
      переменной, не значение), доступ к repo, SSO со ссылкой; «Use <login>», когда login один и с push.
- [ ] `gh-auth` честно говорит, что gh берёт токен из окружения.
- [ ] SSO-отказ в PR inbox меняет иконку сразу; в PR inbox — строка причины и «Open Health check»; то же в tooltip PR
      badge и в `notice` Session Codex.
- [ ] Строки входа Codex, Browser profile и Linked machine появляются и снимаются по событиям.
- [ ] qmd без моделей не красит иконку в красный.
- [ ] Command palette «Health check» открывает Settings → Health.
- [ ] Ни строка, ни log, ни ошибка не содержат токен (test).
- [ ] ru-переводы, ADR, Amendment к ADR-0042 и термин в CONTEXT.md влиты.
- [ ] (вручную) Владелец принял на Mac и PC.

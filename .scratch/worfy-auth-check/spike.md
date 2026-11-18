# worfy-auth-check — spike

Ticket 01 пишет раздел «Локальный путь токена». Раздел SAML SSO — в `spike-saml.md` (Ticket 02).

## Локальный путь токена

Дата: 2026-11-18. gh 2.97.0 (2026-07-31), Node 24.19.0, macOS 26 (Darwin 25.6). worfy — `origin/main` 7aadf9f75.

### Как воспроизведено и чего не делали

Persistent-переменные не ставились: ни `launchctl setenv`, ни `setx`, ни правок rc-файлов, ни `gh auth login/logout/switch`,
ни записи в keyring. Тестовый токен не выпускался: «плохой» токен — строка формы `ghp_…` из 40 символов, которую GitHub
никогда не выдавал, «рабочий» — токен keyring аккаунта Profile-а, переданный в `GH_TOKEN` одного дочернего процесса.
Каждый `GH_TOKEN` жил только в окружении одного дочернего процесса. Запросы к GitHub — только GET.

Что делает `launchctl setenv` в GUI-приложении, установлено по документации и коду, а не на живом launchd:
- `man launchctl`, `setenv`: «Specify an environment variable to be set on all future processes launched by launchd in the
  caller's context». worfy, запущенный из Finder или Dock, — процесс launchd, и переменная лежит в его `process.env`.
- Опыт заменяет это одним присваиванием: `source = { ...process.env, GH_TOKEN: <плохой> }` для функций worfy и
  `process.env.GH_TOKEN = <плохой>` для `ghRunner({})`.

Probe — [`fixtures/local/probe.mjs`](fixtures/local/probe.mjs). Он зовёт настоящие `captureLoginShellEnv`,
`captureWindowsEnv`, `ghRunner`, `accountAuth`, `ghAccounts` и `parseAuthText`, собранные esbuild-ом из
`src/main/agent/env.ts`, `src/main/github/prs.ts` и `src/main/github/auth-text.ts`. Запуск на Mac:

```sh
B=$(mktemp -d); E=node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild
for m in agent/env github/prs github/auth-text; do "$E" "src/main/$m.ts" --bundle --platform=node --format=esm --outfile="$B/$(basename $m).mjs" --log-level=warning; done
node .scratch/worfy-auth-check/fixtures/local/probe.mjs "$B" .scratch/worfy-auth-check/fixtures/local
```

Вывод запуска на Mac (logins уже заменены: active-аккаунт keyring — `alice`, второй — `bob`):

```text
G0 platform, gh: darwin, gh version 2.97.0 (2026-07-31)
G0 logins of gh (scrubbed): alice, bob
G1 gh auth token -u <login>, no GH_TOKEN: len=40 prefix=gho_
G2 gh auth token -u <login>, GH_TOKEN=fake: exit=0 len=40 prefix=gho_ equals-keyring=true equals-GH_TOKEN=false
G3 gh auth token, GH_TOKEN=fake: exit=0 len=40 prefix=ghp_ equals-keyring=false equals-GH_TOKEN=true
G4 gh auth token -u <login>, GH_TOKEN=fake, empty GH_CONFIG_DIR: exit=0 len=40 prefix=gho_ equals-keyring=true equals-GH_TOKEN=false
G5 gh auth token -u <unknown>, empty GH_CONFIG_DIR: exit=1
G6 gh auth status auth-status-keyring: exit=0 stream=stdout Health check rows (ghAccounts)=["github.com: alice","github.com: bob"] parsed=["alice:success:true","bob:success:false"]
G6 gh auth status auth-status-gh-token-valid: exit=0 stream=stdout Health check rows (ghAccounts)=["github.com: alice","github.com: bob","github.com: alice"] parsed=["alice:success:true","bob:success:false","alice:success:false"]
G6 gh auth status auth-status-gh-token-invalid: exit=1 stream=stderr Health check rows (ghAccounts)=["github.com: bob","github.com: alice"] parsed=["bob:success:false","alice:success:false"]
G6 gh auth status auth-status-gh-token-invalid-no-login: exit=1 stream=stderr Health check rows (ghAccounts)=[] parsed=[]
G6 gh auth status auth-status-no-login: exit=1 stream=stderr Health check rows (ghAccounts)=[] parsed=[]
G7 gh api -i repos/<public repo>, GH_TOKEN=fake: exit=1
G8 gh api -i repos/<missing repo>, working GH_TOKEN: exit=1
G9 gh api -i repos/<public repo>, no token, empty GH_CONFIG_DIR: exit=4
G10 gh api user --jq .login, GH_TOKEN=fake: exit=1
M1 login shell, real HOME, GH_TOKEN in process.env: from=login-shell no GH_TOKEN
M2 login shell, HOME whose .zshrc exports GH_TOKEN: from=login-shell GH_TOKEN = the stand-in value
M3 login shell, HOME without rc files: from=login-shell no GH_TOKEN
M4 ghRunner({env: login shell M1}): alice (the account of the keyring)
M5 ghRunner({}): process.env with GH_TOKEN: rejected: gh: Bad credentials (HTTP 401)
M6 ghRunner({env: login shell M2}): rejected: gh: Bad credentials (HTTP 401)
M7 accountAuth, runner env has a bad GH_TOKEN: returned len=40 prefix=gho_ equals-keyring=true equals-env=false
M8 the same runner with the extra env of M7: alice (the account of the keyring)
M9 accountAuth without an account: extra=[], gh then: rejected: gh: Bad credentials (HTTP 401)
M10 accountAuth, login shell of another HOME (M2): rejected: no gh login for alice, the Project's GitHub account: no oauth token found for github.com account alice; run `gh auth login` and sign in as alice
```

### macOS: как `GH_TOKEN` доходит до gh worfy

1. `launchctl setenv GH_TOKEN …` кладёт переменную в `process.env` worfy, запущенного после этого из Finder или Dock
   (`man launchctl`, `setenv`).
2. Login shell worfy её не видит. `captureLoginShellEnv` запускает `$SHELL -ilc` с `env: base`
   (`src/main/agent/env.ts:156`), а `base` — только `PATH=/usr/bin:/bin:/usr/sbin:/sbin` и `SHELL_BASE_KEYS`
   (`env.ts:35`, `shellBaseEnv` — `env.ts:49-56`). `GH_TOKEN` в этом списке нет. Опыт: M1 и M3 — `no GH_TOKEN`.
3. Rc-файл возвращает переменную. zsh с `-i -l` читает `/etc/zshenv`, `~/.zshenv`, `/etc/zprofile`, `~/.zprofile`,
   `~/.zshrc`, `~/.zlogin` (`man zsh`, STARTUP/SHUTDOWN FILES). Строка `export GH_TOKEN=…` в любом из них, или
   `export GH_TOKEN=$(launchctl getenv GH_TOKEN)`, кладёт токен в окружение агента. Опыт: M2 — `.zshrc` с
   `export GH_TOKEN=…` даёт `GH_TOKEN = the stand-in value`.
4. Все вызовы gh worfy в app-сборке идут с окружением login shell (таблица ниже). Поэтому без rc-файла токен из
   `launchctl setenv` не доходит ни до PR inbox, ни до PR badges, ни до Health check, ни до `ipc/projects.ts`. Опыт:
   M4 — gh отвечает от аккаунта keyring, хотя в `process.env` лежит плохой токен.
5. С rc-файлом токен доходит до всех них, и gh берёт его вместо keyring (`gh help environment`: `GH_TOKEN` «takes
   precedence over previously stored credentials»). Опыт: M6 — 401 с плохим токеном из `.zshrc`.
6. Исключение — Codex Session. Процесс `codex app-server` получает `process.env` самого worfy, а не login shell:
   `withGhToken(options.env ?? process.env, token)` (`src/main/vendors/codex/session.ts:938`), и `appServerOptions`
   не задаёт `env` (`session.ts:1011-1020`). Токен из `launchctl setenv` доходит до процесса Codex и его shell-ов без
   rc-файла в двух случаях: в Profile нет аккаунта, или у аккаунта нет входа в gh. Во втором `accountAuth` бросает
   ошибку, Session пишет её в log и стартует с `token = null` (`session.ts:931-938`). Опыт M5 показывает то же для
   `ghRunner({})`, который берёт `process.env`. Дойдёт ли он до команды внутри Codex, решают ещё правила
   `shell_environment_policy` самого Codex. Это здесь не проверено.
7. Аккаунт Profile-а перекрывает `GH_TOKEN` окружения, но только у вызовов, которые зовут `accountAuth`: PR inbox,
   gate-queue, PR badges, review-offer probe, токен для Codex Session (таблица ниже). `accountAuth` берёт
   `gh auth token -u <account>` и отдаёт `{ GH_TOKEN }` (`src/main/github/prs.ts:172-189`). `ghRunner` кладёт его поверх
   env (`prs.ts:133`: `{ ...env, ...extra, … }`). Опыт: M7 — с плохим `GH_TOKEN` в env `accountAuth` вернул токен
   keyring; M8 — gh с ним отвечает от `alice`. Без аккаунта extra пустой (M9, `prs.ts:175`), и gh идёт с тем
   `GH_TOKEN`, который принесло env. Health check (`gh auth status`, `first-run/checks.ts:502-505`) и Add project
   (`ipc/projects.ts:139-149`, `ghRunner(appGh())` без `accountAuth`) аккаунт не берут. У них `GH_TOKEN` из rc-файла
   побеждает даже при заданном `github.account`.

Ответ на вопрос «как у тестера токен из `launchctl setenv` доходит до gh»: только тремя путями. Первый — rc-файл
экспортирует его. Второй — Codex Session без аккаунта в Profile или без входа gh для него. Третий — worfy запущен не из Finder, а из terminal,
где переменная уже есть. Но и тогда login shell начинается с `SHELL_BASE_KEYS`, так что третий путь сводится к
Codex. Других путей в коде нет. На этой Mac ни один rc-файл (`~/.zprofile`, `~/.zshrc`) не упоминает `GH_TOKEN`,
`GITHUB_TOKEN` или `launchctl` (`grep -c` — 0), и `launchctl getenv GH_TOKEN` пуст (проверена только длина).

Попутно (M10): `gh auth token -u` в login shell с другим `HOME` не находит токен keyring. Без hosts.yml в
`$HOME/.config/gh` gh не знает аккаунт, а keychain macOS ищется через `HOME` пользователя. Ответ —
`no oauth token found for github.com account alice`, exit 1. Тот же текст даёт неизвестный аккаунт (G5).

### Windows: как доходит `setx GH_TOKEN`

Установлено по коду worfy и документации Microsoft. Живых запусков на ПК в этой Session нет: ПК недоступен.

1. `setx GH_TOKEN <value>` пишет `REG_SZ` в `HKCU\Environment` (с `/m` — в
   `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment`). Уже запущенные процессы переменную не видят,
   её получают только новые («This command writes variables to the master environment in the registry. Variables set with setx variables are available in future command windows only, not in the current command window»,
   <https://learn.microsoft.com/windows-server/administration/windows-commands/setx>).
2. worfy не берёт окружение агента из своего процесса. `captureWindowsEnv` (`src/main/agent/env.ts:583`) строит его
   так, как это делает новый вход в систему. Берутся session-переменные из `WINDOWS_SESSION_VARS` (`env.ts:222`), а
   поверх — значения обоих ключей `PERSISTENT_ENV_KEYS` (`env.ts:199`, сначала machine, потом user), прочитанные через
   PowerShell (ADR-0057). `GH_TOKEN` из `HKCU\Environment` попадает в окружение агента прямо, без rc-файла и без
   перезапуска Explorer.
3. `GH_TOKEN`, который есть только в процессе worfy (например, от родительской Claude Code Session), в окружение
   агента не попадает. Если registry не прочитался (fallback), в окружении остаются только session-переменные и Path.
   Опыт probe с подставленным registry, на Mac, вызывает тот же код `captureWindowsEnv`, что и на ПК:
   - W1 — `GH_TOKEN` в `HKCU\Environment` → `GH_TOKEN = the stand-in value`;
   - W2 — только в процессе → `no GH_TOKEN`;
   - W3 — fallback → `no GH_TOKEN`.
4. Окружение снимается один раз за запуск worfy и заново — по `recaptureAgentEnv` (`env.ts:677`). Повторно его
   снимают открытие First run, «Check again», показ Settings → Health и Update build. Поэтому `setx` после запуска
   worfy доходит до gh после такого повтора или после перезапуска. Так же и на Mac работает правка rc-файла.
5. Git Bash. worfy на Windows не запускает login shell для своего окружения. Claude Code запускает Git Bash
   (`CLAUDE_CODE_GIT_BASH_PATH`) для Bash tool с окружением агента. `bash -l` Git for Windows читает `/etc/profile`,
   который `GH_TOKEN` не трогает. Поэтому переменная из registry видна и в Bash tool. Это вывод по коду, его
   проверяет W8 скрипта ниже.
6. Codex Session на ПК так же получает `process.env` worfy (`session.ts:938`). `GH_TOKEN` в нём есть, если worfy
   запущен после `setx` (Explorer перечитывает окружение по `WM_SETTINGCHANGE`, который шлёт `setx`). Это не
   проверено.
7. Аккаунт Profile-а перекрывает `GH_TOKEN` из registry так же, как на Mac, и у тех же вызовов: это тот же код
   `accountAuth` и `ghRunner`. Health check и Add project аккаунт не берут, и `GH_TOKEN` из registry побеждает у них
   при любом `github.account`.

### Таблица: вызовы `ghRunner` и `runGh`

«Окружение» — то, что получает gh в app-сборке, без `WORFY_GH`. С `WORFY_GH` (stand-in gh в test-ах) вызовы через
`ghRunner` берут `process.env` worfy. Health check и тогда кладёт значения login shell поверх своих: `runGh` собирает
`{ ...own, ...deps.env }` (`first-run/checks.ts:365`). «Кто побеждает» — чей `GH_TOKEN` получает gh: с `github.account`
в Profile и без него. «Env» — `GH_TOKEN` окружения агента (Mac — из rc-файла, ПК — из registry), иначе keyring.

| Вызов | Где | Окружение gh | С `github.account` | Без `github.account` | `launchctl setenv` (Mac) | `setx` (ПК) |
|---|---|---|---|---|---|---|
| PR inbox | `src/main/ipc/pr-inbox.ts:73-76` | `agentEnv()` — login shell / registry | аккаунт (`accountAuth`, `github/inbox.ts:501`) | env | только через rc-файл | да |
| gate-queue | `src/main/ipc/gate-queue.ts:34` | `agentEnv()` | аккаунт (`github/gate-queue.ts:241`) | env | только через rc-файл | да |
| PR badges (`PrTracker`) | `src/main/ipc/checks.ts:166`, `appPrOptions` `:197-201`, `:205` | `loginEnv` = `agentEnv()` | аккаунт (`checks.ts:179`) | env | только через rc-файл | да |
| review-offer probe | `src/main/ipc/projects.ts:172-178` | `agentEnv()` | аккаунт (`accountAuth`) | env (extra `{}`) | только через rc-файл | да |
| Codex: токен для Session | `src/main/vendors/codex/session.ts:1028-1039` | `agentEnv()` | аккаунт (`accountAuth`) | — (токена нет) | только через rc-файл | да |
| Codex: процесс app-server | `src/main/vendors/codex/session.ts:931-938`, `:1011-1020` | `process.env` worfy | аккаунт (`withGhToken`, `:133-139`); **без входа gh для аккаунта — env** | env | **да, без rc-файла** | да, если worfy запущен после `setx` |
| Add project (`ProjectConnector.gh`) | `src/main/ipc/projects.ts:139-149` | `agentEnv()` | **env** — аккаунт не берётся | env | только через rc-файл | да |
| Health check: `gh --version`, `gh auth status` | `src/main/first-run/checks.ts:359-366`, `:370`, `:502-505`; env — `ipc/first-run.ts:91`, `:100` | `deps.env` = `agentEnv()` | **env** — аккаунт не берётся | env | только через rc-файл | да |
| `ghRunner({})` без `env` | `src/main/github/prs.ts:125` | `process.env` | — | `process.env` | да | да |

В app-сборке `ghRunner({})` без `env` никто не зовёт: каждый вызов выше передаёт `env`.

### `gh auth token -u` при заданном `GH_TOKEN`

Ответ: **да, keyring**. С `-u <login>` gh печатает токен keyring этого аккаунта, а не `GH_TOKEN`. Без `-u` gh печатает
`GH_TOKEN`.
- Mac, опыт: G2 — `equals-keyring=true equals-GH_TOKEN=false`; G3 (без `-u`) — `equals-GH_TOKEN=true`. G4 — то же
  и с пустым `GH_CONFIG_DIR`: keyring ищется по имени `gh:github.com` и login, без hosts.yml.
- Код gh v2.97.0: `tokenRun` с `Username` зовёт `authCfg.TokenForUser` (`pkg/cmd/auth/token/token.go:80-84`), а он
  читает `keyring.Get("gh:"+hostname, user)`, потом `oauth_token` из hosts.yml, но не env
  (`internal/config/config.go:502-512`). Без `-u` — `ActiveToken` → `TokenFromEnvOrConfig` (`config.go:237-241`).
- Windows: тот же Go-код, keyring там — Windows Credential Manager. Ответ тот же по коду; живая проверка — G2/G3
  скрипта ниже на ПК.

Следствие для Ticket-а 05: `accountAuth` всегда отдаёт токен keyring аккаунта Profile-а, и чужой `GH_TOKEN` в
окружении на него не влияет.

### Ответы GitHub: 401, 404, нет входа

Fixtures — [`fixtures/local/`](fixtures/local/), по три файла на случай: `<case>.stdout`, `<case>.stderr`, `<case>.exit`.

| Случай | Fixture | exit | stdout | stderr |
|---|---|---|---|---|
| `gh api -i repos/…` с неверным токеном | `api-401` | 1 | `HTTP/2.0 401 Unauthorized`, заголовки, тело `{"message": "Bad credentials", …, "status": "401"}` | `gh: Bad credentials (HTTP 401)` |
| `gh api -i repos/<нет такого>` с рабочим токеном | `api-404` | 1 | `HTTP/2.0 404 Not Found`, заголовки с `X-Oauth-Scopes`, `X-Accepted-Oauth-Scopes: repo`, тело `{"message":"Not Found", …}` | `gh: Not Found (HTTP 404)` |
| `gh api user --jq .login` с неверным токеном | `api-jq-401` | 1 | тело ошибки JSON целиком — `--jq` к нему не применяется | `gh: Bad credentials (HTTP 401)` |
| `gh api` без токена и без входа | `api-no-auth` | 4 | пусто | `To get started with GitHub CLI, please run:  gh auth login` и строка про `GH_TOKEN` |
| `gh auth token -u <нет входа>` | `auth-token-user-no-login` | 1 | пусто | `no oauth token found for github.com account carol` |

- Exit 4 — «command requires authentication» (`gh help exit-codes`); любой ответ HTTP с ошибкой — exit 1.
- Для 404 GitHub не отличает «repo нет» от «repo private, а доступа нет». Документация, раздел «`404 Not Found` for an existing resource»:
  для private-ресурса без нужного входа «GitHub uses a `404 Not Found` response instead of a `403 Forbidden` response»
  (<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api>). Опыт шёл на repo, которого нет.
  Отдельный случай «repo private, а доступа нет» не воспроизведён, у владельца нет такого repo для GET.
- 401 получен с токеном, который GitHub не выпускал. Отозванный токен не проверен: тестовый токен не создавался.
  Что ответ на отозванный тот же `Bad credentials`, — допущение, не опыт.
- В заголовках 404 есть `X-GitHub-SSO` только в `Access-Control-Expose-Headers`, своего значения нет: SAML — Ticket 02.

### `gh auth status` с `(GH_TOKEN)`

| Fixture | Окружение | exit | Поток | Что видит Health check (`ghAccounts`) |
|---|---|---|---|---|
| `auth-status-keyring` | без `GH_TOKEN` | 0 | stdout | `alice`, `bob` |
| `auth-status-gh-token-valid` | рабочий `GH_TOKEN` | 0 | stdout | `alice` (`GH_TOKEN`, active), `bob`, `alice` (keyring) — alice дважды |
| `auth-status-gh-token-invalid` | неверный `GH_TOKEN` | 1 | **stderr** | `bob`, `alice` — строка `ok`, хотя active-токен неверный |
| `auth-status-gh-token-invalid-no-login` | неверный `GH_TOKEN`, пустой `GH_CONFIG_DIR` | 1 | stderr | ничего — строка `fail` |
| `auth-status-no-login` | ни токена, ни входа | 1 | stderr | ничего — строка `fail` |

- С неверным `GH_TOKEN` gh печатает `X Failed to log in to github.com using token (GH_TOKEN)`, `- Active account: true`
  и `- The token in GH_TOKEN is invalid.`. Login в этой записи нет. Когда хоть одна запись провалена, gh пишет весь
  отчёт в stderr и выходит с 1.
- Health check читает stdout и stderr вместе (`first-run/checks.ts:505`) и считает строку `ok` по любому аккаунту в
  `success` (`github/auth-text.ts:62-66`). Значит, сегодня неверный `GH_TOKEN` в окружении при живом входе в keyring
  даёт зелёную строку gh. А каждый вызов gh без аккаунта Profile-а при этом получает 401. Это вход для Ticket-а 03.
- Exit code `gh auth status` Health check не читает. Exit 1 — единственный признак, отличающий
  `auth-status-gh-token-invalid` от `auth-status-keyring`, кроме текста.

### Что это значит для Ticket-а 05 («чей токен возьмёт gh»)

По коду порядок такой, на обеих Machine. Кто побеждает у каждого вызова — в таблице выше.
1. Вызовы с `accountAuth` (PR inbox, gate-queue, PR badges, review-offer probe, токен для Codex Session), в Profile
   задан аккаунт → `GH_TOKEN` из `gh auth token -u <account>`, то есть токен keyring. Он перекрывает `GH_TOKEN`
   окружения. Нет входа gh для аккаунта → эти чтения падают с причиной, называющей аккаунт.
2. Аккаунта нет, `GH_TOKEN` есть в окружении агента → gh берёт его, а не keyring. На Mac он попадает туда только из
   rc-файла, на ПК — из registry (`setx`).
3. Аккаунта нет, `GH_TOKEN` нет → active-аккаунт keyring.
4. Исключения из пункта 1 — у них `GH_TOKEN` окружения побеждает при любом `github.account`:
   - Health check, строка gh (`gh auth status`, `first-run/checks.ts:502-505`): аккаунт не берётся. Ticket 05 должен
     назвать источник токена именно для этого случая.
   - Add project (`ipc/projects.ts:139-149`): `ghRunner(appGh())` без `accountAuth`.
   - Codex app-server: берёт `process.env` worfy (на Mac — `launchctl setenv` без rc-файла). Аккаунт его перекрывает,
     только если у аккаунта есть вход gh. Без входа `accountAuth` бросает ошибку, и процесс стартует с `process.env`
     как есть (`session.ts:931-938`).

Сделать вывод Ticket-а 05 без ПК можно надёжно. Windows-часть держится на коде worfy (`captureWindowsEnv`, тот же
`ghRunner` и `accountAuth`) и на кросс-платформенном коде gh. Живая проверка на ПК её подтверждает, но не меняет
модель. Две вещи код не доказывает, и их проверяет скрипт: что PowerShell-чтение registry правда отдаёт
`GH_TOKEN` (W4) и что `-u` на Windows берёт Credential Manager (G2).

### Скрипт для ПК

Read-only, для Session ПК (приёмка, Ticket 10). Он не ставит `setx`, не пишет в registry и не меняет вход gh.
Вместо `setx` W1 подставляет registry (stand-in), а W4 читает настоящий registry (только чтение). Запуск —
в Windows PowerShell, из checkout-а worfy с `node_modules`, на ветке этого Ticket-а или на `main` после merge:

```powershell
$B = Join-Path $env:TEMP ("auth01-bundle-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$O = Join-Path $env:TEMP ("auth01-out-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $B, $O | Out-Null
$E = (Get-ChildItem node_modules\.pnpm -Directory -Filter 'esbuild@*' | Select-Object -First 1).FullName + '\node_modules\esbuild\bin\esbuild'
foreach ($m in 'agent/env', 'github/prs', 'github/auth-text') {
  node $E "src/main/$m.ts" --bundle --platform=node --format=esm "--outfile=$B\$(Split-Path $m -Leaf).mjs" --log-level=warning
}
node .scratch\worfy-auth-check\fixtures\local\probe.mjs $B $O
"exit=$LASTEXITCODE out=$O"
```

Probe печатает строки G0–G10 и W1–W8. Каждая — признак, длина или префикс, но не значение токена. Scrubbed-вывод gh
лежит в `$O`. Ждём на ПК:
- G2 `equals-keyring=true`;
- G3 `equals-GH_TOKEN=true`;
- G6 — те же exit, поток и строки Health check, что на Mac;
- W1 `GH_TOKEN = the stand-in value`, W2 и W3 `no GH_TOKEN`;
- W4 — `absent`, если на ПК нет `setx GH_TOKEN`;
- W7 — `alice`;
- W8 `same`.

Если владелец решит проверить настоящий `setx`: `setx GH_TOKEN <токен только на чтение>`, перезапуск worfy,
снова probe (W4 должен стать `present`). Потом `reg delete HKCU\Environment /v GH_TOKEN /f`, отзыв токена на GitHub и
перезапуск worfy. Это меняет окружение всех новых процессов ПК — только с согласия владельца.

### Итог

- macOS: токен из `launchctl setenv` доходит до gh worfy только через rc-файл, который его экспортирует. Исключение —
  Codex app-server: он берёт `process.env` worfy. Аккаунт Profile-а перекрывает env-токен у вызовов с `accountAuth`.
  У Health check и Add project аккаунт не берётся, у Codex app-server — не берётся без входа gh для аккаунта.
  Доказательство — probe M1–M10 и таблица вызовов.
- Windows: `setx GH_TOKEN` доходит до всех вызовов gh через чтение registry в `captureWindowsEnv`. Доказано кодом и
  probe W1–W3 с подставленным registry. Живых запусков на ПК нет.
- `gh auth token -u <login>` при заданном `GH_TOKEN` берёт keyring: Mac — опыт G2; Windows — по коду gh v2.97.0.
- Fixtures 401, 404, «нет входа» и `gh auth status` с `(GH_TOKEN)` — в `fixtures/local/`.
- Тестовые токены не выпускались и не отзывались. Переменные не ставились, снимать нечего: `launchctl setenv` и
  `setx` не вызывались, `launchctl getenv GH_TOKEN` пуст.
- Решение без владельца: Ticket закрывается на доказательствах с Mac и чтении кода. Ticket требует «вывод запусков на
  ПК» и живой `launchctl setenv` с тестовым токеном. Вместо этого подставлены дочерние процессы: brief Session
  запрещает менять окружение машины владельца.
- Открыто для ПК — запуск «Скрипта для ПК» выше. Пункт про этот запуск добавлен в приёмку, Ticket 10, этим же PR.
  - «Готово, когда», п. 2 (часть Windows с выводом запусков на ПК) — не выполнен.
  - «Готово, когда», п. 4 (`gh auth token -u` на Windows) — не выполнен, ответ дан по коду gh.
  - Строки probe на ПК: W4 — чтение registry через PowerShell отдаёт `GH_TOKEN`; G2 — `-u` берёт Credential
    Manager; G3 — без `-u` берётся `GH_TOKEN`; G6 — exit, поток и строки Health check как на Mac; W7 — аккаунт
    перекрывает плохой `GH_TOKEN`; W8 — Git Bash `-l` видит унаследованный `GH_TOKEN`.

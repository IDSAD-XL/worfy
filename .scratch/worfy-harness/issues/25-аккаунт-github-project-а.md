# 25 — Аккаунт GitHub Project-а при подключении: выбор из `gh auth status`, `gh auth login` в Terminal, запись в Profile

Type: task
Status: open
Blocked by: 24
Source: решения владельца 2026-10-07, вопросы Q11', Q21, Q22, Q30; [spec.md](../spec.md); [ADR-0042](../../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) — Profile целиком на машине; [ADR-0045](../../../docs/adr/0045-one-ticket-one-repository.md) — нет прав на `origin` — локальный финиш; Ticket 01 Epic-а `worfy-week` — аккаунт из Profile для своих вызовов `gh` worfy; [docs/roadmap.md](../../../docs/roadmap.md), раздел E3

## Что происходит

- Аккаунт GitHub Project-а — поле Profile `github.account`. Сейчас его пишут руками: у worfy и
  Auction — `IDSAD-XL`, у Atakama — `Oleksii-O-Atakama` (`~/.claude/profiles/<имя>/profile.json`; после
  Ticket-ов 11 и 14 — `~/.claude/worfy-harness/projects/<имя>/profile.json`). Контракт поля —
  `~/.claude/profiles/README.md:129` (после Ticket-а 02 — `harness/profiles/README.md`).
- worfy читает поле (`src/main/workflow/profile.ts:143`, `:163-186`) и для своих вызовов `gh` берёт
  токен командой `gh auth token -u <аккаунт>` (`src/main/github/prs.ts:95-113`, Ticket 01 Epic-а
  `worfy-week`). По итогу того Ticket-а Profile читается на каждом чтении, поэтому правка действует
  без перезапуска worfy. Ticket 18 этого Epic-а по тому же полю даёт `GH_TOKEN` Session-ам агентов.
- Без аккаунта `gh` идёт от глобального аккаунта login shell. Если тот не видит репозиторий, бейджи PR
  и CI показывают «gh unavailable» (Ticket 01 `worfy-week`).
- Подключение Project-а (Ticket 24) ставит в черновик Profile `github.account: null`, а
  `workflow.finish` — только по наличию `origin`. Права аккаунта на `origin` никто не проверяет.
  `workflow.finish` бывает `pr-green-ci` (PR с зелёным CI) и `local-green` (локально зелёные
  проверки, без PR): у worfy и Auction — первое, у Atakama — второе.
- gh 2.97.0 на машине владельца отдаёт аккаунты машинно: `gh auth status --json hosts` — по хосту
  список с полями `active`, `gitProtocol`, `host`, `login`, `scopes`, `state`, `tokenSource`. С
  `--json` код выхода 0 и при проблемах входа (`gh auth status --help`). Токен печатается только с
  `--show-token`.
- `gh` worfy запускает с `GH_PROMPT_DISABLED=1` (`src/main/github/prs.ts:59`): войти в аккаунт без
  человека нельзя, и так и должно остаться.
- Terminal Node живёт на Canvas Project-а: его shell адресуется парой `projectId` + `nodeId`
  (`src/shared/ipc/terminal.ts:20-23`). Во время подключения Project-а ещё нет. Ticket 19 запускает
  `gh auth login` в Terminal с экрана первого запуска (Q22), где Project-а тоже может не быть.
- Подменённый `gh` для test-ов (`test/fixtures/gh/gh-stub.mjs`) понимает только `gh pr list`, любую
  другую команду отклоняет с кодом 2 (`:22-25`).

## Что делаем

1. **Шаг «GitHub account» в форме подключения** — после черновика Ticket-а 24. worfy читает
   `gh auth status --json hosts --hostname <хост>` (без `--show-token`) и показывает аккаунты хоста:
   login, активный ли, `state`. Хост — из `git remote get-url origin` репозитория. Нет `origin` или он
   не на GitHub — шаг пишет «No GitHub origin» (тексты UI — по-английски, `docs/design/BRIEF.md`), аккаунт не нужен: `github.account: null`,
   `workflow.finish: local-green` (Q30). У папки над несколькими репозиториями — хосты `origin` всех
   её репозиториев.
2. **Права выбранного аккаунта на `origin`** (Q30). worfy проверяет право записи:
   `gh api repos/<owner>/<repo> --jq .permissions.push` с `GH_TOKEN` из `gh auth token -u <аккаунт>`,
   тем же путём, что `accountAuth` (`src/main/github/prs.ts:95`).
   - `true` — `workflow.finish: pr-green-ci`;
   - `false`, 403 или 404 — `local-green` и строка в форме (по-английски): у аккаунта нет прав на
     запись в `<owner>/<repo>`, Ticket-ы будут закрываться локальным финишем.
   - У папки над несколькими репозиториями права проверяются у каждого репозитория с `origin`.
     `pr-green-ci` — только если права есть везде; иначе `local-green` и список репозиториев без прав.
     Раздельный финиш по репозиторию в E3 не делается.
3. **Выбор по умолчанию.** Активный аккаунт хоста, если у него есть права; иначе первый аккаунт с
   правами; иначе ничего не выбрано. Пользователь может выбрать любой аккаунт или «No account»
   (`github.account: null`, `gh` идёт как сейчас).
4. **Нужного аккаунта нет — `gh auth login`.** Кнопка «Sign in with gh» запускает `gh auth login` в
   Terminal тем же путём, что экран первого запуска (Ticket 19, Q22). Вход делает человек: worfy
   команду только запускает и ничего в неё не вводит. Terminal запускает тот же исполняемый `gh`, что
   и сам worfy (в test-ах — `WORFY_GH`). Когда процесс `gh auth login` закончился, шаг заново читает
   `gh auth status`. Если путь Ticket-а 19 требует Project, которого при подключении ещё нет,
   исполнитель решает, как показать Terminal в диалоге подключения, и пишет решение и причину в «Итог».
5. **Запись.** Выбранный аккаунт и `workflow.finish` идут в черновик и записываются вместе с ним
   скриптом Ticket-а 24 (`harness/bin/project-connect`); отдельной записи нет. После подключения от
   этого аккаунта идут бейджи PR и CI (Ticket 01 `worfy-week`) и `GH_TOKEN` Session-ов (Ticket 18).
6. **Глобальный аккаунт не трогается** (Q21, правило владельца): никаких `gh auth switch`,
   `gh auth logout`, `gh config set`. `gh auth login` — только в Terminal и только по щелчку человека.
7. **Токен не выходит наружу**, как в Ticket-е 01 `worfy-week`: он есть только в окружении дочернего
   `gh api`. Его нет в ответе IPC, в логе, в черновике и в тексте ошибки.
8. **gh нет** (ENOENT) — шаг пишет «gh not found» и ведёт на экран первого запуска (Ticket 19
   показывает `brew install gh`, Q22). Подключение можно закончить без аккаунта: `github.account:
   null`, `workflow.finish: local-green`.

Ticket 19 тоже читает «gh и аккаунты» (Q22). Если там уже есть чтение `gh auth status`, этот Ticket
берёт его, а не пишет второе: тогда `src/main/github/accounts.ts` из «Где в коде» — правка файла
Ticket-а 19, и это — в «Итог».

ADR не нужен: решения — ADR-0042 (Profile на машине) и ADR-0045 (финиш без прав — локальный).

**Не входит:** смена аккаунта у уже подключённого Project-а (правка Profile агентом или из
терминала); `GH_TOKEN` у Session-ов (Ticket 18); PR из форка (позже, Q30).

## Готово, когда

- [ ] contract `test/contract/github-accounts.test.ts`: из ответа подменённого
  `gh auth status --json hosts` — список аккаунтов хоста `origin` и какой из них активный; у хоста без
  аккаунтов — пустой список.
- [ ] contract: права. Подменённый `gh api repos/o/r` с `push: true` → `pr-green-ci`; `push: false`,
  403 и 404 → `local-green` с причиной; без `origin` → `local-green` и `github.account: null`; папка
  над двумя репозиториями, у одного нет прав, → `local-green` и его имя в причине.
- [ ] contract: подменённый `gh` пишет свои аргументы в файл (`GH_STUB_LOG`). От worfy только
  `auth status --json hosts …`, `auth token -u <аккаунт>`, `api repos/<owner>/<repo> …`; ни
  `auth switch`, ни `auth logout`, ни `auth login`, ни `config`.
- [ ] contract: токена подменённого `gh` нет в ответах IPC шага, в черновике и в выводе лога.
- [ ] contract `test/contract/projects-connect.test.ts`: после шага аккаунта в черновике
  `github.account` — выбранный аккаунт, `workflow.finish` — по правам.
- [ ] e2e `test/e2e/projects-connect.spec.ts`: подменённый `gh` знает два аккаунта; выбран активный с
  правами; выбор второго → «Connect» → в песочнице
  `harness/bin/profile -C <репозиторий> --field github.account` печатает его, код 0;
  `--field workflow.finish` — по его правам.
- [ ] e2e: «Sign in with gh» открывает Terminal, где запущен `gh auth login` (в логе подменённого
  `gh` есть вызов `auth login`). После выхода процесса список аккаунтов перечитан: третий аккаунт,
  которого подменённый `gh` «входом» добавил, — в списке.
- [ ] `GATE_SCOPE=all gate.sh full` на ветке после rebase — код 0 и вердикт Gate «зелено»; e2e и
  `.app` проверяются только здесь, под замком `/tmp/worfy-e2e.lock`.
- [ ] (вручную) Stable copy после влития: подключение временного репозитория с `origin`
  `https://github.com/IDSAD-XL/worfy.git` показывает аккаунты машины из `gh auth status`; у IDSAD-XL
  права есть → `pr-green-ci`; у Oleksii-O-Atakama репозиторий не виден → `local-green` с причиной.
  «Connect» не нажимать: Profile на машине не пишется. Как проверить: окно приложения.

## Тесты

Сначала падающий test — `test/contract/projects-connect.test.ts`: после шага аккаунта в черновике
`github.account` равен выбранному аккаунту. После Ticket-а 24 там `null` — test падает. В «Итог» — как
он падал.

- `test/contract/github-accounts.test.ts` — новый: разбор `gh auth status --json hosts`, права на
  `origin`, команды `gh`, отсутствие токена.
- `test/contract/projects-connect.test.ts` — шаг аккаунта в подключении.
- `test/e2e/projects-connect.spec.ts` — выбор аккаунта, запись, «Sign in with gh».
- `test/fixtures/gh/gh-stub.mjs` — подменённый `gh` учится отвечать на `auth status --json hosts`,
  `auth token -u`, `api repos/<owner>/<repo>` и `auth login` (по файлам в `GH_STUB_DIR`); остальные
  команды по-прежнему отклоняет с кодом 2.

Все test-ы — с временными `WORFY_DATA_DIR`, `WORFY_CLAUDE_HOME` и `HARNESS_HOME`; настоящие `gh`,
`~/.claude` и `~/.claude/worfy-harness/` они не трогают.

## Где в коде

- `src/main/github/accounts.ts` — новый: аккаунты из gh auth status, права на origin
- `src/main/projects/connect.ts` — шаг аккаунта (файл Ticket-а 24)
- `src/main/ipc/projects.ts`
- `src/shared/ipc/projects.ts`
- `src/renderer/projects/ConnectProject.tsx` — шаг «GitHub account» (файл Ticket-а 24)
- `test/fixtures/gh/gh-stub.mjs`
- `test/contract/github-accounts.test.ts` — новый
- `test/contract/projects-connect.test.ts`
- `test/e2e/projects-connect.spec.ts`

`src/main/github/prs.ts` (`accountAuth`) и `src/main/workflow/profile.ts` не меняются: этот Ticket
только пишет поле, которое они уже читают. `harness/bin/project-connect` не меняется: аккаунт — поле
черновика, которое скрипт Ticket-а 24 уже пишет. Если путь Terminal Ticket-а 19 придётся править,
исполнитель добавляет его файл в список и сверяет с Ticket-ами Wave.

## Итог

Заполняется при закрытии.

# Code story — worfy-auth-check 05: GitHub access: источник токена, честный `gh-auth`, строка Project-а с 401 и 404, «Use <login>»

Kind: pr · Epic: worfy-auth-check · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

Строка `gh-auth` Health check была зелёной, если `gh auth status` называл хоть один login, и не читала ни exit code, ни
запись `(GH_TOKEN)`. С неверным `GH_TOKEN` в окружении при живом входе в keyring строка была `ok`, а каждый вызов gh без
`github.account` получал 401. Строки доступа Project-а к его repo не было, а пустой `github.account` давал только
`console.warn`.

- Требование: [Что происходит](../issues/05-доступ-github-без-sso.md#что-происходит)

## 2. Разбор ответа `gh api -i`

Code: `src/main/github/auth-diagnosis.ts:143-157` · key lines: 144, 145, 150, 151, 152, 153, 154, 155, 156

```ts
export function repoAccess(answer: { output: string } | { failure: string }): RepoAccess {
  if ('failure' in answer) return { kind: 'unknown', reason: lastWords(answer.failure) || 'gh did not answer' }
  const status = STATUS_LINE.exec(answer.output)
  if (status === null) {
    if (NO_TOKEN.test(answer.output)) return { kind: 'no-token' }
    return { kind: 'unknown', reason: lastWords(answer.output) || 'gh printed no answer of GitHub' }
  }
  const code = Number(status[1])
  if (code >= 200 && code < 300) return { kind: 'ok' }
  if (code === 401) return { kind: 'bad-token' }
  if (code === 404) return { kind: 'no-access' }
  if (code >= 500 || code === 429) return { kind: 'unknown', reason: `GitHub answered HTTP ${code}` }
  if (code === 403 && rateLimited(answer.output, headersOf(answer.output, status.index))) return { kind: 'unknown', reason: "GitHub's rate limit (HTTP 403)" }
  return { kind: 'refused', status: code }
}
```

- Что делает: читает статус из строки `HTTP/2.0 <code>`, которую печатает `-i`: 2xx — доступ, 401 — токен не работает, 404 — нет доступа, текст gh про `gh auth login` без статуса (exit 4) — токена нет вовсе; нет сети, timeout, 5xx, 429 и 403 rate limit (`Retry-After`, меньше 10 % лимита, текст про rate limit — как читает PR inbox) — `unknown`. Тело ответа в причину не попадает никогда.
- Почему здесь: Ticket называет новый файл `src/main/github/auth-diagnosis.ts`; статус из `-i`, а не из сообщения gh, взят из spike-а Ticket-а 01 (fixtures `api-401`, `api-404`, `api-no-auth`).
- Без него: строка не отличила бы 401 от 404 и сбой сети от отказа, а `unknown` (решение владельца Q2) стал бы `fail`.
- Требование: [Что делаем, п. 1]({T}#что-делаем)
- Риски и пробелы test-ов: 403 с SSO читается как `refused` со статусом — разбор `X-GitHub-SSO` это Ticket 06. Отозванный токен как 401 — допущение spike-а, не опыт.

## 3. Честный `gh-auth`

Code: `src/main/first-run/checks.ts:529-548` · key lines: 534, 538, 541, 542, 543, 544, 546, 547

```ts
async function ghAuth(deps: CheckDeps, machine: Machine, timeoutMs: number): Promise<Row> {
  const run = await runGh(['auth', 'status'], deps, machine, timeoutMs)
  if (run.missing) return row('fail', 'gh is not installed', `Install gh first (${installCommand(machine.windows, 'gh')}), then sign in`)
  const text = `${run.stdout}\n${run.stderr}`
  const entries = parseAuthEntries(text)
  const stored = entries.filter((entry): entry is AuthEntry & { login: string } => entry.login !== null && !isTokenVariable(entry.source))
  const working = stored.filter((entry) => entry.state === 'success')
  const named = working.map((entry) => `${entry.login} (${entry.source ?? 'stored'})`).join(', ')
  const fromEnv = environmentEntry(text)
  if (fromEnv !== null) {
    const remove = `${fromEnv.variable} comes from your environment and gh uses it over your stored accounts: put a working token in it, or remove it with the command and from ${variableHome(machine.system.platform)}`
    if (fromEnv.state === 'timeout') return row('unknown', `Couldn't check: GitHub did not answer in time for ${fromEnv.variable} from the environment`)
    if (fromEnv.state !== 'success') {
      const over = working.length > 0 ? `; it overrides ${named}` : ''
      return row('fail', `the token in ${fromEnv.variable} from the environment does not work${over}`, remove, removeVariableCommand(fromEnv.variable, machine.system.platform))
    }
    const who = fromEnv.login === null ? '' : ` (${fromEnv.login})`
    const detail = working.length > 0 ? `${named}, ${fromEnv.variable} from the environment${who} overrides ${working.length === 1 ? 'it' : 'them'}` : `${fromEnv.variable} from the environment${who}`
    return row('ok', detail)
  }
```

- Что делает: читает все записи `gh auth status` с их источником; запись переменной окружения (`(GH_TOKEN)`, `(GITHUB_TOKEN)`) побеждает сохранённые аккаунты: рабочая — `ok` с текстом «alice (keyring), GH_TOKEN from the environment (alice) overrides it», нерабочая — `fail` с командой удаления переменной, timeout — `unknown`.
- Почему здесь: Ticket называет `checks.ts` (`gh-auth`); формулировка detail — из spec, «Решения по реализации», 3.
- Без него: неверный `GH_TOKEN` при живом keyring оставлял строку зелёной (находка ревью spike-а, `checks.ts:502-506`).
- Требование: [Что делаем, п. 2 и 3]({T}#что-делаем)
- Риски и пробелы test-ов: Команда для Mac — `launchctl unsetenv`, а переменная до gh доходит только через rc-файл; поэтому подсказка называет и rc-файлы. Windows-команда проверена только текстом unit test-а.

## 4. Строка GitHub access Project-а: аккаунт, токен, repo

Code: `src/main/first-run/checks.ts:641-658` · key lines: 644, 646, 648, 652, 657, 658

```ts
async function githubAccess(project: GithubProject, deps: GithubAccessDeps, platform: NodeJS.Platform): Promise<{ found: Row; environmentTokenOnly: boolean }> {
  const result = (found: Row, environmentTokenOnly = false): { found: Row; environmentTokenOnly: boolean } => ({ found, environmentTokenOnly })
  const profile = await deps.account(project.root)
  const login = profile.account
  const variable = environmentToken(await deps.ghEnv(), platform)
  // A Profile that does not read: gh goes as without an account, and nothing can be written to it.
  const unread = login === null && profile.reason !== null && !ACCOUNT_UNSET.test(profile.reason) ? `the Profile could not be read (${redactSecrets(profile.reason)})` : null
  let extra: GhEnv = {}
  if (login !== null) {
    try {
      extra = await accountAuth({ account: () => Promise.resolve(login), run: deps.gh })(project.root)
    } catch (error) {
      if (/\bgh not found\b/u.test(messageOf(error))) return result(row('unknown', "Couldn't check: gh is not installed"))
      return result(signInAs(login, variable, platform))
    }
  }
  const source = tokenSource({ account: login, env: variable === null ? {} : { [variable]: 'set' }, platform })
  const answers = await Promise.all(project.repos.map(async (slug) => ({ slug, access: await askRepo(deps.gh, slug, project.root, extra) })))
```

- Что делает: идёт как PR inbox: `github.account` из Profile → `accountAuth` (токен keyring этого аккаунта) → `gh api -i repos/<owner>/<repo>` на каждый repo с тем же gh и окружением. Нет gh login аккаунта — `fail` с Sign in…; при `GH_TOKEN` в окружении кнопки нет, а команда запускает `gh auth login` без переменной, потому что gh отказывается входить при заданном `GH_TOKEN`.
- Почему здесь: Ticket называет `checks.ts` (строки Project-а); путь через `accountAuth` и окружение PR inbox — spec, «Решения по реализации», 3, и находка ревью spike-а.
- Без него: строка проверяла бы доступ не тем токеном, каким идёт PR inbox, и называла бы не тот источник.
- Требование: [Что делаем, п. 4]({T}#что-делаем)
- Риски и пробелы test-ов: Profile, который не читается, отличается от пустого поля по тексту причины `readGithubAccount` (`ACCOUNT_UNSET`); новая формулировка причины там сломает это различение.

## 5. Один login с push

Code: `src/main/first-run/checks.ts:617-628` · key lines: 619, 620, 625, 626, 627, 628

```ts
export async function useLoginCandidate(project: GithubProject, deps: GithubAccessDeps): Promise<string | null> {
  const gh: GhRunner = (args, cwd, extra, output) => deps.gh(args, cwd, { GH_TOKEN: '', GITHUB_TOKEN: '', ...extra }, output)
  const step = await readGithubAccounts(
    project.folders.map((path) => ({ name: basename(path), path })),
    { git: deps.git, gh, platform: deps.platform ?? process.platform },
  )
  if (step.status !== 'accounts') return null
  const withPush = step.accounts.filter((account) => account.push && account.host === 'github.com')
  const only = withPush.length === 1 ? (withPush[0]?.login ?? null) : null
  // A login the button cannot send (an Enterprise Managed User's `name_shortcode`): no button, and the report stays valid.
  return only !== null && githubLoginSchema.safeParse(only).success ? only : null
}
```

- Что делает: ищет логины gh на github.com с push во все repo Project-а тем же шагом, что диалог Add project (`readGithubAccounts`), с пустыми `GH_TOKEN` и `GITHUB_TOKEN` (gh читает пустую как незаданную); кнопка «Use <login>» есть, только когда такой login ровно один и его принимает `githubLoginSchema` (login Enterprise Managed User вида `name_shortcode` кнопки не получает).
- Почему здесь: spec, «Починка»: push-доступ уже считает `accounts.ts:155-210`; почему пустые переменные — чтобы переменная окружения не прятала сохранённые аккаунты, это записано в комментарии к функции.
- Без него: при двух логинах с push кнопка выбирала бы за человека, а с `GH_TOKEN` в окружении поиск мог бы идти не теми токенами; login с `_` ломал бы проверку отчёта Health check схемой IPC.
- Требование: [Что делаем, п. 4]({T}#что-делаем)
- Риски и пробелы test-ов: Падает ли настоящий `gh auth status --json` с неверным `GH_TOKEN` — не проверено (живой gh в этом Ticket-е не запускали); пустые переменные — защита на этот случай, test проверяет, что они переданы.

## 6. «Use <login>» пишет одно поле

Code: `src/main/first-run/actions.ts:349-374` · key lines: 355, 357, 363, 367, 368

```ts
  private async useLogin(context: ActionContext): Promise<Outcome> {
    const { githubAccount } = this.deps
    const { projectId, login } = context
    if (githubAccount === undefined) return failed('this build does not write github.account')
    if (projectId === undefined || login === undefined) return failed('Use <login> needs the Project and the login of its row')
    const target = await githubAccount.candidate(projectId)
    if (target === null) return failed('the Project is not on this Machine, or none of its repositories is on GitHub')
    if (target.login !== login) {
      const now = target.login === null ? 'no single account of gh may push to every repository now' : `${target.login} is the account that may push now`
      return failed(`github.account was not written: ${now}. Check again`)
    }
    const field = ['-C', target.root, '--field', GITHUB_ACCOUNT_FIELD]
    try {
      const read = await githubAccount.profileSet([...field, '--read'])
      if (read.code !== 0) return failed(profileSetFailure(read, '--read'))
      const fingerprint = fingerprintOf(read.stdout)
      if (fingerprint === null) return failed('bin/profile-set --read printed no fingerprint')
      const set = await githubAccount.profileSet([...field, '--expect', fingerprint, '--set', JSON.stringify({ [GITHUB_ACCOUNT_FIELD]: login })])
      if (set.code === PROFILE_SET_CONFLICT) return failed('the Profile changed while it was written: check again')
      if (set.code === PROFILE_SET_BUSY) return failed('another write holds the Profile: try again in a moment')
      if (set.code !== 0) return failed(profileSetFailure(set, '--set'))
    } catch (error) {
      return failed(`bin/profile-set could not be run: ${error instanceof Error ? error.message : String(error)}`)
    }
    return done(`github.account of ${target.name} is now ${login}`)
  }
```

- Что делает: пишет `github.account` того Project-а, чей id пришёл из строки, и только тот login, который показала кнопка, пока он всё ещё единственный с push; `profile-set --read`, затем `--set` с `--expect`; commit в Harness home делает `profile-set`.
- Почему здесь: Ticket называет `actions.ts` (кнопка «Use <login>»); запись через `profile-set --field` по образцу `code-stories-setting.ts` — Ticket, «Что делаем», п. 5; без диалога — решение владельца Q5 («по щелчку»).
- Без него: кнопка могла бы записать login, которого человек не видел, или чужой Profile поверх изменённого.
- Требование: [Что делаем, п. 5]({T}#что-делаем)
- Риски и пробелы test-ов: Запуск настоящего `bin/profile-set` здесь не проверен: test-ы берут записывающий stand-in; формат его ответа взят из `harness/bin/profile-set` (`--read` печатает `fingerprint`).

## 7. Кнопка шлёт Project своей строки

Code: `src/renderer/shell/FirstRunChecks.tsx:475-478` · key lines: 476, 477, 478

```ts
    // "Use <login>" sends the Project of its row and the login it showed: main writes exactly that one.
    const login = check.actions.find((each) => each.id === 'use-login')?.login
    const target = action === 'use-login' ? { projectId: check.project?.id, login } : {}
    const result = await invoke('firstRun.run', { action, projectName: project?.name, ...target })
```

- Что делает: кнопка «Use <login>» строки Project-а шлёт в `firstRun.run` id Project-а этой строки и login кнопки, а не текущий Project окна; занятой показывается только нажатая строка — её ключ `rowKey` это id строки и id её Project-а, потому что строки GitHub access двух Project-ов делят один id.
- Почему здесь: находки ревью Ticket-а 04 (PR #2021): кнопка шла с текущим Project-ом, а занятость искалась по одному `check.id`; правка минимальная, остальное в файле — Ticket 04.
- Без него: кнопка второго Project-а записала бы `github.account` текущего, а «Running…» загорелся бы на строках обоих Project-ов.
- Требование: [Что делаем, п. 5]({T}#что-делаем)
- Риски и пробелы test-ов: Renderer test (`settings-health.test.tsx`) жмёт кнопку второго из двух Project-ов; что main пишет только его Profile — contract test с двумя Project-ами. Живое окно не открывали (e2e локально не запускались).

## 8. Сетевые строки и повторная проверка

Code: `src/main/ipc/first-run.ts:286-295` · key lines: 287, 288, 292, 294

```ts
health.registerNetworkRows(async () => githubAccessRows(await githubProjects(), githubAccessDeps()))
health.registerRecheck('github-access', async (project) => {
  if (project === undefined) return null
  try {
    const found = (await githubProjects()).find((each) => each.id === project.id)
    return found === undefined ? null : await githubAccessRow(found, githubAccessDeps())
  } catch {
    return githubAccessUnknown(project, "the Project's repositories could not be read")
  }
})
```

- Что делает: регистрирует строки GitHub access как сетевые (после локальных проверок, старт их не ждёт) и как повторную проверку `github-access`; она всегда отвечает: Project пропал — `null`, repo не читаются — `unknown`.
- Почему здесь: Ticket, «Что делаем», п. 6, и находка ревью spike-а: повторная проверка регистрируется в `health-reports` и обязана отвечать.
- Без него: строка не появилась бы в Health check и не перепроверялась бы после сбоя фичи и при фокусе окна.
- Требование: [Что делаем, п. 6]({T}#что-делаем)
- Риски и пробелы test-ов: Этот файл держит Electron; contract test проверяет функции строки, а саму регистрацию — только косвенно (e2e локально не запускались).

## 9. Что сознательно не меняли

- Add project и его «Sign in with gh» (`src/main/ipc/projects.ts`) по-прежнему идут без аккаунта Profile-а, и `gh auth login`
  там так же откажет при `GH_TOKEN` в окружении — Ticket этого не правит, это записано на странице `projects.md`.
- Codex app-server при аккаунте без входа gh стартует с окружением worfy — описано на странице `gate-and-github.md`, правка — Ticket 08.
- `src/shared/health/severity.ts` не правили: уровень строки ставит его `severityOf` с `environmentTokenOnly`.

## 10. Как проверено

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
- unit и contract test-ы модуля (`gh-auth-text`, `auth-diagnosis`, `first-run-checks`, `github-prs`, `github-accounts`,
  `gh-stand-in`, `workflow-profile`, `health-reports`, `health-github-access`) и renderer test `settings-health` — exit 0.
- Mutant-ы: 401 как 404, 404 как ok, 5xx не `unknown`, timeout как «нет доступа», порядок `GH_TOKEN`/`GITHUB_TOKEN`, пустая
  переменная как заданная, аккаунт не побеждает, «Use <login>» при двух логинах и без проверки push, поиск с `GH_TOKEN`
  окружения, запись не того login-а, `gh-auth` ok при нерабочем `GH_TOKEN`, кнопка с текущим Project-ом вместо Project-а строки,
  занятость по одному id строки — все 14 убиты. После ревью, раунд 1: login EMU с кнопкой, 403 rate limit не `unknown`, push только
  первой папки, `messageOf` без redaction (timeout gh), `--set` с exit 1 как успех, «Sign in…» при `GH_TOKEN`, текущий Project в
  renderer, заголовки после пустой строки — все 8 убиты.

## Проверить себя

1. Почему строка GitHub access с заданным `github.account` не страдает от неверного `GH_TOKEN` в окружении, а `gh-auth` страдает?
   Ответ: строка берёт токен аккаунта через `accountAuth` и передаёт его gh поверх окружения; `gh auth status` строки
   `gh-auth` идёт без аккаунта, и gh берёт переменную.
   Lines: `src/main/first-run/checks.ts:641-658`
2. Что делает строка, когда `gh api` не дошёл до GitHub, и почему это не `fail`?
   Ответ: без строки статуса и без текста про `gh auth login` ответ — `unknown` с последней строкой gh; решение
   владельца Q2: нет сети или timeout никогда не critical.
   Lines: `src/main/github/auth-diagnosis.ts:143-157`
3. Почему кнопка «Use <login>» шлёт в main и login, и id Project-а?
   Ответ: main пишет Profile именно этого Project-а и только login, который был показан, и отказывает, если единственный
   login с push уже другой.
   Lines: `src/main/first-run/actions.ts:349-374`

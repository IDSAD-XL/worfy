# Code story — worfy-auth-check 07: Молчаливые сбои GitHub → Health check: PR inbox, PR badges, gate-queue, Flight recorder, проба ревью, pr-reply

Kind: pr · Epic: worfy-auth-check · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

Когда GitHub отказывал во входе (нет входа gh для `github.account`, 401, gh без токена), PR inbox показывал сырой текст
gh без подсказки, что делать, а PR badges, gate-queue, Flight recorder, проба ревью и отправка ответов писали сбой только
в log. Иконка Health check оставалась зелёной до следующей полной проверки. Кроме того, «Sign in with gh» в Add project
молча входил в account, который тут же перекрывал `GH_TOKEN` из окружения (решение владельца Q5).

- Требование: [Что происходит](../issues/07-молчаливые-сбои-github.md#что-происходит)

## 2. Какой сбой — отказ во входе

Code: `src/main/github/github-health.ts:21-40` · key lines: 24, 25, 28, 29, 31, 33, 39

```ts
/** gh's and accountAuth's words of a sign-in GitHub refused. */
const SIGN_IN_FAILURE = [
  // accountAuth (src/main/github/prs.ts): the Profile's account has no gh login, or gh printed no token for it.
  /\bno gh login for\b/u,
  /\bprinted no token\b/u,
  /\bno oauth token found\b/u,
  // A token GitHub does not take: invalid, revoked or expired.
  /\bBad credentials\b/iu,
  /\bHTTP 401\b/u,
  // gh has no token at all (exit 4): "To get started with GitHub CLI, please run: gh auth login".
  /\bgh auth login\b/u,
  // An organization with SAML single sign-on the token is not authorized for.
  /\bSAML\b/u,
]

/** Whether gh's reason is a sign-in GitHub refused, and not the network, a timeout or a rate limit. */
export function isSignInFailure(reason: string | null | undefined): boolean {
  if (reason == null || reason === '') return false
  return SIGN_IN_FAILURE.some((pattern) => pattern.test(reason))
}
```

- Что делает: по тексту gh и `accountAuth` отличает отказ во входе от сети, timeout, 5xx и rate limit. Только отказ во
  входе попадает в Health check.
- Почему здесь: новый файл; Ticket его не называет. Шесть фич сообщают один и тот же сбой, поэтому правило одно для всех.
  Почему сеть не считается отказом — решение владельца Q2 эпика: нет сети или timeout никогда не critical.
- Без него: потерянная сеть красила бы строку GitHub access Project-а в `fail` и вела бы человека чинить вход, который
  работает.
- Требование: [Что делаем, п. 4](../issues/07-молчаливые-сбои-github.md#что-делаем)
- Риски и пробелы test-ов: список слов взят из stand-in gh и spike-а Ticket-а 01, а не из живого GitHub; новый текст gh
  про отказ пройдёт мимо и останется только в log. `test/unit/github-health.test.ts` проверяет каждый образец и сеть, 5xx,
  rate limit как не отказ.

## 3. Одно сообщение на сбой, `ok` только после своего сбоя

Code: `src/main/github/github-health.ts:71-99` · key lines: 76, 77, 79, 80, 84, 89, 90, 91, 96

```ts
export function githubHealth(options: GithubHealthOptions): GithubHealth {
  /** The reason last reported for each Project, by its id. */
  const reported = new Map<string, string>()
  const report = (root: string, reason: string): void => {
    const project = options.project(root)
    if (project === undefined) return
    const text = `${options.feature}: ${firstLine(reason)}`
    if (reported.get(project.id) === text) return
    reported.set(project.id, text)
    options.reports.reportFailure('github-access', project, text, stepOf(options.feature))
  }
  return {
    failed: (root, reason) => {
      if (isSignInFailure(reason)) report(root, reason)
    },
    signInFailed: report,
    answered: (root) => {
      const project = options.project(root)
      if (project === undefined || !reported.has(project.id)) return
      reported.delete(project.id)
      options.reports.reportOk('github-access', project)
    },
    reason: (root) => {
      const project = options.project(root)
      if (project === undefined) return null
      return accessDetail(options.reports.current(), project.id)
    },
  }
}
```

- Что делает: фича сообщает строке GitHub access своего Project-а `reportFailure` с именем фичи и первой строкой gh без
  токена (`redactSecrets`). Тот же сбой второй раз не шлётся. `reportOk` идёт, только если эта фича раньше сообщила сбой.
  `reason` отдаёт причину строки, пока она не `ok`.
- Почему здесь: `reportFailure`, `reportOk` и `current` дал Ticket 03 (`src/main/first-run/health-reports.ts`); Ticket
  требует «сбой — `reportFailure`, успех — `reportOk`» для каждой фичи.
- Без него: PR inbox, который опрашивает GitHub по таймеру, слал бы `reportFailure` на каждом опросе. А успех любой фичи
  без своего сбоя снимал бы чужой `fail` или `warn` строки, который поставила полная проверка.
- Требование: [Что делаем, п. 1 и 4](../issues/07-молчаливые-сбои-github.md#что-делаем)
- Риски и пробелы test-ов: Project ищется по самой глубокой папке, внутри которой лежит корень фичи
  (`projectOfFolder`); фича вне всех Project-ов не сообщает ничего. Сбой в двух Project-ах с одной папкой не проверен.

## 4. PR inbox: причина строки вместо текста gh

Code: `src/main/github/inbox.ts:514-528` · key lines: 516, 517, 518, 526, 527

```ts
  /** A read of the Project failed: its reason in the snapshot, and Health check told when GitHub refused the sign-in. */
  private failed(project: PrInboxProject, state: ProjectState, error: unknown): void {
    state.error = messageOf(error)
    state.signIn = isSignInFailure(state.error)
    this.health.failed(project.root, state.error)
  }

  /**
   * The snapshot's error: after a sign-in GitHub refused, the reason of the Project's GitHub access row while it is
   * not `ok` (ticket 05 names whose token gh took there, ticket 06 an organization's SSO), else gh's own words.
   */
  private errorOf(project: PrInboxProject, state: ProjectState): string | null {
    if (!state.signIn) return state.error
    return this.health.reason(project.root) ?? state.error
  }
```

- Что делает: сбой чтения записывает текст gh (теперь без токена), помечает отказ во входе и сообщает его Health check.
  Снимок показывает причину строки GitHub access, пока она не `ok`, иначе — слова gh.
- Почему здесь: Ticket называет `inbox.ts`; «текст причины берётся из строки, поэтому SSO-текст появится в PR inbox сам,
  когда его даст Ticket 06» — Ticket, «Что делаем», п. 1.
- Без него: PR inbox и Settings → Health называли бы один сбой разными словами.
- Требование: [Что делаем, п. 1](../issues/07-молчаливые-сбои-github.md#что-делаем)
- Риски и пробелы test-ов: строка Health check перепроверяется после `reportFailure`, и снимок PR inbox обновляется по
  событию `healthReports()` (`src/main/ipc/pr-inbox.ts`) — это проверяет только e2e test, локально его не запускали.

## 5. PR badges: флаг `signInFailed` и причина строки

Code: `src/main/ipc/checks.ts:56-65` · key lines: 58, 59, 62, 63, 64

```ts
/** gh's state as the badges show it, told to Health check: a refused sign-in names the reason of the Project's GitHub access row. */
function ghHealth(health: GithubHealth, gh: ChecksSnapshot['gh'], projectRoot: string): ChecksSnapshot['gh'] {
  if (gh.available) {
    health.answered(projectRoot)
    return gh
  }
  if (gh.error === null || !isSignInFailure(gh.error)) return gh
  health.failed(projectRoot, gh.error)
  return { ...gh, error: health.reason(projectRoot) ?? gh.error, signInFailed: true }
}
```

- Что делает: ответ gh для бейджей сообщает Health check так же, как PR inbox, и отдаёт renderer-у флаг `signInFailed` с
  причиной строки.
- Почему здесь: Ticket называет `src/main/ipc/checks.ts:170-178`; флаг лёг в схему `src/shared/ipc/checks.ts` — она вне
  списка файлов Ticket-а, без неё renderer не отличит отказ от `gh unavailable`.
- Без него: бейдж показывал бы `gh unavailable` и при сети, и при отказе во входе.
- Требование: [Что делаем, п. 4 и 5](../issues/07-молчаливые-сбои-github.md#что-делаем)
- Риски и пробелы test-ов: `projectRoot` — корень Project-а, а не папка repo, из которой читаются бейджи многорепного
  Project-а; это проверяет `test/unit/read-checks.test.ts`.

## 6. Строка ошибки PR inbox со ссылкой

Code: `src/renderer/pr-inbox/PrInboxView.tsx:616-630` · key lines: 617, 619, 620, 621

```ts
          {status.error !== null ? (
            snapshot.signInFailed === true ? (
              // GitHub refused the sign-in (worfy-auth-check ticket 07): the reason of the Project's GitHub access row, and Health check one click away.
              <span className="w-pr-inbox__status-error" data-testid="pr-inbox-error" data-sign-in="true">
                <span>GitHub refused the sign-in: {snapshot.error}</span>{' '}
                <Button variant="link" data-testid="pr-inbox-health" onClick={openHealthCheck}>
                  Open Health check
                </Button>
              </span>
            ) : (
              <span className="w-pr-inbox__status-error" data-testid="pr-inbox-error">
                {status.error}
              </span>
            )
          ) : null}
```

- Что делает: при отказе во входе строка говорит «GitHub refused the sign-in: <причина>» и даёт ссылку «Open Health
  check», которая открывает Settings → Health (`openHealthCheck()` Ticket-а 04). Прочие сбои показываются как раньше.
- Почему здесь: Ticket называет `PrInboxView.tsx:596-598`; своих панелей, toast и уведомлений нет — решение владельца Q9.
- Без него: человек видел бы текст gh и не знал, где чинить.
- Требование: [Что делаем, п. 2 и 6](../issues/07-молчаливые-сбои-github.md#что-делаем)
- Риски и пробелы test-ов: вид проверен снимками собранного renderer-а в обеих темах, не в окне приложения.

## 7. «Sign in with gh» при `GH_TOKEN` в окружении

Code: `src/main/github/accounts.ts:264-275` · key lines: 266, 267, 268, 272, 273

```ts
export function signInBlock(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform): SignInBlock | null {
  // An empty variable counts as unset, as gh reads it.
  const variables = TOKEN_VARIABLES.filter((name) => (valueOf(env, name, platform) ?? '') !== '')
  if (variables.length === 0) return null
  const names = variables.join(' and ')
  const it = variables.length === 1 ? 'it' : 'them'
  return {
    variables: [...variables],
    command: variables.map((name) => removeVariableCommand(name, platform)).join('; '),
    why: `${names} ${variables.length === 1 ? 'is' : 'are'} set in the environment worfy runs gh with. gh uses ${it} over every account it stores, so a sign-in would not change whose token gh takes, and gh auth login refuses while ${it} ${variables.length === 1 ? 'is' : 'are'} set. Run the command, remove ${it} from ${variableHome(platform)} too, then restart worfy and sign in.`,
  }
}
```

- Что делает: по окружению, с которым worfy запускает gh, называет непустые `GH_TOKEN` и `GITHUB_TOKEN` (на Windows имя без
  учёта регистра), команду их удаления для платформы и объяснение. Значение переменной не читается в текст. Обработчик
  `projects.connect.signIn` (`src/main/ipc/projects.ts`) при таком ответе не открывает терминал, а `GithubAccount.tsx`
  показывает объяснение, команду и кнопку Copy.
- Почему здесь: решение владельца Q5 от 2026-11-19 называет `src/main/ipc/projects.ts`, `src/main/github/accounts.ts`,
  `src/renderer/projects/GithubAccount.tsx`; команды и место переменной (`removeVariableCommand`, `variableHome`) уже
  дал Ticket 05 в `auth-diagnosis.ts`.
- Без него: вход проходил бы, но gh продолжал бы брать токен из переменной — человек думал бы, что вошёл другим account.
- Требование: [Готово, когда — решение владельца Q5](../issues/07-молчаливые-сбои-github.md#готово-когда)
- Риски и пробелы test-ов: на Mac `launchctl unsetenv` убирает переменную только у приложений, запущенных после неё;
  поэтому текст требует убрать её и из файлов запуска shell и перезапустить worfy. Сам `gh auth login` при переменной не
  запускали — его отказ известен из spike-а Ticket-а 01.

## 8. Что сознательно не меняли

- `src/main/first-run/checks.ts` и прочие файлы Ticket-а 08 не трогали: текст причины берётся из строки GitHub access,
  которую строит Ticket 05.
- Сбой сети, timeout, 5xx и rate limit по-прежнему только в log и в строке PR inbox «The last read failed».
- Update без токена (`src/main/update/github.ts`) — вне скоупа по Ticket-у.
- Бейдж `gh unavailable` остался для сбоев, которые не отказ во входе.

## 9. Как проверено

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (19589 test-ов) с `TMPDIR` без пробела; gate fast — в отчёте PR.
- Test-ы, которые писались красными первыми: на базовых `inbox.ts`, `ChecksBadges.tsx`, `PrInboxView.tsx` новые test-ы
  дали 6 красных.
- Все unit и contract test-ы затронутых модулей (75 файлов, в том числе `pr-inbox`, `pr-inbox-send`, `gate-queue`,
  `flight-recorder-github`, `review-offer`, `github-accounts`, `health-reports`, `health-github-access`,
  `pr-inbox-view`, `checks-badges`, `signin-replies`, `read-checks`, `github-health`) — exit 0.
- Значение токена: stand-in gh печатает известный токен, `test/contract/pr-inbox.test.ts` ищет его в снимке, log и
  сообщениях Health check — не находит.
- e2e `test/e2e/pr-inbox.spec.ts` написан, локально не запускался (правило владельца); его запускает CI.

## Проверить себя

1. Почему успешный ответ фичи не всегда шлёт `reportOk`?
   Ответ: `ok` шлёт только фича, которая сама сообщила сбой этого Project-а; иначе её успех снимал бы `fail` или `warn`,
   который поставила полная проверка или другая фича.
   Lines: `src/main/github/github-health.ts:71-99`
2. Что увидит человек в PR inbox, если пропала сеть, и почему иконка Health check не краснеет?
   Ответ: строку «The last read failed: <текст gh>» без ссылки; `isSignInFailure` не считает сеть отказом во входе, и
   Health check ничего не получает.
   Lines: `src/main/github/github-health.ts:21-40`
3. Почему «Sign in with gh» не запускается при `GH_TOKEN`, а не входит и предупреждает?
   Ответ: gh берёт переменную поверх любого сохранённого account, так что вход не меняет, чей токен идёт в GitHub, а
   `gh auth login` при ней отказывает.
   Lines: `src/main/github/accounts.ts:264-275`

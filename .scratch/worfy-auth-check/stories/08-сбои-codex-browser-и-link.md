# Code story — worfy-auth-check 08: Codex, Browser, Link: строка входа Codex в своём модуле, `notice` Session Codex, сообщения Browser и Link

Kind: pr · Epic: worfy-auth-check · Ticket: 08 · PR: - · Language: ru

## 1. Что было не так

Четыре сбоя входа жили только в log или только у агента. Codex: вход не проверялся в Health check вовсе, а app-server,
который не стартовал, тихо считался «не вошёл». Session Codex без `GH_TOKEN` писала одну строку log и шла дальше без
GitHub. Истёкший вход Browser profile видел только агент. Нечитаемый файл секретов Link и смена сертификата Linked
machine давали строку log и chip в sidebar, но не строку Health check.

- Требование: [Что происходит]({T}#что-происходит)

## 2. Чтение входа Codex отличает «не стартовал» от «не вошёл»

Code: `src/main/vendors/codex/account.ts:138-148` · key lines: 140, 144, 145, 147

```ts
export async function readCodexSignIn(start: StartCodex, codexHome: string, signal?: AbortSignal): Promise<CodexSignIn> {
  signal?.throwIfAborted()
  if (!existsSync(codexHome)) return { kind: 'no-home' }
  let started: CodexAsk
  try {
    started = await start(() => undefined)
  } catch (error) {
    return { kind: 'not-started', error }
  }
  return { kind: 'read', connection: await useCodex(started, signal, readCodexAccount) }
}
```

- Что делает: одно чтение входа Codex с тремя исходами: Codex здесь не запускали (нет `CODEX_HOME`, ничего не стартует), app-server не стартовал (с ошибкой), ответ `account/read`. Проверка аккаунта Settings → Vendors (`check`) теперь идёт через эту же функцию и ведёт себя как раньше: оба первых случая для неё — «не вошёл», второй с той же строкой log.
- Почему здесь: Ticket, «Что делаем», п. 1: «Чтение — через `codex/account.ts`; app-server не стартовал — `unknown`, не `fail`». Раньше `check` сводил оба случая к одному ответу, и строка Health check не могла их различить.
- Без него: строка Codex показала бы «не вошёл» и кнопку входа там, где Codex просто не запускается на этой платформе.
- Требование: [Что делаем, п. 1]({T}#что-делаем)
- Риски и пробелы test-ов: app-server, который стартовал и не ответил, по-прежнему отклоняет промис; строка ловит это сама (шаг 3).

## 3. Строка входа Codex — в своём модуле

Code: `src/main/first-run/vendor-checks.ts:45-61` · key lines: 48, 51, 53, 54, 57, 60

```ts
export async function codexSignInRow(deps: VendorCheckDeps): Promise<Check | null> {
  let read: CodexSignIn
  try {
    if (!(await deps.codexInBuild())) return null
    read = await deps.codexSignIn()
  } catch (error) {
    return codexRow('unknown', `Couldn't check: ${messageOf(error)}`)
  }
  if (read.kind === 'no-home') return null
  if (read.kind === 'not-started') return codexRow('unknown', `Couldn't check: the Codex app-server did not start (${messageOf(read.error)})`)
  const { connection } = read
  if (!connection.signedIn) {
    return codexRow('warn', 'not signed in to Codex', 'Sign in with your ChatGPT account: Codex Sessions need it, Claude Code Sessions do not', [{ id: 'codex-sign-in', label: 'Sign in to Codex…' }])
  }
  const who = [connection.email, connection.plan].filter((part): part is string => typeof part === 'string' && part !== '')
  return codexRow('ok', who.length > 0 ? who.join(' · ') : 'signed in')
}
```

- Что делает: `ok` с email и планом; без входа — `warn` с «Sign in to Codex…» (needs-user); app-server не стартовал или не ответил — `unknown`. Уровень берётся из `severityOf` — всегда non-critical; `opensFirstRun: false`. В `checks.ts` — только поле `vendorRows` и одно добавление строк в конец отчёта; приложение передаёт `appVendorRows` (`src/main/ipc/first-run.ts`).
- Почему здесь: модуль назван в Ticket-е и в «Alternative» critic 2026-11-18 (строка Codex — в своём модуле); уровень — решение владельца Q11.
- Без него: Codex в Health check не было бы вовсе.
- Требование: [Что делаем, п. 1 и 5]({T}#что-делаем)
- Риски и пробелы test-ов: решение без владельца — без `CODEX_HOME` и в сборке без Codex строки нет, иначе каждый, кто не выбирал Codex, видел бы жёлтую точку; Ticket этот случай не называет. Строка проверяется на fake app-server и stand-in, настоящий Codex не запускался.

## 4. Session Codex без `GH_TOKEN` говорит сама

Code: `src/main/vendors/codex/session.ts:948-956` · key lines: 952, 953, 954, 955

```ts
  } catch (error) {
    // The reason names the account (accountAuth); a token gh let slip into it is cut all the same. The
    // Session starts without one, and says so in its transcript with "Open Health check", where the
    // GitHub access row of its Project fails now (worfy-auth-check ticket 08).
    const reason = redactSecrets(messageOf(error))
    options.log?.(`[codex] no GH_TOKEN for the Session: ${reason}`)
    session.notice(noGhTokenNotice(reason), 'open-health-check')
    options.githubFailure?.(opts.cwd, reason)
  }
```

- Что делает: причина проходит `redactSecrets` до log, `notice` и Health check; Session кладёт `notice` первым событием транскрипта с полем `action: 'open-health-check'`, а приложение (`appGithubFailure`) находит Project папки Session и зовёт `reportFailure('github-access', …)`, после чего строка проверяется заново (повторная проверка Ticket-а 05). Renderer рисует под таким `notice` ссылку «Open Health check» (`Transcript.tsx`, `fold.ts`; схема события — `src/shared/agent/events.ts`).
- Почему здесь: Ticket, «Что делаем», п. 2, называет `session.ts:936`.
- Без него: Session шла бы без GitHub молча, а пользователь видел бы только отказ `gh` в ответах агента.
- Требование: [Что делаем, п. 2]({T}#что-делаем)
- Риски и пробелы test-ов: contract test проверяет `notice`, log и сообщение на fake app-server; путь `appGithubFailure` (поиск Project-а по папке) держит Electron и test-ом не покрыт.

## 5. Browser: одна строка Project-а на все истёкшие profile

Code: `src/main/mcp/browser-server.ts:137-147` · key lines: 138, 139, 141, 144, 145

```ts
  private tell(): void {
    const all = [...this.expiredOn.values()]
    const last = all.at(-1)
    if (last === undefined) {
      this.reports.reportOk('browser-profile', this.project)
      return
    }
    const reason = all.map(({ why }) => why).join('; ')
    this.reports.reportFailure('browser-profile', this.project, reason, 'Sign in in the Browser of this profile: a Session never signs in itself', [{ id: 'open-browser', label: 'Open Browser', node: last.browser }])
  }
}
```

- Что делает: `BrowserSignInRow` одна на Project и общая для его Session; она держит profile с истёкшим входом и называет каждый в строке. «Open Browser» указывает на Browser последнего. Когда снят последний profile, строка уходит через `reportOk`.
- Почему здесь: `health-reports` держит одну строку на пару «id, Project»; без такого сбора `reportOk` одного profile снял бы и сбой другого.
- Без него: два истёкших profile дали бы одну строку, и удачная страница первого стёрла бы сбой второго.
- Требование: [Что делаем, п. 3]({T}#что-делаем)
- Риски и пробелы test-ов: имя Project-а берётся при первом сбое и не следит за переименованием.

## 6. Где Browser сообщает

Code: `src/main/mcp/browser-server.ts:240-248` · key lines: 242, 245

```ts
    const expired = signInExpiry(profile, answer.url, page.documentStatus())
    if (expired === null) {
      context.signIns?.works(profile)
      return answer
    }
    context.signIns?.expired(profile, id, expired)
    if (autopilot) throw new ToolError(`${expired} Do not sign in yourself: stop the checks under this profile and report "sign-in expired in Browser profile ${profile.name}". Browser ${id} is at ${answer.url}.`)
    return { ...answer, signIn: `${expired} Do not sign in yourself: ask the user to sign in in this Browser.` }
  }
```

- Что делает: каждый ответ, который мог сменить страницу, говорит Health check «вход истёк» или «вход работает»; отказ на странице входа до того, как Session взяла Browser (Autopilot, `onSignIn`), тоже сообщает «истёк». Ответ агенту не меняется.
- Почему здесь: Ticket называет `browser-server.ts:175-178` и `:248-249` — это `arrived` и `onSignIn`.
- Без него: строка не появилась бы, а появившись — не снималась бы.
- Требование: [Что делаем, п. 3]({T}#что-делаем)
- Риски и пробелы test-ов: `works` зовётся на каждой удачной странице; без истёкшего profile это ничего не делает.

## 7. Link: одна строка Linked machine

Code: `src/main/link/health.ts:52-60` · key lines: 55, 58

```ts
  private tell(): void {
    if (this.reports === undefined) return
    if (this.problems.size === 0) {
      this.reports.reportOk('linked-machine', undefined)
      return
    }
    this.reports.reportFailure('linked-machine', undefined, [...this.problems.values()].join('; '), LINK_AGAIN_STEP, [{ id: 'link-machine', label: 'Link a machine…' }])
  }
}
```

- Что делает: `LinkHealth` держит проблемы по Machine и одну для файла секретов; `LinkService` сообщает смену сертификата, удачное соединение, повторную связь по коду и удаление Machine. Файл секретов: `FileSecretStore.setAside` называет имя, под которым файл отложен, и сервис сообщает его сразу после старта. В строке только имя Machine и имя файла.
- Почему здесь: Ticket называет `service.ts:487-489`, `:532` и `secrets.ts:54-58`; отдельный маленький файл `health.ts` — чтобы не растить `service.ts` (за пределами следа Ticket-а, сказано в отчёте).
- Без него: Machine с другим сертификатом и потерянные токены остались бы только в log и chip sidebar.
- Требование: [Что делаем, п. 4]({T}#что-делаем)
- Риски и пробелы test-ов: проблема файла секретов снимается первой же повторной связью или соединением — даже если другие Machine всё ещё без токена.

## 8. Кнопки строк в Health check

Code: `src/renderer/shell/FirstRunChecks.tsx:476-501` · key lines: 480, 485, 486, 494, 498

```tsx
    if (action === 'open-browser') {
      const node = check.actions.find((each) => each.id === 'open-browser')?.node
      const target = check.project
      if (node === undefined || target === undefined) return
      const failed = await openProject(null, target.id)
      if (failed !== undefined) {
        setMessage({ error: true, text: failed })
        return
      }
      setView('canvas')
      focusCanvasNode(target.id, node)
      if (shown.current) onTerminalOpened()
      return
    }
    // "Sign in to Codex…" (ticket 08): the sign-in of Settings → Vendors, in the browser. It may take
    // minutes, so it holds no lock; the checks run again once it is over.
    if (action === 'codex-sign-in') {
      setMessage({ error: false, text: 'Sign in to Codex in the page it opened in your browser' })
      const result = await invoke('vendors.startLogin', { vendor: 'codex' })
      if (!result.ok) setMessage({ error: true, text: failureReason('vendors.startLogin', result.error) })
      else {
        setMessage(null)
        void checkAgain()
      }
      return
    }
```

- Что делает: «Open Browser» делает Project строки текущим, показывает Browser на Canvas и закрывает Settings; «Sign in to Codex…» запускает вход Settings → Vendors (`vendors.startLogin`) без блокировки других кнопок и после него проверяет заново; «Link a machine…» открывает диалог Link a machine поверх Health check.
- Почему здесь: кнопки объявил Ticket 03 и оставил их пустыми до Ticket-ов своих строк; файл вне следа Ticket-а 08, сказано в отчёте.
- Без него: кнопки строк ничего бы не делали.
- Требование: [Что делаем, п. 1, 3, 4]({T}#что-делаем)
- Риски и пробелы test-ов: «Open Browser» для Project-а Linked machine не предусмотрен — строки Browser рождаются только на своей Machine.

## 9. Что сознательно не меняли

- `src/shared/health/severity.ts` не правили: все три строки уже non-critical.
- `health-reports.ts` по Ticket-у «только читать», но `reportFailure` получил необязательный пятый аргумент — кнопки строки:
  у строки из сообщения иначе не было бы ни «Open Browser», ни «Link a machine…». Сказано в отчёте.
- Переводы `docs/features/ru/` — Ticket 09.

## 10. Как проверено

- `test/contract/codex-account.test.ts`, `test/contract/codex-session-gh-token.test.ts`, `test/contract/browser-tools.test.ts`,
  `test/contract/link-reconnect.test.ts`, `test/contract/first-run-checks.test.ts`, `test/unit/link-secrets-write.test.ts`,
  `test/unit/settings-health.test.tsx`, `test/unit/session-view.test.tsx` — новые случаи сначала красные, потом зелёные.
- `pnpm lint && pnpm typecheck && pnpm test` и gate fast — коды выхода в отчёте implementer-а.

## Проверить себя

1. Почему строка Codex — `unknown`, а не `fail`, когда app-server не стартовал?
   Ответ: проверить вход не удалось; `readCodexSignIn` отдаёт `not-started`, и строка говорит «Couldn't check» — `unknown` никогда не critical (Q2).
   Lines: `src/main/first-run/vendor-checks.ts:45-61`
2. Что случится со строкой Browser profile, если истекли «admin» и «user», а потом удачно открылась страница под «user»?
   Ответ: строка останется и назовёт только «admin», а «Open Browser» укажет на его Browser; уйдёт она с последним profile.
   Lines: `src/main/mcp/browser-server.ts:137-147`
3. Почему токен, который gh мог напечатать в ошибке, не попадает ни в `notice`, ни в log, ни в строку?
   Ответ: причина проходит `redactSecrets` один раз, до всех трёх получателей.
   Lines: `src/main/vendors/codex/session.ts:948-956`

## 11. Что нашёл review и что осталось

> VERIFIED
>
> **Consider** (all `[low]`, none block the merge):
> - `src/renderer/shell/FirstRunChecks.tsx:261`: the detail column is squeezed to 1–2 characters when the row has a button. The Codex row shows "n…" and the Linked machine row shows "th…"; see the screenshots below. The full text is only in the hover `title`. For Linked machine that text names the set-aside secrets file. The hint under the row still gives the step. The layout is the row's old one, but the new long texts make it visible.
> - `src/main/first-run/checks.ts:1005` and `:1061`: `runChecks` awaits the Codex row at the end, so a Codex app-server that hangs delays the whole Health check.
>   - There is no timeout of its own. The delay is bounded only by the RPC timeouts: `initialize` waits up to 60 s (`src/main/vendors/codex/rpc.ts:23`) and `account/read` up to 30 s (`account.ts:24`).
>   - The Health check can therefore stay on "Checking…" for up to 60 s. The unit test covers a source that rejects, not one that hangs.
> - `src/renderer/shell/FirstRunChecks.tsx:491`: "Sign in to Codex…" holds no action lock, so repeated clicks can start several logins. The report lists this as a decision made without the owner.
> - `src/main/mcp/browser-server.ts:150`: the Browser row's Project name is read once, when the row is created, so a renamed Project keeps the old name. `signInRows` also never drops a removed Project.
> - `src/main/first-run/vendor-checks.ts:8`: the comment says "no CODEX_HOME", but `codexHomeOf` (`account.ts:79`) falls back to `~/.codex`. Anyone with `~/.codex` and no Codex sign-in gets the yellow warning. The report's wording "у кого есть CODEX_HOME" is imprecise on this.
>
> **Noted** (the "removed" claims hold):
> - `readSecrets` has one caller, `FileSecretStore.load` (`secrets.ts:81`), and it is updated. No other callers exist in `src` or `test`.
> - The yellow dot is only non-critical. `src/shared/health/severity.ts:40` and `:60` make `codex-login` non-critical, and `unknown` is never critical. `worstLevel` returns `non-critical` for these rows.
> - A Codex Session without a GitHub account configured still starts silently, because `accountAuth` (`src/main/github/prs.ts:175`) returns `{}`. Only a gh failure for a configured account raises the notice and `reportFailure`.
> - Secrets: the notice, the log and the row reason all go through `redactSecrets` (`session.ts`, `health-reports.ts`, `vendor-checks.ts`). The Link row names a Machine and a file basename only. The secrets parse error is still not quoted (`secrets.ts:44-56`).
> - Link dialog: `migrating || linking` locks the other buttons (`FirstRunChecks.tsx:605`). I took the Link dialog screenshots below and the dialog opens over Settings.
>
> **Dismissed:** the report's gate red (exit 2) and the 19 failing files come from the environment. I ran the gate with the clean TMPDIR and without `GIT_CONFIG_PARAMETERS`, and it is green.
>
> **Confirmed** (what I ran):
> - `node scripts/vitest-electron.mjs run` on the 10 module files: 24 files passed, 919 tests passed, 8 skipped, EXIT=0.
> - `gate.mjs fast`: EXIT=0 with `[gate] green (fast): lint typecheck test` (lint 56 s, typecheck 64 s, test 370 s).
> - `pnpm build`: EXIT=0.
> - `bin/story-check --repo . --head HEAD <story>`: exit 0, 7 fragments ok.
> - `bin/ticket evidence`: 7 of 8 items verified. Item 8 (`pnpm test` and `ci-ok`) is the only one without evidence, as the report says. Commit `3116a6303` is an ancestor of HEAD.
> - Test stand-ins only; no real Codex was started. Settings → Health screenshots taken with the fake `signed-out` script and a damaged `link/secrets.json`. They ran under `/tmp/worfy-e2e.lock` after a screen-lock check; the lock was released and no processes were left. No worktree file was edited.
>
> Screenshots in `/tmp/claude-501/verify-2030/screens/`. All six were taken in Settings → Health:
> - `health-08-light.png` / `health-08-dark.png`: "3 failed · 3 warnings", the Codex group with a "Codex sign-in" Warning and a "Sign in to Codex…" button, and the Linked machine group with a Failed row, a "Link a machine…" button and the step in the hint. Both rows are marked Non-critical.
> - `health-08-codex-light.png` / `health-08-codex-dark.png`: the same view, with the Codex row in focus. The detail is truncated to "n…".
> - `health-08-link-dialog-light.png` / `health-08-link-dialog-dark.png`: the "Link a machine" dialog open over Settings, showing the code and the address field. Contrast and layout are fine in both themes.
>
> **Could not verify:**
> - There is no screenshot of the Codex Session notice with "Open Health check", nor of the Browser profile row. Both need a live Session or an expired Browser login; the unit tests cover them.
> - `ci-ok` and macos-e2e were not waited for, as instructed.
> - No mutation testing at review depth low.
>
> **Review depth:** low (wave verifier).
> **Review tokens:** not measured.
>
> outside the diff: `src/renderer/shell/FirstRunChecks.tsx:487` — the `open-link` button still does nothing; the ticket says this is ticket 06's job.

Code: `src/renderer/shell/FirstRunChecks.tsx:261-261` · key lines: 261

```tsx
      aria-busy={busy !== null || checking ? 'true' : undefined}
```

Code: `src/main/first-run/checks.ts:1005-1005` · key lines: 1005

```ts
  // The Vendor rows run beside the Machine's; they never reject (vendor-checks.ts), a broken source adds none.
```

Code: `src/main/vendors/codex/rpc.ts:23-23` · key lines: 23

```ts
export const REQUEST_TIMEOUT_MS = 60_000
```

Code: `src/renderer/shell/FirstRunChecks.tsx:491-491` · key lines: 491

```tsx
    // minutes, so it holds no lock; the checks run again once it is over.
```

Code: `src/main/mcp/browser-server.ts:150-150` · key lines: 150

```ts
const signInRows = new Map<string, BrowserSignInRow>()
```

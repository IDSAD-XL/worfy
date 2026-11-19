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

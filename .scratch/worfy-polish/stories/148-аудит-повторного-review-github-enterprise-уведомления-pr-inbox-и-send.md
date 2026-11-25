# Code story — worfy-polish 148: Аудит повторного review: GitHub Enterprise, уведомления PR inbox и Send

Kind: pr · Epic: worfy-polish · Ticket: 148 · PR: - · Language: ru

## 1. Что было не так

Четыре находки аудита про вызовы GitHub из main process. `accountAuth` всегда просил token как `gh auth token -u
<account>` без `--hostname` и отдавал его в `GH_TOKEN`; для host-а GitHub Enterprise Server gh не читает `GH_TOKEN`, и
право на запись проверялось под активным аккаунтом host-а (157, 158). Первое чтение PR inbox, остановленное паузой
rate limit между страницами details, становилось baseline уведомлений, и следующее полное чтение сообщало о старых PR
как о новых (165). Ветка «отметку in-flight не удалось записать» в Send не была закреплена test-ом (181).

- Требование: [Что происходит](../issues/148-аудит-повторного-review-github-enterprise-уведомления-pr-inbox-и-send.md#что-происходит)

## 2. accountAuth знает host и кладёт token в переменную этого host-а

Code: `src/main/github/prs.ts:175-204` · key lines: 177, 191, 192, 196, 204

```ts
export function tokenVariable(host: string): 'GH_TOKEN' | 'GH_ENTERPRISE_TOKEN' {
  const name = host.toLowerCase()
  return name === 'github.com' || name.endsWith('.ghe.com') ? 'GH_TOKEN' : 'GH_ENTERPRISE_TOKEN'
}

/**
 * The token of the Project's account, from `gh auth token -u <account>` (with `--hostname` for a host other than
 * github.com), in the variable gh reads for that host (tokenVariable). Without an account, no
 * extra environment: gh runs as before, with the login shell's own account. With an account gh has
 * no login for, the read fails with a reason naming the account — falling back to the global
 * account would show another account's answer or the same refusal.
 */
export function accountAuth(options: AccountAuthOptions): GhAuth {
  return async (root): Promise<GhEnv> => {
    const account = await options.account(root)
    if (account === null) return {}
    const host = ((await options.host?.(root)) ?? 'github.com').toLowerCase()
    const onHost = host === 'github.com' ? [] : ['--hostname', host]
    const how = `run \`gh auth login${host === 'github.com' ? '' : ` --hostname ${host}`}\` and sign in as ${account}`
    let printed: string
    try {
      printed = await options.run(['auth', 'token', '-u', account, ...onHost], root)
    } catch (error) {
      // gh's own reason (no login, gh not found); it never contains a token.
      throw new Error(`no gh login for ${account}, the Project's GitHub account: ${messageOf(error)}; ${how}`, { cause: error })
    }
    const token = printed.trim()
    // The output is not quoted in the reason: it may be a token in an unexpected shape.
    if (!TOKEN_SHAPE.test(token)) throw new Error(`gh auth token -u ${account} printed no token; ${how}`)
    return { [tokenVariable(host)]: token }
```

- Что делает: новое необязательное поле `host` даёт host repository Project-а. Для host-а не github.com token
  просится с `--hostname <host>` и возвращается как `GH_ENTERPRISE_TOKEN`; для github.com и `*.ghe.com` — как раньше,
  без `--hostname`, в `GH_TOKEN`. Подсказка при отсутствии login-а называет `gh auth login --hostname <host>`.
- Почему здесь: Ticket, «Что делаем», п. 1 и 2, называет `accountAuth` (`prs.ts:160-191`); то, что gh читает
  `GH_ENTERPRISE_TOKEN` для Enterprise и не смотрит на `GH_TOKEN`, записано в Ticket-е.
- Без него: token Enterprise-аккаунта ищется на github.com («no gh login for …»), а найденный token лежит в
  переменной, которую gh для этого host-а не читает.
- Требование: [Что делаем](../issues/148-аудит-повторного-review-github-enterprise-уведомления-pr-inbox-и-send.md#что-делаем)
- Риски и пробелы test-ов: без `host` поведение прежнее; вызовы `accountAuth` вне шага аккаунтов host не передают
  (PR checks, PR inbox, Send и другие) — Итог Ticket-а объясняет, почему это отдельная работа. Правило `*.ghe.com`
  проверено только вызовом `tokenVariable`, не через gh.

## 3. Шаг аккаунтов передаёт host аккаунта

Code: `src/main/github/accounts.ts:189-191` · key lines: 191

```ts
      try {
        // GH_ENTERPRISE_TOKEN for a GitHub Enterprise Server host: gh reads GH_TOKEN for github.com only.
        token = await accountAuth({ account: () => Promise.resolve(account.login), host: () => Promise.resolve(account.host), run: deps.gh })(cwd)
```

- Что делает: каждый аккаунт берёт token своего host-а через `accountAuth`, и `pushAccess` зовёт `gh api
  repos/<o>/<r> --hostname <host>` с этим окружением. Прежний runner, который дописывал `--hostname` к `gh auth token`,
  убран: это теперь делает `accountAuth`.
- Почему здесь: Ticket, «Что делаем», п. 2: «проверка записи в `accounts.ts` идёт с ним».
- Без него: на host-е с двумя аккаунтами проверка второго шла под активным, и Project получал чужой финиш.
- Требование: [Что делаем](../issues/148-аудит-повторного-review-github-enterprise-уведомления-pr-inbox-и-send.md#что-делаем)
- Риски и пробелы test-ов: stand-in `gh` теперь выбирает token по host-у, как настоящий; поведение настоящего gh
  взято из Ticket-а, на живом Enterprise не проверялось.

## 4. Stand-in gh берёт token так, как gh

Code: `test/fixtures/gh/gh-stub.mjs:233-236` · key lines: 234, 235, 236

```js
  // As gh: the token of the asked host's variable, else that host's active account (worfy-polish 148).
  const host = (option('--hostname') ?? 'github.com').toLowerCase()
  const fromEnv = hostToken(host)
  const login = fromEnv !== null ? Object.keys(tokens).find((name) => tokens[name] === fromEnv) : (read('auth-status.json', { hosts: {} }).hosts[host] ?? []).find((entry) => entry.active === true && entry.state === 'success')?.login
```

- Что делает: `api repos/<o>/<r>` отвечает за login того token-а, который gh взял бы для host-а: `GH_TOKEN` для
  github.com, `GH_ENTERPRISE_TOKEN` для Enterprise; без него — за активный аккаунт host-а.
- Почему здесь: Ticket, «Готово, когда», п. 157, проверяет переменную через stand-in `gh` из `gh-world.ts`. Прежний
  stand-in отвечал по `GH_TOKEN` на любом host-е, поэтому test worfy-polish 71 с одним Enterprise-аккаунтом был
  зелёным и при ошибке.
- Без него: test 157 не отличает правильную переменную от неправильной.
- Требование: [Готово, когда](../issues/148-аудит-повторного-review-github-enterprise-уведомления-pr-inbox-и-send.md#готово-когда)
- Риски и пробелы test-ов: без token-а в окружении на github.com stand-in теперь отвечает за активный аккаунт, а не 404;
  все test-ы `pnpm test` с этим зелёные.

## 5. Первое чтение с ошибкой не становится baseline

Code: `src/main/notify.ts:678-682` · key lines: 682

```ts
    if (snapshot.readAt === null || snapshot.viewer === null) return
    const before = this.seen.get(project.id)
    // A first read that stopped part way (a rate-limit pause between pages of details) lacks the rows of the PRs it
    // did not reach: as the baseline, the next full read would tell of those old PRs as new (worfy-polish 148).
    if (before === undefined && snapshot.error !== null) return
```

- Что делает: пока у Project-а нет baseline, snapshot с `error` пропускается целиком; baseline — первое чтение без
  ошибки. После baseline чтение с ошибкой сравнивается, как раньше.
- Почему здесь: Ticket, «Что делаем», п. 3. Reader ставит `readAt` и `error` = причина паузы, даже когда цикл страниц
  details остановился (`src/main/github/inbox.ts:748-755`); reader по Ticket-у только читаем.
- Без него: первое чтение Project-а с сотней PR, упёршееся в rate limit, даёт после reset пачку «Review requested» о
  старых PR.
- Требование: [Что делаем](../issues/148-аудит-повторного-review-github-enterprise-уведомления-pr-inbox-и-send.md#что-делаем)
- Риски и пробелы test-ов: Project, у которого каждое чтение кончается ошибкой, не получает baseline и не уведомляет;
  test этого случая нет.

## 6. Test: запись отметки in-flight падает

Code: `test/contract/pr-inbox-send.test.ts:573-592` · key lines: 578, 584, 586, 587, 589, 590

```ts
  it('the in-flight mark cannot be written: refused, no POST, the draft not marked sent (worfy-polish 148)', async () => {
    const s = await setup([threadItem('The server drops one try.')], {
      over: {
        // The write of the mark fails as a full disk would: its temporary file holds IN_FLIGHT, and the rename is refused.
        beforeRename: async (file) => {
          const pending = readdirSync(dirname(file)).filter((name) => name.endsWith('.tmp')).map((name) => readFileSync(join(dirname(file), name), 'utf8'))
          if (pending.some((text) => text.includes(IN_FLIGHT))) throw new Error('ENOSPC: no space left on device, write')
        },
      },
    })
    const answer = ok(await s.call<SendAnswer>('prInbox.send', { ...pull, items: [{ ...threadRef(), body: 'The server drops one try.' }] }))
    expect(answer.results[0]).toMatchObject({ outcome: 'refused', sentUrl: null })
    expect(answer.results[0]!.reason).toContain('could not be marked before the post')
    expect(answer.results[0]!.reason).toContain('ENOSPC')
    expect(writes(s.gh)).toEqual([])
    expect(posted(s.gh)).toEqual([])
    const item = s.draft().items[0]!
    expect(item).toMatchObject({ state: 'draft', sentUrl: null })
    expect(item.error).not.toBe(IN_FLIGHT)
  })
```

- Что делает: hook `beforeRename` отказывает именно той записи, временный файл которой несёт `IN_FLIGHT`. Send
  отвечает `refused` с причиной, stand-in `gh` не получил POST, draft остался `draft` без отметки.
- Почему здесь: Ticket, «Готово, когда», п. 181 — рядом с `:582`.
- Без него: правка, после которой POST идёт без отметки, не ловится test-ами, а сбой посреди отправки и повтор
  публикуют ответ дважды.
- Требование: [Готово, когда](../issues/148-аудит-повторного-review-github-enterprise-уведомления-pr-inbox-и-send.md#готово-когда)
- Риски и пробелы test-ов: код Send не менялся, test закрепляет верное поведение; красным его делает mutant «post
  после неудачной отметки».

## 7. Что сознательно не меняли

Вызовы `accountAuth` вне шага аккаунтов (PR checks, PR inbox, Send, review submit, pr-search, changes) host не
передают: PR inbox читает только github.com, Work track зовёт gh без `--hostname`. Поддержка Enterprise там — вне
следа Ticket-а. Reader PR inbox (`inbox.ts`) не трогали: по Ticket-у его только читать.

## 8. Как проверено

Test-ы 157, 158 и 165 — красные на исходниках origin/main (exit 1), зелёные после правки. Test 181 зелёный на main,
mutant «post после неудачной отметки» — красный (exit 1). `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0;
gate fast — exit 0.

## Проверить себя

1. Почему проверка записи второго аккаунта на Enterprise раньше могла сказать «есть доступ», хотя его нет?
   - Ответ: token лежал в `GH_TOKEN`, который gh для Enterprise-host-а не читает, и gh спрашивал GitHub под активным
     аккаунтом этого host-а; теперь token идёт в `GH_ENTERPRISE_TOKEN`.
   - Строки: `src/main/github/prs.ts:175-178`
2. Что notifier делает со snapshot-ом с ошибкой, когда baseline у Project-а уже есть?
   - Ответ: сравнивает с прошлым чтением, как раньше; пропускается только чтение с ошибкой до первого baseline.
   - Строки: `src/main/notify.ts:682`
3. Как test 181 роняет именно запись отметки, а не другие записи файла drafts?
   - Ответ: `beforeRename` смотрит во временные файлы рядом и бросает ошибку, только когда в одном из них есть
     `IN_FLIGHT`.
   - Строки: `test/contract/pr-inbox-send.test.ts:577-580`

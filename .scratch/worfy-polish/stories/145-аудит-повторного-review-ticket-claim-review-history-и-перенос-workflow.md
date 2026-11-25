# Code story — worfy-polish 145: Аудит повторного review: ticket claim, review-history и перенос workflow

Kind: pr · Epic: worfy-polish · Ticket: 145 · PR: - · Language: ru

## 1. Что было не так

Четыре находки аудита повторного review смёрженных PR, все в script-ах Harness-а. `ticket claim` молча
перезаписывал чужой claim: две Session с разными `--branch` обе брали один Ticket (97). Перенос workflow между Full и
Silent mode (`profile-set --move`) спрашивал `gh pr list` под глобальным аккаунтом gh, а не под `github.account`
Project-а (113), и не переносил папку Product Session: `docs/product` оставалась в repository (114). У
`review-history` дочитывание второй страницы review threads, comments PR и comments внутри thread-а не закрепляли
test-ы (21).

- Требование: [Что происходит](../issues/145-аудит-повторного-review-ticket-claim-review-history-и-перенос-workflow.md#что-происходит)

## 2. claim не берёт Ticket, который держит другая branch

Code: `harness/bin/ticket:669-679` · key lines: 669, 670, 671

```js
if (cmd === "claim" && !forceArg && sh.kind === "new" && STATUS_NEW.exec(lines[sh.first])[1] === "claimed") {
    const held = branchOf(lines, sh.code)
    if (held && held !== branchArg) {
        const since = STATUS_NEW.exec(lines[sh.first])[2]
        die(
            `${rel(target)}: already claimed${since ? ` ${since}` : ""} by branch ${held}; ` +
                `${branchArg === null ? "no --branch given" : `--branch ${branchArg} is another branch`}. ` +
                `Resume your own claim with --branch ${held}, or take the ticket over with --force; nothing written`,
        )
    }
}
```

- Что делает: Ticket в состоянии `claimed` со строкой `Branch:` принадлежит этой branch. claim с другой `--branch`
  или без неё — exit 1, файл не тронут, в ошибке прежняя branch и время claim-а. Та же `--branch` проходит, как
  раньше; `--force` перезаписывает. Ticket в `open`, `blocked` или без `Branch:` берётся как раньше. Branch читает
  `branchOf` (`harness/bin/ticket:776-784`) так же, как `epic-status`: последняя строка `Branch:` вне блоков кода,
  без `*` и обратных кавычек (review round 1, п. 1: ``Branch: `fix/a` `` с `--branch fix/a` давал отказ своей же
  branch).
- Почему здесь: Ticket называет `harness/bin/ticket:600-700` (разбор `claim`, запись Status) и задаёт правило в
  «Что делаем», п. 2. Проверка стоит после проверок `--repo`: ошибка аргументов («named twice») по-прежнему
  выигрывает.
- Без него: вторая Session молча заменяла время и `Branch:` первой, и обе делали один Ticket.
- Требование: [Что делаем, п. 2](../issues/145-аудит-повторного-review-ticket-claim-review-history-и-перенос-workflow.md#что-делаем)
- Риски и пробелы test-ов: повторный claim без `--branch` своего же Ticket-а теперь отказан, поэтому команда шага 1
  ship-ticket, ответ владельца в epic-wave, пример `--repo` в `TICKETS.md` и подсказка `claim --branch … --repo …`
  в `ticket` дают `--branch`. В Full mode с worktree на каждую Session у каждой branch своя копия файла Ticket-а:
  claim в другом worktree проверка не видит (`TICKETS.md` так и говорит).

## 3. Product Session folder едет из одного места в другое

Code: `harness/lib/workflow-move.cjs:329-343` · key lines: 334, 336, 340

```js
    const moves = []
    const paths = workflowPaths(profile)
    const pairs = paths.map((rel) => ({ rel, to: rel }))
    // The Product Session folder, from its path on this side to its path on the other. A workflow path that holds it
    // or lies inside it on either side moves as it is: the folder is not moved twice.
    const product = { rel: PRODUCT_DIR[from], to: PRODUCT_DIR[to] }
    const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
    if (product.rel && product.to && !paths.some((p) => overlap(p, product.rel) || overlap(p, product.to))) pairs.push(product)
    for (const pair of pairs) {
        const files = trackedFiles(source, pair.rel)
        if (files.length === 0) continue
        if (fs.existsSync(path.join(target, ...pair.to.split("/"))))
            problems.push(`${pair.to} is already in ${to === "silent" ? "the Workflow folder" : "the repository"}: nothing is moved over it`)
        moves.push({ ...pair, files })
    }
```

- Что делает: у каждого переноса теперь есть путь на стороне, откуда файлы уходят (`rel`), и на стороне, куда
  приходят (`to`). У обычных путей они равны; у папки Product Session — `docs/product` в repository и `product` в
  Workflow folder (`PRODUCT_DIR`, копия констант `src/shared/product/paths.ts`). Нет папки — нет файлов, нечего
  переносить. Папка уже на новом месте — отказ, как у остальных путей.
- Почему здесь: Ticket называет `workflowPaths` (`:100-130`) и требует для пары «те же проверки и откат, что у
  остальных папок». Пути разные на двух сторонах, поэтому пара не влезает в `workflowPaths`, который возвращает
  один путь для обеих.
- Без него: перенос Full → Silent оставлял темы и Mind map в публичном repository, а Product Session открывала
  пустую `<Workflow folder>/product`.
- Требование: [Что делаем, п. 4](../issues/145-аудит-повторного-review-ticket-claim-review-history-и-перенос-workflow.md#что-делаем)
- Риски и пробелы test-ов: когда другой workflow path содержит `docs/product` (например, lessons в `docs`), папка
  едет внутри него и в Silent mode окажется в `docs/product`, а не в `product` — решено без владельца. Это и отказ
  «`product` уже в Workflow folder» закреплены test-ами (`profile-set-move.test.sh`, project `nest`;
  `profile-set-move-recover.test.sh`, папка `pre2`); mutant без каждой из двух проверок — красный. Текст
  подтверждения переноса в worfy (`src/renderer/projects/MoveWorkflow.tsx`) называет папку Product Session.

## 4. Имя файла на принимающей стороне

Code: `harness/lib/workflow-move.cjs:110-116` · key lines: 113

```js
function targetName(moves, file) {
    for (const m of moves) {
        const to = m.to ?? m.rel
        if (to !== m.rel && (file === m.rel || file.startsWith(`${m.rel}/`))) return to + file.slice(m.rel.length)
    }
    return file
}
```

- Что делает: даёт имя файла на стороне, куда он приходит. Через неё идут копирование (`runMove`), список копий для
  отката (`state.copied`), `git add` на принимающей стороне, проверка `.gitignore` и восстановление после
  убитого переноса (`recoverMove`: какие файлы на принимающей стороне — копии переноса, и сравнение копии с
  оригиналом байт в байт). Marker переноса хранит пары в поле `renames`; marker без него читается как раньше.
- Почему здесь: not recorded — Ticket требует только откат для новой пары; общая функция — способ не держать два
  списка имён.
- Без него: откат удалял бы копии по именам стороны-источника и оставлял `product/` в Workflow folder; убитый
  перенос считал бы копии в `product/` чужими файлами.
- Требование: [Что делаем, п. 4](../issues/145-аудит-повторного-review-ticket-claim-review-history-и-перенос-workflow.md#что-делаем)
- Риски и пробелы test-ов: восстановление проверено на переносе Full → Silent (`profile-set-move-recover.test.sh`);
  убитый перенос Silent → Full с папкой `product` отдельным test-ом не покрыт.

## 5. Открытые PR — под token-ом аккаунта Project-а

Code: `harness/lib/workflow-move.cjs:246-262` · key lines: 251, 252, 256

```js
function openPrs(repo, gh, account) {
    const remotes = git(repo, ["remote"])
    if (remotes.status === 0 && remotes.stdout.trim() === "") return { prs: [] }
    // gh runs git too: an inherited GIT_DIR would point the check at another repository.
    const env = { ...gitEnv(), GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" }
    const token = accountToken(gh, account, env)
    if (token !== null) env.GH_TOKEN = token
    const r = runGh(gh, ["pr", "list", "--state", "open", "--limit", "500", "--json", "number,headRefName"], { cwd: repo, env })
    if (r.error) return { error: r.error.code === "ENOENT" ? "gh not found" : r.error.message }
    if (r.status !== 0) {
        const unused = typeof account === "string" && account !== "" && token === null
        return { error: `${said(r)}${unused ? ` (gh has no login under github.account ${account}: asked under the caller's gh account)` : ""}` }
    }
    try {
        const list = JSON.parse(r.stdout)
        if (!Array.isArray(list)) throw new Error("not a list")
        return { prs: list.filter((pr) => isObject(pr) && typeof pr.headRefName === "string") }
```

- Что делает: при `github.account` в profile берёт token этого аккаунта через `gh auth token -u <account>`
  (`accountToken`, без GH_TOKEN вызывающего в окружении) и кладёт его в `GH_TOKEN` только для `gh pr list`. Без
  аккаунта или без login-а gh под ним — как раньше, под GH_TOKEN или аккаунтом вызывающего; ошибка тогда говорит,
  что аккаунт не использован. Token не попадает ни в вывод, ни в ошибку.
- Почему здесь: Ticket называет `openPrs` (`:190-210`) и `gh-token-env.mjs` как образец получения token-а.
- Без него: `profile-set` из терминала или из worfy спрашивал под глобальным аккаунтом; private repository
  аккаунта Project-а давал ошибку gh, и перенос отказывал.
- Требование: [Что делаем, п. 3](../issues/145-аудит-повторного-review-ticket-claim-review-history-и-перенос-workflow.md#что-делаем)
- Риски и пробелы test-ов: gh в test-ах — stand-in; настоящий `gh auth token -u` не вызывался.

## 6. Вторые страницы review-history закреплены test-ом

Code: `harness/bin/tests/review-history.test.sh:181-192` · key lines: 183, 186, 190

```bash
# A pull request whose review threads, conversation comments and comments of one thread each run past their first
# page: the text of every second page reaches raw/.
rh readon "$FIX/read-on" fetch; rc=$?
[ "$rc" -eq 0 ] && raw_has readon "FIRST-PAGE-THREAD-TEXT" && raw_has readon "FIRST-PAGE-COMMENT-TEXT" \
    && ok "fetch read-on: exit 0, the first pages are in raw/" || bad "fetch read-on: exit $rc $(cat "$T/err")"
for kind in "SECOND-PAGE-THREAD-TEXT|ReviewHistoryThreads cursor=t2|a review thread on the second page of threads" \
    "SECOND-PAGE-COMMENT-TEXT|ReviewHistoryComments cursor=k2|a conversation comment on the second page of comments" \
    "SECOND-PAGE-THREAD-REPLY-TEXT|ReviewHistoryThreadComments cursor=c2|a reply on the second page of a thread's comments"; do
    text="${kind%%|*}" rest="${kind#*|}"
    raw_has readon "$text" && grep -q "op=${rest%%|*}" "$T/gh-readon.log" && ok "fetch reads on ${rest#*|}" \
        || bad "fetch reads on ${rest#*|}: missing in raw/ or not requested $(cat "$T/gh-readon.log")"
done
```

- Что делает: новая папка fixtures `read-on/` — один PR, у которого threads, comments PR и comments thread-а `T1`
  уходят на вторую страницу (`hasNextPage: true`). Test проверяет, что текст каждой второй страницы есть в `raw/` и
  что запрос второй страницы был.
- Почему здесь: Ticket называет `review-history.test.sh` и папку fixtures; отдельная папка не меняет счёты
  `estimate` у fixture-а `filter`.
- Без него: поломка `readOn` для threads или comments проходила бы зелёной.
- Требование: [Готово, когда — 21](../issues/145-аудит-повторного-review-ticket-claim-review-history-и-перенос-workflow.md#готово-когда)
- Риски и пробелы test-ов: код `review-history` не менялся. Три mutant-а (без `readOn` для `reviewThreads`, для
  `comments`, для comments thread-а) — каждый красный.

## 7. Binding не берёт отказанный claim

Code: `src/shared/binding/signals.ts:110-124` · key lines: 113, 120, 123

```ts
        const claim = claimIn(input.command)
        if (claim) {
          // A claim counts from its call, as before; a result that says it was refused takes it back.
          pendingClaim = { id: event.id, previous: signals.claim }
          set({ claim })
        }
      } else if (event.name === 'Skill' && typeof input.skill === 'string') {
        const name = skillName(input.skill)
        if (name) set({ skill: { name, args: cap(typeof input.args === 'string' ? input.args.trim() : '', ARGS_MAX) } })
      }
    } else if (event.type === 'tool_result' && pendingClaim !== null && event.toolUseId === pendingClaim.id) {
      // An error result is the claim's exit code when the claim is the command's last one; the refusal text, when a
      // command after it hides that code. A claim refused otherwise behind such a command still counts.
      if (event.isError || CLAIM_REFUSED.test(event.content)) set({ claim: pendingClaim.previous })
      pendingClaim = null
```

- Что делает: claim, как раньше, считается с вызова. Когда приходит его tool result и это ошибка (exit code не 0)
  или в тексте есть отказ `ticket claim` («already claimed … by branch»), Binding возвращается к claim-у до него.
- Почему здесь: review round 1, п. 6 — Binding брал последнюю команду `ticket claim` без её исхода, и Session,
  которой отказала новая проверка, привязывалась к чужому Ticket-у.
- Без него: узел отказанной Session на холсте стоял бы у Ticket-а другой Session.
- Требование: [Что происходит, 97](../issues/145-аудит-повторного-review-ticket-claim-review-history-и-перенос-workflow.md#что-происходит)
- Риски и пробелы test-ов: claim, отказанный по другой причине (старая шапка, неизвестный флаг) за командой вроде
  `; echo "EXIT=$?"`, по-прежнему считается: tool result не ошибка, а текста отказа нет. Binding Codex
  (`src/main/vendors/codex/binding.ts`) исход команды не читает.

## 8. Как проверено

- `bash harness/bin/tests/ticket-header.test.sh` — exit 0; на origin/main четыре новых case-а красные.
- `bash harness/bin/tests/profile-set-move.test.sh` — exit 0; на origin/main семь case-ов красные.
- `bash harness/bin/tests/profile-set-move-recover.test.sh` — exit 0; с `workflow-move.cjs` из origin/main и с
  mutant-ом без `targetName` в `recoverMove` — красный.
- `bash harness/bin/tests/review-history.test.sh` — exit 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — с кодами выхода в Evidence Ticket-а.

## Проверить себя

1. Почему Session, которая возобновляет свой Ticket, не получает отказ от `ticket claim`, а вторая Session —
   получает?
   - Ответ: отказ только когда `Branch:` в шапке есть и отличается от `--branch`; своя Session повторяет claim с
     той же `--branch`, чужая даёт другую или никакую.
   - Строки: `harness/bin/ticket:669-671`
2. Что сломалось бы в откате переноса Full → Silent, если бы копии записывались в `state.copied` под именами
   стороны-источника?
   - Ответ: копии лежат в `product/…`, а откат удалял бы `docs/product/…` на стороне Workflow folder — файлов там
     нет, и `product/` осталась бы.
   - Строки: `harness/lib/workflow-move.cjs:428-432`
3. Под каким аккаунтом спросит `gh pr list`, если `gh auth token -u <account>` упал?
   - Ответ: под GH_TOKEN или аккаунтом gh вызывающего — `env.GH_TOKEN` не меняется, как без аккаунта в profile.
   - Строки: `harness/lib/workflow-move.cjs:251-252`

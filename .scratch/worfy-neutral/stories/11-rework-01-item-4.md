# Code story — worfy-neutral 11: Rework of worfy-neutral 01, item 4

Kind: pr · Epic: worfy-neutral · Ticket: 11 · PR: - · Language: ru

## 1. Что было не так

Правила, которые получает новая Session (часть `common` hook-а `inject-rules`), называли настройку
`language.reports`, но не её значение. Session в репозитории worfy (профиль: reports = ru), которой задали вопрос
по-английски, отвечала по-английски: `rules.md` профиля с языком в Session не подмешивается
(`session.inject_rules: false`), а сама Session `bin/profile` не запускала.

- Требование: [Что происходит](../issues/11-rework-01-item-4.md#что-происходит)

## 2. Часть common получает раздел с языком перед правилами пользователя

Code: `harness/hooks/inject-rules.mjs:107-107` · key lines: 107

```js
    if (part === "common") additionalContext = withUserRules(withLanguage(additionalContext, event.cwd, here), event.cwd)
```

- Что делает: для части `common` — и в `SessionStart`, и в `SubagentStart` — сначала дописывает раздел о языке,
  потом правила пользователя; части `orchestrator`, `product` и `compaction` не меняются.
- Почему здесь: ticket называет hook `inject-rules` и сборку текста правил для SessionStart в «Где в коде»; `common`
  — единственная часть, которая доходит и до Session, и до каждого Subagent.
- Без него: ни Session, ни Subagent не видят значения языка.
- Требование: [Готово, когда, п. 2](../issues/11-rework-01-item-4.md#готово-когда)
- Риски и пробелы test-ов: раздел о языке занимает место внутри предела 10 000 символов, и правилам пользователя
  остаётся на ~380 символов меньше; test на обрезку правил пользователя идёт в папке без профиля и этого не видит.

## 3. Значение берётся у bin/profile, вне профиля — из user.json

Code: `harness/hooks/inject-rules.mjs:117-146` · key lines: 120, 123, 133, 141

```js
function withLanguage(base, cwd, here) {
    const dir = typeof cwd === "string" && cwd && isDir(cwd) ? cwd : process.cwd()
    const profileBin = process.env.CLAUDE_PROFILE_BIN || path.join(path.dirname(here), "bin", "profile")
    const run = spawnSync(process.execPath, [profileBin, "-C", dir, "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: PROFILE_WAIT_MS,
        windowsHide: true,
    })
    if (run.error) process.stderr.write(`inject-rules: bin/profile did not answer (${run.error.code || run.error.message}); the language of reports comes from user.json alone\n`)
    let profile
    if (run.status === 0) {
        try {
            profile = JSON.parse(run.stdout)
        } catch {}
    }
    const reports = profile?.language?.reports
    const tail = "Write them in this language even when the user writes in another one."
    if (typeof reports === "string" && reports) {
        const name = typeof profile?._resolved?.name === "string" && profile._resolved.name ? ` for project ${profile._resolved.name}` : ""
        const team = profile.language.team
        const teamLine = typeof team === "string" && team ? ` Team-facing text — commits, PRs, review comments, code comments — follows \`language.team\`: ${languageName(team)}.` : ""
        return `${base}\n\n## Language of this session\n\nReports and messages to the user: ${languageName(reports)}, the \`language.reports\` that \`bin/profile\` resolves${name} (the user's own setting first, then the profile). ${tail}${teamLine}`
    }
    const own = userReports(cwd)
    if (!own) return base
    // Exit 3 is "no profile covers this folder"; any other failure is a profile that could not be read.
    const why = run.status === 3 ? "no project profile covers this folder" : "the project profile could not be read"
    return `${base}\n\n## Language of this session\n\nReports and messages to the user: ${languageName(own)}, the user's own setting (\`language.reports\` in \`user.json\` of the Harness state folder); ${why}. ${tail}`
}
```

- Что делает: запускает `bin/profile -C <папка Session> --json` и называет `language.reports` и `language.team`
  из ответа словами («Russian (`ru`)»). Профиля нет или `bin/profile` упал — значение из `user.json`
  пользователя; нет и его — часть как была. Через 5 s ожидания `bin/profile` убивается, на stderr одна строка.
- Почему здесь: порядок «сначала настройка пользователя, потом профиль» уже живёт в `bin/profile`
  (profiles/README.md, «User personalization»); hook берёт готовое значение, а не повторяет правило.
- Без него: значение пришлось бы читать из `profile.json` в обход `user.json`, и настройка пользователя проигрывала
  бы профилю.
- Требование: [Готово, когда, п. 2 и 3](../issues/11-rework-01-item-4.md#готово-когда)
- Риски и пробелы test-ов: чтение `user.json` вне профиля повторяет правило `bin/profile` в упрощённом виде
  (без сообщений о сломанном файле); если правило в `bin/profile` изменится, копия не узнает. Каждый
  `SubagentStart` теперь запускает node ещё раз (~70 ms на Mac); время на Windows не мерили.

## 4. Текст правил указывает на раздел

Code: `harness/hooks/rules/common.md:41-46` · key lines: 42, 43

```md
**Which language.** Reports to the user follow `language.reports` as `bin/profile` prints it (the
user's own setting comes first); when it is known, the section "Language of this session" of this
part names its value. Everything the team sees — commits, PRs, review comments, code comments —
follows `language.team`. With no profile and no such section: reports in the language the user
writes in, team-facing text in the language the repo already uses. Personal language rules, if
any, come from the user's rules file.
```

- Что делает: говорит, что значение названо в разделе «Language of this session» этой же части, а правило «на
  языке пользователя» остаётся только для случая без профиля и без раздела.
- Почему здесь: не записано
- Без него: старая фраза «With no profile: reports in the language the user writes in» спорила бы с разделом,
  который вне профиля называет язык из `user.json`.
- Требование: [Готово, когда, п. 2](../issues/11-rework-01-item-4.md#готово-когда)
- Риски и пробелы test-ов: поведение живой модели на этом тексте не проверялось (бриф: без настоящих ходов).

## 5. Как проверено

`bash harness/hooks/tests/rules-hooks.test.sh` — на копии harness/ из origin/main с новым test-ом exit 1, 8 FAIL
раздела 3c; на ветке exit 0, 346 из 346. Contract test-ы `codex-parity`, `harness-hook-stdin`, `harness-plugin`,
`harness-evals-run` — exit 0. `pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, выбраны
`status-block` и `compaction-state`; платный запуск не делали.

## Проверить себя

1. Почему hook спрашивает значение у `bin/profile`, а не читает `language.reports` из `profile.json` сам?
   Ответ: `bin/profile` ставит настройку пользователя из `user.json` выше профиля; своё чтение профиля дало бы
   значение профиля там, где пользователь выбрал другое.
   Строки: `harness/hooks/inject-rules.mjs:120-133`
2. Что увидит Subagent, если `bin/profile` завис?
   Ответ: через 5 s процесс убит, hook пишет одну строку на stderr и берёт значение из `user.json`; нет его —
   часть приходит как была, и hook укладывается в свои 10 s.
   Строки: `harness/hooks/inject-rules.mjs:123-142`

## 6. Что нашёл review и что осталось

> VERIFIED — worfy-neutral 11 (rework of neutral 01 item 4: the rules a new Session gets name the report language as a value), head ee705b2d82bde71dfd0767c7b9e6e4a3fcf14044
>
> Gate (depth medium, one round): reviewer (lens: correctness) — MERGE with two lows; the Orchestrator fixed one (cea6dcaeb; the story fragment follows in ee705b2d8) and ran the paid Harness evals.
>
> - What the user sees: a Session (and its Subagents) started in a registered project gets a section «Language of this session» that names the report language as a value — «Russian (`ru`)» in this repo — and the team language; outside a profile the user's own `user.json` setting is named; a broken, missing or hung `bin/profile` never blocks the start (the section from user.json alone, or none).
> - Fixed by the Orchestrator: the fallback says «the project profile could not be read» unless `bin/profile` exited 3 (no profile covers the folder); the test of a missing profile script follows.
> - Evidence: rules-hooks.test.sh red before (8 FAIL), 346/346 after (EXIT=0, also after the Orchestrator's fix); plugin-neutral.test.sh 37/37, start-context.test.sh 126/126 (reviewer); pnpm lint, typecheck, test EXIT=0; gate fast green; paid evals: status-block 3/3 score 1.00 ($0.45), compaction-state 3/3 score 1.00 ($1.16).
> - Debt (low): start-context counts the new ~170-token section as the user's rules, outside the 15 000-token total (harness/bin/start-context:179, :287); the implementer measures 14 258 tokens, ~570 below the limit with it.
> - Not verified: a native Windows and Git Bash run of the hook (Windows CI jobs); a live turn answering in Russian (the manual item, after merge and Stable update).
>
> Decided without the owner (to confirm): the hook spawns `bin/profile` once per SessionStart/SubagentStart with a 5 s wait (~70–110 ms on Mac); with no profile, a set `user.json` language now wins over the language the user writes in.

Code: `harness/bin/start-context:179-179` · key lines: 179

```
    return { common: spellRoot(common, COUNTED_ROOT), user: injected.startsWith(asInjected) ? injected.slice(asInjected.length) : "" }
```

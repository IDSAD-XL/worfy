# Code story — worfy-code-stories 06: Verifier проверяет утверждения story; documents PR дописывает шаг «Что нашёл review и что осталось»

Kind: pr · Epic: worfy-code-stories · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 05 story PR лежит в diff-е PR, но verifier её не проверял: в линзе «implementer's report» агента
`reviewer` пункта о story не было. Шаг «Что нашёл review и что осталось» формат story обещал (его дописывает documents
PR после merge), но `land` его не писал: documents PR получал только Evidence-строки и `ticket done`.

- Требование: [Что происходит](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-происходит)

## 2. Шаг review собирается из текста вердикта, без модели

Code: `harness/bin/land:833-839` · key lines: 834, 836, 837

```js
    const verdict = found.text.replace(/\s+$/, "")
    const quote = verdict.split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : ">"))
    const fragments = reviewFragments(st, p, head, verdict)
    const step = [`## ${steps + 1}. ${title}`, "", ...quote, ...fragments.flatMap((f) => ["", f])].join("\n")
    fs.writeFileSync(path.join(tree, file), `${story.replace(/\s+$/, "")}\n\n${step}\n`)
    log(`#${p.number}: the review step appended to ${file}: ${quote.length} lines of the verdict, ${fragments.length} fragment${fragments.length === 1 ? "" : "s"} of ${short(head)}`)
    return { file, head }
```

- Что делает: берёт сохранённый вердикт (`prs[].verdict`, вывод `bin/verdict`), цитирует его построчно через `> `,
  добавляет фрагменты кода и дописывает шаг последним, со следующим номером и заголовком на языке story (из
  `codeStoryLabels` в `lib/input-words.json`).
- Почему здесь: `land` уже открывает documents PR после merge и пишет туда Evidence-строки из state-файла; шаг review
  идёт тем же путём, в тот же commit, что и `ticket done`.
- Без него: story PR так и осталась бы без шага review, а находки и непроверенное жили бы только в комментарии PR.
- Требование: [Что делаем, пункт 2](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: вердикт цитируется целиком, без обрезки по размеру; story-check проверяет только формат и
  фрагменты, не смысл цитаты. Блок-цитата выбрана, чтобы строки вердикта вида `- Label: …`, `Code: …` или забор кода не
  читались как поля или фрагменты story; test на такой вердикт не писали.

## 3. Фрагменты — строки merged head, которые видел review

Code: `harness/bin/land:771-778` · key lines: 772, 776, 777, 778

```js
        const was = linesAt(st, verified, file)
        const now = verified === head ? was : linesAt(st, head, file)
        if (!was || !now || to > was.length) continue
        const block = was.slice(from - 1, to)
        let at = null
        for (let i = 0; i + block.length <= now.length; i++)
            if (block.every((l, k) => now[i + k] === l) && (at === null || Math.abs(i + 1 - from) < Math.abs(at - from))) at = i + 1
        if (at === null) continue
```

- Что делает: для каждой ссылки вердикта `path:<строка>` или `path:<от>-<до>` берёт строки из head-а, который проверил
  review (`prs[].head`), и ищет их блоком в head-е, который влит (`prs[].result.head`), ближе всего к номерам ссылки.
  Найден — фрагмент с номерами влитого head-а; не найден — фрагмента нет.
- Почему здесь: `land` вливает и rebase-нутый head с тем же diff-ом; номера вердикта относятся к head-у до rebase, а
  story-check в documents PR читает влитой head.
- Без него: после rebase фрагмент указывал бы на чужие строки — тот самый риск «Строки уезжают после rebase» из spec.
- Требование: [Что делаем, пункт 3](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: фрагментов не больше 5, каждый не длиннее 40 строк; ссылка на файл вне head-а, на ссылку
  (symlink) или на двоичный файл пропускается молча. Test на rebase сдвигает строки и меняет одну из них; ссылку,
  совпавшую с несколькими местами файла, test не покрывает.

## 4. Story-check после evidence-check, до commit-а

Code: `harness/bin/land:891-897` · key lines: 892, 896

```js
        for (const { file: story, head } of appended) {
            const sc = run([process.execPath, [path.join(__dirname, "story-check")]], ["--head", head, story], tree)
            const lines = `${sc.out}\n${sc.err}`.split("\n").filter((l) => l.trim())
            log(`story-check --head ${head} ${story} — exit ${sc.code}`)
            for (const l of lines) log(`  ${l}`)
            if (sc.code === 2) throw new Wait(`story-check is red on ${story} after the review step: ${storyProblem(lines)}`, "red")
            if (sc.code !== 0) throw new Wait(`story-check could not check ${story} after the review step (exit ${sc.code}): ${firstLine(sc.err || sc.out)}`)
```

- Что делает: каждая story с дописанным шагом проходит настоящий `story-check --head <влитой head>`; красный — documents
  PR ждёт красным, ничего не закоммичено и не отправлено.
- Почему здесь: после `evidence-check`, чтобы личные данные в вердикте ловил он, как у Evidence-строк, и чтобы ни одна
  проверка не пропускала commit.
- Без него: битый фрагмент или личные данные дошли бы до `main` в documents PR, который вливается без review агентов.
- Требование: [Что делаем, пункт 3](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: якорь story — commit, который её добавил (`git log --diff-filter=A`); дописывание меняет
  файл, а не добавляет, и test сверяет, что якорь до и после один и тот же commit.

## 5. Verifier проверяет story как утверждение

Code: `harness/agents/reviewer.md:238-247` · key lines: 238, 241, 246

```md
- **The Code story.** The story of the PR, `<tickets root>/<epic>/stories/<NN>-<slug>.md`
  (`"${CLAUDE_PLUGIN_ROOT}/bin/TICKETS.md"`, section **Code story**), is a claim too. In Full mode it
  is in the PR diff; in Silent mode it is in the Workflow folder, under the same tickets root as the
  Evidence lines, and the diff has none. Check three things: every statement of the story holds in
  the code; its fragments quote the PR's latest head
  (`"${CLAUDE_PLUGIN_ROOT}/bin/story-check" --repo <the PR's worktree> --head <head> <story>` exits
  0); and no field gives a reason in place of `not recorded` (in a story in another language, its
  word for it) that neither the ticket, the spec, the diff nor the report holds — such a reason is
  invented. A statement of the story that does not hold is a finding of the same weight as a defect
  in the code: an unconfirmed claim, with its step and the `file:line` that refutes it.
```

- Что делает: в линзе «implementer's report» story — такое же утверждение, как `claims` и Evidence-строки; три
  проверки и вес находки, как у ошибки в коде.
- Почему здесь: эту линзу verifier получает в каждой Wave, и она уже проверяет утверждения отчёта implementer-а.
- Без него: гладкое описание своего кода автором никто бы не сверял с кодом — риск «Автор описывает свой код слишком
  гладко» из spec.
- Требование: [Что делаем, пункт 1](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: `agents-text.test.sh` сверяет текст линзы предложение за предложением; что модель
  действительно так проверяет, покажет eval (Ticket 14), не этот PR.

## 6. Что сознательно не меняли

- В режиме Silent `land` шаг не пишет: печатает `review step of #N is the orchestrator's (tickets outside the
  repository)`, а сам шаг Orchestrator дописывает в папке Workflow по тексту skill-а `epic-wave`.
- Своих слов вокруг цитаты шаг не пишет: в `lib/input-words.json` есть только заголовок шага на двух языках, а новые
  фразы потребовали бы нового словаря.
- Story Epic-а и поле для лишних файлов documents PR — Ticket 07.

## 7. Как проверено

- `bash harness/bin/tests/land-story.test.sh` — exit 0: новые случаи (шаг дописан, story-check зелёный, тот же якорь;
  без story и без вердикта documents PR прежний; утечка в вердикте — `evidence-check` красный; rebase; Silent) на `main`
  были красными. Случаи story вынесены из `land.test.sh` в этот файл вместе с общим миром `land-world.sh`: в полном
  `pnpm test` на нагруженной машине `land.test.sh` с новыми случаями дважды не уложился в предел 360 s на файл.
- `bash harness/bin/tests/land.test.sh` — exit 0, остальные случаи `land` без изменений.
- `bash harness/bin/tests/agents-text.test.sh` — exit 0; на копии Harness-а с `main` новые проверки красные.
- Все `harness/bin/tests/*.test.sh`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — коды выхода в отчёте
  implementer-а.

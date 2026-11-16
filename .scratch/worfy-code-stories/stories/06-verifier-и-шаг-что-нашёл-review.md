# Code story — worfy-code-stories 06: Verifier проверяет утверждения story; documents PR дописывает шаг «Что нашёл review и что осталось»

Kind: pr · Epic: worfy-code-stories · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 05 story PR лежит в diff-е PR, но verifier её не проверял: в линзе «implementer's report» агента
`reviewer` пункта о story не было. Шаг «Что нашёл review и что осталось» формат story обещал (его дописывает documents
PR после merge), но `land` его не писал: documents PR получал только Evidence-строки и `ticket done`.

- Требование: [Что происходит](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-происходит)

## 2. Шаг review собирается из текста вердикта, без модели

Code: `harness/bin/land:868-874` · key lines: 868, 871, 872

```js
    const verdict = found.text.replace(/\s+$/, "")
    const quote = verdict.split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : ">"))
    const fragments = reviewFragments(st, p, head, verdict)
    const step = [`## ${steps + 1}. ${title}`, "", ...quote, ...fragments.flatMap((f) => ["", f])].join("\n")
    fs.writeFileSync(path.join(tree, file), `${story.replace(/\s+$/, "")}\n\n${step}\n`)
    log(`#${p.number}: the review step appended to ${file}: ${quote.length} lines of the verdict, ${fragments.length} fragment${fragments.length === 1 ? "" : "s"} of ${short(head)}`)
    return { file, head }
```

- Что делает: берёт сохранённый вердикт (`prs[].verdict`, вывод `bin/verdict`) с его строки вердикта, без вводной фразы
  и разметки, цитирует построчно через `> `, добавляет фрагменты кода и дописывает шаг последним, со следующим номером
  и заголовком на языке story (из `codeStoryLabels` в `lib/input-words.json`).
- Почему здесь: `land` уже открывает documents PR после merge и пишет туда Evidence-строки из state-файла; шаг review
  идёт тем же путём, в тот же commit, что и `ticket done`.
- Без него: story PR так и осталась бы без шага review, а находки и непроверенное жили бы только в комментарии PR.
- Требование: [Что делаем, пункт 2](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: вердикт цитируется целиком, без обрезки по размеру. Что осталось непроверенным, шаг знает
  только из вердикта: skill `epic-wave` велит сохранять ответ verifier-а, где есть строка «could not verify», а
  записанный вердикт берёт только после перерыва сессии, и в нём этой строки нет.

## 3. Фрагменты — строки merged head, которые видел review

Code: `harness/bin/land:783-801` · key lines: 784, 789, 796

```js
        const was = linesAt(st, verified, file)
        const now = verified === head ? was : linesAt(st, head, file)
        if (!was || !now || to > was.length) continue
        const block = was.slice(from - 1, to)
        let at = null
        for (let i = 0; i + block.length <= now.length; i++)
            if (block.every((l, k) => now[i + k] === l) && (at === null || Math.abs(i + 1 - from) < Math.abs(at - from))) at = i + 1
        if (at === null) continue
        // a fence longer than any fence line of the code, so the code cannot close it
        const fence = "`".repeat(Math.max(3, ...block.map((l) => (FENCE_LINE.exec(l) || [, ""])[1].length + 1)))
        const ext = path.posix.extname(file).slice(1)
        const range = `${file}:${at}-${at + block.length - 1}`
        const fragment = [`Code: \`${range}\` · key lines: ${at}`, "", fence + (/^[\w+-]+$/.test(ext) ? ext : ""), ...block, fence].join("\n")
        const personal = privacy.findings(fragment, privacyOptions)
        if (personal.length) {
            log(`#${p.number}: ${privacy.maskText(range, privacyOptions)} is not quoted: personal data (${[...new Set(personal.map((f) => f.rule))].join(", ")})`)
            continue
        }
        out.push(fragment)
```

- Что делает: для каждой ссылки вердикта `path:<строка>` или `path:<от>-<до>` берёт строки из head-а, который проверил
  review (`prs[].head`), и ищет их блоком в head-е, который влит (`prs[].result.head`), ближе всего к номерам ссылки.
  Найден — фрагмент с номерами влитого head-а; не найден — фрагмента нет. Фрагмент с личными данными (host, UUID,
  домашний путь в коде репозитория) не цитируется, и log называет его маской и правилом, без значения.
- Почему здесь: `land` вливает и rebase-нутый head с тем же diff-ом; номера вердикта относятся к head-у до rebase, а
  story-check в documents PR читает влитой head. Проверка личных данных — здесь, а не в `evidence-check`: тот
  остановил бы documents PR всего run-а, и каждый повтор тоже.
- Без него: после rebase фрагмент указывал бы на чужие строки (риск «Строки уезжают после rebase» из spec), а строка
  кода с UUID блокировала бы закрытие всех Ticket-ов run-а.
- Требование: [Что делаем, пункт 3](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: фрагментов не больше 5, каждый не длиннее 40 строк; ссылка на файл вне head-а, на ссылку
  (symlink) или на двоичный файл пропускается молча. Когда head, который проверил review, не прочитать, шаг не
  цитирует код вовсе. Ссылку, совпавшую с несколькими местами файла, test не покрывает.

## 4. Story, красная до шага, шага не получает

Code: `harness/bin/land:836-844` · key lines: 839, 840, 844

```js
    if (!found) throw new Wait(`the verdict of #${p.number} (${p.verdict}) has no line that starts with VERIFIED or REJECTED`)
    // a story red at its head already (code_stories.pr off, or a PR merged by hand: no guard read it) gets no step — the
    // check after the step would refuse it, and the documents of the whole run with it
    const before = storyCheck(tree, head, file)
    if (before.code === 2) {
        log(`#${p.number}: ${file} is red at ${short(head)} already, no review step appended: ${storyProblem(before.lines)}`)
        return null
    }
    if (before.code !== 0) throw new Wait(`story-check could not check ${file} before the review step (exit ${before.code}): ${firstLine(before.err)}`)
```

- Что делает: до дописывания проверяет story настоящим `story-check --head <влитой head>`; красная уже — шаг не
  дописывается, log называет первую проблему, documents PR идёт дальше.
- Почему здесь: с выключенным `code_stories.pr` или у PR, влитого руками, guard story не читал; проверка после шага
  иначе остановила бы documents PR всех Ticket-ов run-а.
- Без него: одна старая красная story блокировала бы `ticket done` всех PR в каждом повторе `land`.
- Требование: [Что делаем, пункт 3](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: на каждую story — два запуска `story-check` вместо одного.

## 5. Story-check после evidence-check, до commit-а

Code: `harness/bin/land:926-930` · key lines: 927, 928

```js
        for (const { file: story, head } of appended) {
            const sc = storyCheck(tree, head, story)
            if (sc.code === 2) throw new Wait(`story-check is red on ${story} after the review step: ${storyProblem(sc.lines)}`, "red")
            if (sc.code !== 0) throw new Wait(`story-check could not check ${story} after the review step (exit ${sc.code}): ${firstLine(sc.err)}`)
        }
```

- Что делает: каждая story с дописанным шагом снова проходит `story-check --head <влитой head>`; красная — documents PR
  ждёт красным, ничего не закоммичено и не отправлено.
- Почему здесь: после `evidence-check`, чтобы личные данные в самом вердикте ловил он, как у Evidence-строк.
- Без него: битый шаг дошёл бы до `main` в documents PR, который вливается без review агентов.
- Требование: [Что делаем, пункт 3](../issues/06-verifier-и-шаг-что-нашёл-review.md#что-делаем)
- Риски и пробелы test-ов: якорь story — commit, который её добавил (`git log --diff-filter=A`); дописывание меняет
  файл, а не добавляет, и test сверяет, что якорь до и после один и тот же commit.

## 6. Verifier проверяет story как утверждение

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


## 7. Что сознательно не меняли

- В режиме Silent `land` шаг не пишет: печатает `review step of #N is the orchestrator's (tickets outside the
  repository)`, а сам шаг Orchestrator дописывает в папке Workflow по тексту skill-а `epic-wave`, по тому же правилу
  фрагментов, что и `land`.
- Своих слов вокруг цитаты шаг не пишет: в `lib/input-words.json` есть только заголовок шага на двух языках, а новые
  фразы потребовали бы нового словаря.
- Story Epic-а и поле для лишних файлов documents PR — Ticket 07.

## 8. Как проверено

- `bash harness/bin/tests/land-story.test.sh` — exit 0: шаг дописан, story-check зелёный, тот же якорь; без story и без
  вердикта documents PR прежний; утечка в вердикте — `evidence-check` красный; rebase; строка с UUID не цитируется;
  story, красная до шага; head review не прочитать; вердикт без строки вердикта; story на русском с шагом и без; Silent.
  Новые случаи были красными до правки, мутанты `land` (7 штук, по одному на каждое новое поведение) убиты.
  Случаи story вынесены из `land.test.sh` в этот файл вместе с общим миром `land-world.sh`: в полном `pnpm test` на
  нагруженной машине `land.test.sh` с новыми случаями дважды не уложился в предел 360 s на файл.
- `bash harness/bin/tests/land.test.sh` — exit 0, остальные случаи `land` без изменений.
- `bash harness/bin/tests/agents-text.test.sh` — exit 0; на прежнем тексте skill-а новые проверки красные; строка `awk`
  режима Silent прогоняется на файле Ticket-а с двумя раундами.
- Все `harness/bin/tests/*.test.sh`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — коды выхода в отчёте
  implementer-а.

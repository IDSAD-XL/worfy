# Code story — worfy-code-stories 05: Implementer пишет story PR перед PR (`ship-ticket`), ссылка в тексте PR, guard на merge

Kind: pr · Epic: worfy-code-stories · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

Story PR уже имела формат (Ticket 01), script проверки `story-check` (Ticket 02) и переключатель `code_stories.pr`
(Ticket 03), но никто её не писал и ничто её не требовало: `land` вливал PR Ticket-а без story, а skill `ship-ticket`
не просил её написать.

- Требование: [Что делаем, пункты 1 и 6](../issues/05-implementer-пишет-story-pr-и-guard-на-merge.md#что-делаем)

## 2. Story — часть условия merge в `land`

Code: `harness/bin/land:597-605` · key lines: 603

```js
function ready(st, pr, head, carry) {
    ciGreen(st, head)
    sameChange(st, pr, head)
    const marks = statuses(st, head)
    reviewed(st, pr, head, marks, carry)
    checked(pr, head, marks)
    storyGreen(st, pr, head)
    mainAllows(st, pr, head)
}
```

- Что делает: перед проверкой ветки main проверяет story PR Ticket-а; нет story или она красная — PR ждёт с причиной.
- Почему здесь: `ready` — всё условие merge одного PR, и `land` повторяет его под замком main перед `gh pr merge`.
  Gate бежит на каждом head-е, в том числе до того, как story написана, и краснел бы раньше времени.
- Без него: PR Ticket-а без story вливается, как раньше; переключатель `code_stories.pr` ничего не значит.
- Требование: [Что делаем, пункт 6](../issues/05-implementer-пишет-story-pr-и-guard-на-merge.md#что-делаем)
- Риски и пробелы test-ов: зелёный результат запоминается по head-у, и под замком `story-check` не повторяется (test в `land.test.sh`);
  в режиме Silent файл в папке может измениться, поэтому там проверка повторяется.

## 3. Story читается из head-а PR, а не из рабочего дерева

Code: `harness/bin/land:570-578` · key lines: 572, 575, 578

```js
        const shown = found[0]
        if (root) {
            const r = run([GIT, []], ["show", `${head}:${shown}`], st.repo)
            if (r.code !== 0) throw new Wait(`git show ${short(head)}:${shown} (exit ${r.code}): ${firstLine(r.err)}`)
            file = path.posix.basename(shown)
            fs.writeFileSync(path.join(tmp, file), r.out)
        } else file = shown
        // run in the temporary folder: a copy is named by its bare file name, which the output then puts back as its path
        const sc = run([process.execPath, [path.join(__dirname, "story-check")]], ["--repo", st.repo, "--head", head, file], tmp)
```

- Что делает: достаёт файл story из commit-а head-а PR во временную папку и прогоняет `story-check` с
  `--repo <checkout> --head <head>`; в режиме Silent берёт файл из папки, которую печатает `ticket root`. Head, которого нет в checkout-е, сначала достаётся из origin в обоих режимах.
- Почему здесь: checkout у `land` — ветка main, его рабочее дерево не то, что вливается; номера строк story — head-а PR.
- Без него: `land` проверял бы story или код из рабочего дерева checkout-а, и зелёный результат ничего не говорил бы
  о вливаемом head-е.
- Требование: [Что делаем, пункт 8](../issues/05-implementer-пишет-story-pr-и-guard-на-merge.md#что-делаем)
- Риски и пробелы test-ов: `--pr-head` из брифа не подошёл — `story-check` принимает его только для глав story
  Epic-а; здесь `--head`.

## 4. `story-check` отказывает, если цитируемый код не закоммичен

Code: `harness/bin/story-check:642-646` · key lines: 645

```js
        const anchor = f.chapterPr ? chapters.get(f.chapterPr) : defaultAnchor()
        // Read against HEAD (no --head; the story committed, or kept outside the work tree as in Silent mode), a quoted
        // file with changes HEAD does not hold would be compared with code the PR will not have: commit the code first.
        if (anchor === fallback && anchor.sha && gitOut(top, ["status", "--porcelain", "-z", "--untracked-files=all", "--", f.path], "git status failed"))
            throw new CannotCheck(`${f.path} is not committed: the story is read against HEAD ${anchor.sha}; commit the code first, then check the story`)
```

- Что делает: когда story сверяется с `HEAD` (без `--head`), а цитируемый файл изменён и не закоммичен, выходит с
  кодом 1 и просит сначала закоммитить код.
- Почему здесь: в режиме Silent story лежит в папке Workflow, вне рабочего дерева, и всегда сверяется с `HEAD` ветки.
- Без него: story с новыми строками сверялась бы со старым кодом `HEAD`; новые строки после конца файла даже
  проходили зелёными (так было на `origin/main`, test `silent-mode.test.sh` это показал).
- Требование: [Что делаем, пункт 9](../issues/05-implementer-пишет-story-pr-и-guard-на-merge.md#что-делаем)
- Риски и пробелы test-ов: правило действует и для закоммиченной story в ветке, когда цитируемый файл грязный;
  нецитируемые файлы не мешают (test в `story-check.test.sh`).

## 5. Что сознательно не меняли

Состав state-файла `land` не менялся: переключатель `land` читает сам через `bin/profile`, поэтому блок Orchestrator-а
в `epic-wave` новых полей не пишет. Номер PR в шапке story остаётся `-`: его даёт строка `PR:` Ticket-а.

## 6. Как проверено

`bash harness/bin/tests/land.test.sh`, `silent-mode.test.sh`, `story-check.test.sh`, `skill-blocks-gate.test.sh`,
`agents-text.test.sh` — exit 0 (HOME во временной папке); `pnpm lint`, `pnpm typecheck`, `pnpm test` и gate fast — exit 0.

# Code story — worfy-polish 176: `agents/openai.yaml` у skill-ов `human-review-setup` и `overnight-fix-loop`: Codex не вызывает их сам

Kind: pr · Epic: worfy-polish · Ticket: 176 · PR: - · Language: ru

## 1. Что было не так

`harness/` ставится plugin-ом и в Claude Code, и в Codex. Claude Code не даёт модели самой вызвать skill с
`disable-model-invocation: true` во frontmatter `SKILL.md`; Codex это поле не читает и ждёт
`policy: allow_implicit_invocation: false` в `agents/openai.yaml` рядом. У `human-review-setup` и
`overnight-fix-loop` поле в `SKILL.md` стоит, а файла нет: в Codex модель могла вызвать их сама.

- Требование: [Что происходит](../issues/176-agents-openai-yaml-у-human-review-setup-и-overnight-fix-loop.md#что-происходит)

## 2. Codex-манифест в форме копии

Code: `harness/skills/overnight-fix-loop/agents/openai.yaml:1-5` · key lines: 5

```yaml
interface:
  display_name: "Overnight Fix Loop"
  short_description: "Fix modules unattended overnight"
policy:
  allow_implicit_invocation: false
```

- Что делает: Codex показывает skill под именем «Overnight Fix Loop» и не вызывает его без команды человека. Второй
  файл, `harness/skills/human-review-setup/agents/openai.yaml`, — той же формы («Human Review Setup»).
- Почему здесь: Ticket называет обе папки и образец формы — `harness/skills/handoff/agents/openai.yaml`.
- Без него: в Codex ночной run без вопросов человеку или чтение истории review команды могли начаться по решению
  модели.
- Требование: [Что строить, п. 1](../issues/176-agents-openai-yaml-у-human-review-setup-и-overnight-fix-loop.md#что-строить)
- Риски и пробелы test-ов: что Codex читает файл именно так, проверено только формой 11 файлов копии; настоящий
  Codex не запускали (бриф запрещает).

## 3. Запись в карте eval-покрытия

Code: `harness/evals/lib/coverage.json:36-37` · key lines: 36, 37

```json
    "skills/overnight-fix-loop/agents/openai.yaml": "The Codex manifest that keeps the skill manual-only in Codex: Claude Code, which runs the eval cases, does not read it.",
    "skills/human-review-setup/agents/openai.yaml": "The Codex manifest that keeps the skill manual-only in Codex: Claude Code, which runs the eval cases, does not read it.",
```

- Что делает: оба новых файла стоят в `uncovered` со своей причиной, не «a copied skill».
- Почему здесь: Ticket велит запись на каждый файл; без неё test «maps every rule file of harness/ either to a case
  or to a reason» в `test/contract/harness-evals-run.test.ts` красный.
- Без него: красный contract test и отказ `pnpm eval:harness -- --changed` («coverage.json does not match harness/»).
- Требование: [Что строить, п. 2](../issues/176-agents-openai-yaml-у-human-review-setup-и-overnight-fix-loop.md#что-строить)
- Риски и пробелы test-ов: правка самого `coverage.json` — файл в `harness/evals/lib/`, и `--changed` выбирает по
  нему все case-ы (`scripts/eval-harness-coverage.mjs:105`). Ноль case-ов, как ждал Ticket, при этой правке
  недостижим; платного run-а не было, только `--dry-run`.

## 4. Contract test: два поля идут вместе

Code: `test/contract/harness-plugin.test.ts:107-115` · key lines: 109, 114

```ts
  const manualInClaude = (name: string): boolean => {
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)/.exec(readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8'))?.[1] ?? ''
    return /^disable-model-invocation:[ \t]*true[ \t]*\r?$/m.test(front)
  }
  const manualInCodex = (name: string): boolean => {
    const manifest = join(SKILLS, name, 'agents', 'openai.yaml')
    if (!existsSync(manifest)) return false
    return /^policy:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+allow_implicit_invocation:[ \t]*false[ \t]*\r?$/m.test(readFileSync(manifest, 'utf8'))
  }
```

- Что делает: для каждой папки `harness/skills/*` с `SKILL.md` читает regex-ом frontmatter и строку
  `allow_implicit_invocation: false` внутри блока `policy:`; test (строки 122-124) требует, чтобы оба ответа совпадали.
  Отдельный test «reads the skills» не даёт пустому списку пройти молча.
- Почему здесь: Ticket называет `test/contract/harness-plugin.test.ts` и чтение regex-ом: YAML-библиотеки в
  зависимостях нет.
- Без него: следующий свой skill с `disable-model-invocation: true` снова уйдёт без файла для Codex, и наоборот —
  файл без поля сделал бы skill ручным только в Codex.
- Требование: [Что строить, п. 3](../issues/176-agents-openai-yaml-у-human-review-setup-и-overnight-fix-loop.md#что-строить)
- Риски и пробелы test-ов: до правки test красный и называет оба skill-а (exit 1). Regex не разбирает YAML целиком:
  строка `allow_implicit_invocation: false` под другим ключом с отступом сразу после `policy:` тоже засчиталась бы.

## 5. Проверка частей skill-а не считает `agents/` потерянной частью

Code: `harness/bin/tests/start-context.test.sh:224-226` · key lines: 226

```bash
        # agents/ holds the Codex manifest (agents/openai.yaml), which Codex reads itself: it is not a
        # part a model reads, so no SKILL.md names it.
        [ "$n" = agents ] && [ -d "$f" ] && continue
```

- Что делает: проверка 3a требует, чтобы каждый файл или папку рядом со `SKILL.md` своего skill-а называл
  `SKILL.md` или агент; папку `agents/` она теперь пропускает. Скопированные skill-ы она не смотрела и раньше.
- Почему здесь: Ticket этого файла не называет. Без пропуска `pnpm test` красный: contract test
  `test/contract/harness-scripts-4.test.ts` запускает этот скрипт, и он писал «agents/ lies next to SKILL.md, but
  neither SKILL.md nor an agent names it» для обоих skill-ов.
- Без него: красный `pnpm test`, либо строка про `agents/` в `SKILL.md`, которую модель читала бы зря.
- Требование: [Готово, когда, п. 4](../issues/176-agents-openai-yaml-у-human-review-setup-и-overnight-fix-loop.md#готово-когда)
- Риски и пробелы test-ов: пропуск по имени папки; часть skill-а, положенная в папку `agents/`, проверку
  тоже пройдёт.

## 6. Что сознательно не меняли

Файлы 11 скопированных skill-ов не трогали: их sha256 закреплены в `test/contract/harness-third-party-skills.test.ts`.
`scripts/eval-harness-coverage.mjs` (все case-ы при правке `harness/evals/lib/`) — вне следа Ticket-а.

## 7. Как проверено

Новый test до правки — exit 1 (называет `human-review-setup`, `overnight-fix-loop`), после — exit 0. Contract test-ы
`harness-plugin`, `harness-evals-run`, `harness-evals`, `harness-third-party-skills`, `harness-human-review-setup`,
`codex-compat`, `harness-scripts-4` — exit 0. `bash harness/bin/tests/plugin-neutral.test.sh` и `start-context.test.sh` (пустой HOME) — exit 0.
`pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, claude не вызван.

## Проверить себя

1. Почему одного `disable-model-invocation: true` мало?
   - Ответ: это поле читает только Claude Code; Codex берёт запрет из `policy` в `agents/openai.yaml`.
   - Строки: `harness/skills/overnight-fix-loop/agents/openai.yaml:5`
2. Зачем test проверяет и обратное направление — файл без поля в `SKILL.md`?
   - Ответ: тогда Codex молчал бы там, где Claude Code skill вызывает сам; поведение двух хостов разошлось бы.
   - Строки: `test/contract/harness-plugin.test.ts:107-115`
3. Почему dry run eval выбирает case-ы, хотя новые файлы в `uncovered`?
   - Ответ: правка `coverage.json` — файла из `harness/evals/lib/`, а такой файл выбирает все case-ы.
   - Строки: `harness/evals/lib/coverage.json:36-37`

## 8. Что нашёл review и что осталось

> VERIFIED
> - [low] `harness/bin/tests/start-context.test.sh:226`: the check that every file next to a `SKILL.md` is named somewhere now skips the whole `agents/` folder of an in-house skill, not just `agents/openai.yaml`. A future step file placed there (for example `agents/foo.md`) would be skipped silently. A narrower skip would be to ignore only `agents/openai.yaml`, or an `agents/` folder that holds nothing else.
> - Format: both new manifests have the same `interface` (`display_name`, `short_description`) plus `policy: allow_implicit_invocation: false` shape as the 11 copied manifests, such as `harness/skills/to-spec/agents/openai.yaml`. Both skills have `disable-model-invocation: true` on line 4 of their `SKILL.md`. The copied skills are untouched.
> - Test: `test/contract/harness-plugin.test.ts:102-125` checks the rule both ways for every `harness/skills/*/SKILL.md`: a skill marked manual-only in `SKILL.md` must have the Codex manifest with `allow_implicit_invocation: false`, and a skill without the mark must not.
> - Mutant: I set `allow_implicit_invocation: true` in the `overnight-fix-loop` manifest. The new test went red (exit 1, `expected [ 'overnight-fix-loop' ] to deeply equal []`). I restored the file from a copy and the tree was clean afterwards.
> - Item 1 (both manifests, plus an entry in `coverage.json` `uncovered` for each, with its own reason): met.
> - Item 2 (contract test exists, red before the change, green after): met. I checked green after and the mutant; I did not rerun the "red before" claim on the base commit.
> - Item 3 (eval dry run selects zero cases): not met as written. The report says the dry run selects 28 cases and gives a reason. The reason holds: any change in `harness/evals/lib/` selects every case (`scripts/eval-harness-coverage.mjs:103-105`), and item 2 of "Что строить" requires editing `coverage.json`, which lives there. So the ticket contradicts itself; this is not a code defect.
> - Item 4 (lint, typecheck, `pnpm test` exit 0; green `ci-ok`): not met yet. On head 879e4121f the job `macos-e2e` is still pending and `ci-ok` is not reported yet. Every other job has passed: lint-typecheck, the four Linux shards, the Windows full suite and Windows e2e.
> - Ran: `pnpm install --frozen-lockfile` exit 0. Under a temporary HOME, `node scripts/vitest-electron.mjs run` on `harness-plugin`, `harness-evals-run`, `harness-third-party-skills`, `harness-human-review-setup`, `codex-compat` and `harness-scripts-4` exit 0 (20 files, 764 passed, 8 skipped). `bash harness/bin/tests/plugin-neutral.test.sh` exit 0 (37 passed). The mutant run exit 1, as expected. `gh pr checks 2371` exit 8 (a check is pending).
> - Could not verify: that Codex really honours `allow_implicit_invocation`, because the brief forbids running the real Codex. The only basis is that the 11 upstream manifests use the same field. I also did not run the eval dry run or local lint/typecheck, and `ci-ok` has not finished.
> - The review worktree is removed and no background processes are left. Nothing else found.
>
> Orchestrator: item 3 (eval dry run selects zero cases) contradicts «Что строить» item 2 (coverage.json lives in harness/evals/lib/, which selects every case); accepted as written in «Итог». The low on start-context.test.sh:226 is not a blocker.
>
> Review depth: low — ticket

Code: `harness/bin/tests/start-context.test.sh:226-226` · key lines: 226

```sh
        [ "$n" = agents ] && [ -d "$f" ] && continue
```

Code: `test/contract/harness-plugin.test.ts:102-125` · key lines: 102

```ts
describe('a manual-only skill is manual-only in Codex too', () => {
  const SKILLS = join(HARNESS, 'skills')
  const skills = readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
  const manualInClaude = (name: string): boolean => {
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)/.exec(readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8'))?.[1] ?? ''
    return /^disable-model-invocation:[ \t]*true[ \t]*\r?$/m.test(front)
  }
  const manualInCodex = (name: string): boolean => {
    const manifest = join(SKILLS, name, 'agents', 'openai.yaml')
    if (!existsSync(manifest)) return false
    return /^policy:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+allow_implicit_invocation:[ \t]*false[ \t]*\r?$/m.test(readFileSync(manifest, 'utf8'))
  }

  it('reads the skills', () => {
    expect(skills.length).toBeGreaterThan(30)
    expect(skills.filter(manualInClaude).length).toBeGreaterThan(10)
  })

  it('has agents/openai.yaml with allow_implicit_invocation: false exactly where SKILL.md has disable-model-invocation: true', () => {
    expect(skills.filter((name) => manualInClaude(name) !== manualInCodex(name))).toEqual([])
  })
})
```

Code: `scripts/eval-harness-coverage.mjs:103-105` · key lines: 103

```mjs
 * The cases to run for `changedPaths` (relative to the repository root, with `/`, as git prints
 * them): a rule file of `coverage.cases` -> its cases; a file in harness/evals/<case>/ -> that case;
 * a file in harness/evals/lib/ -> every case (the fixture and the map are shared). A rule file of
```

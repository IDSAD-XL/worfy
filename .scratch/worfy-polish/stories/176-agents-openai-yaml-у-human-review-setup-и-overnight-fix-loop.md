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

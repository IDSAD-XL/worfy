# 176 — `agents/openai.yaml` у skill-ов `human-review-setup` и `overnight-fix-loop`: Codex не вызывает их сам

Type: task
Status: claimed 2026-11-28T07:10Z
Branch: worfy-polish/176
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 по worfy-harness-eval 06 (одноразовая статика SkillEvaluator по 35 skill-ам Harness,
PR #2350, «Итог», «Вопросы владельцу», вопрос 1: «да, добавить `agents/openai.yaml` с `allow_implicit_invocation: false`
обоим skill-ам»).

Кто: агент. Глубина review — `low`. Не платформенный PR: два YAML-файла, одна запись `coverage.json`, один contract test.

## Что происходит

- worfy ставит `harness/` plugin-ом и в Claude Code, и в Codex (`harness/README.md`, раздел «On Codex», строка 37).
- Claude Code не даёт модели самой вызвать skill с `disable-model-invocation: true` во frontmatter `SKILL.md`. Codex это
  поле не знает. Ему нужен файл `agents/openai.yaml` рядом с `SKILL.md` с `policy: allow_implicit_invocation: false`.
- `disable-model-invocation: true` стоит у 13 skill-ов. У 11 из них `agents/openai.yaml` с
  `allow_implicit_invocation: false` есть: `grill-me`, `grill-with-docs`, `handoff`, `improve-codebase-architecture`,
  `retro`, `teach`, `to-questionnaire`, `to-spec`, `to-tickets`, `wait-what`, `wayfinder`. Все 11 — копия skill-ов
  Matt Pocock (`harness/skills/THIRD_PARTY.md`), файл пришёл с копией.
- У двух своих skill-ов файла нет: `harness/skills/human-review-setup/SKILL.md:4` и
  `harness/skills/overnight-fix-loop/SKILL.md:4` — `disable-model-invocation: true`, папки `agents/` нет.
  SkillEvaluator 1.2.0 (`harness-check`) дал на обоих `CX-DMI-IGNORED`: в Codex модель может вызвать их сама.
  - `overnight-fix-loop` — ночной run без вопросов человеку, сам вливает модули в ночную ветку.
  - `human-review-setup` читает историю review команды на GitHub и пишет private skill.
- Test-а на правило «`disable-model-invocation: true` → `agents/openai.yaml` с `allow_implicit_invocation: false`» нет:
  - `test/contract/harness-third-party-skills.test.ts` сверяет sha256 файлов 20 скопированных skill-ов (карта `UPSTREAM`)
    и их `disable-model-invocation` (`MANUAL_ONLY`, строки 100-121), свои skill-ы не смотрит;
  - `test/contract/harness-human-review-setup.test.ts:67` проверяет только `disable-model-invocation: true`.

## Что строить

1. `harness/skills/human-review-setup/agents/openai.yaml` и `harness/skills/overnight-fix-loop/agents/openai.yaml` — в
   форме 11 файлов копии, например `harness/skills/handoff/agents/openai.yaml`:

   ```yaml
   interface:
     display_name: "…"
     short_description: "…"
   policy:
     allow_implicit_invocation: false
   ```

   `display_name` — имя skill-а словами (`Human Review Setup`, `Overnight Fix Loop`). `short_description` — короткая
   фраза, как у копии (до ~40 знаков).
2. `harness/evals/lib/coverage.json`, объект `uncovered`: по записи на каждый новый файл. Причина — своя, не
   «a copied skill»: файл читает Codex, а Claude Code, на котором идут eval case-ы, его не читает. Без записи красный
   `test/contract/harness-evals-run.test.ts` («maps every rule file of harness/ either to a case or to a reason»,
   строки 680-697).
3. Contract test в `test/contract/harness-plugin.test.ts`: для каждого `harness/skills/*/SKILL.md`
   - с `disable-model-invocation: true` есть `agents/openai.yaml` с `allow_implicit_invocation: false`;
   - без него `allow_implicit_invocation: false` нет (иначе Codex молчит там, где Claude Code skill вызывает).

   YAML-библиотеки в зависимостях нет: frontmatter и строку `policy` читать regex-ом, как `frontMatter` в
   `test/contract/harness-evals.test.ts`.
4. Скопированные skill-ы не трогать: их файлы закреплены sha256 в `harness-third-party-skills.test.ts`.

## Где в коде

- `harness/skills/human-review-setup/`, `harness/skills/overnight-fix-loop/` — новые `agents/openai.yaml`.
- `harness/skills/handoff/agents/openai.yaml`, `harness/skills/to-spec/agents/openai.yaml` — образец формы.
- `harness/evals/lib/coverage.json` — объект `uncovered`.
- `test/contract/harness-plugin.test.ts` — новый test.

## Test-ы

- Новый test в `test/contract/harness-plugin.test.ts` — красный до правки (называет два skill-а без файла), зелёный
  после.
- `test/contract/harness-evals-run.test.ts`, `test/contract/harness-third-party-skills.test.ts`,
  `test/contract/harness-human-review-setup.test.ts`, `test/contract/codex-compat.test.ts` — зелёные.
- `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0 (в новых файлах нет слов проекта).
- Eval: `pnpm eval:harness -- --changed origin/main --dry-run` не выбирает ни одного case-а — новые файлы стоят в
  `uncovered`. Платного run-а нет.

## Готово, когда

- [ ] У `human-review-setup` и `overnight-fix-loop` есть `agents/openai.yaml` с `allow_implicit_invocation: false` в
      форме файлов копии; запись в `coverage.json` `uncovered` у каждого.
  - evidence: commit pass · worfy-polish/176: Codex manifests keep human-review-setup and overnight-fix-loop manual-only · - - · 4e3debbaa0d3f54a0fce143313897a4c36e0474f
- [ ] Contract test правила «`disable-model-invocation: true` ⇔ `allow_implicit_invocation: false`» есть, красный до
      правки, зелёный после.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-plugin.test.ts -t manual-only` exit 1 before the change, exit 0 after · mac - · 4e3debbaa0d3f54a0fce143313897a4c36e0474f
- [ ] `pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, ноль case-ов; вывод — в описании PR.
  - evidence: test-run pass · `pnpm eval:harness -- --changed origin/main --dry-run` exit 0, claude not called; selects 28 cases because coverage.json itself changed · mac - · 4e3debbaa0d3f54a0fce143313897a4c36e0474f
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Итог

- `harness/skills/human-review-setup/agents/openai.yaml` и `harness/skills/overnight-fix-loop/agents/openai.yaml` — в
  форме 11 файлов копии, `policy: allow_implicit_invocation: false`. В `harness/evals/lib/coverage.json`, `uncovered`, —
  по записи на файл со своей причиной (Codex-манифест, который Claude Code в eval case-ах не читает).
- Новый contract test в `test/contract/harness-plugin.test.ts` («a manual-only skill is manual-only in Codex too»):
  для каждого `harness/skills/*/SKILL.md` `disable-model-invocation: true` ⇔ `allow_implicit_invocation: false` в
  `agents/openai.yaml`. Красный до правки (exit 1, называет `human-review-setup`, `overnight-fix-loop`), зелёный после.
- Расхождение с Ticket-ом: `pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, claude не вызван, но
  выбирает 28 case-ов, не ноль. Причина — правка самого `coverage.json`: файл из `harness/evals/lib/` выбирает все
  case-ы (`scripts/eval-harness-coverage.mjs:105`). Без правки `coverage.json` `--changed` отказывает (карта не
  совпадает с `harness/`). Новые файлы в выводе — строки «no case: … — The Codex manifest …». Платного run-а не было.
- Скопированные skill-ы не тронуты.
- Вне следа Ticket-а: `harness/bin/tests/start-context.test.sh`, проверка 3a («каждую часть рядом со `SKILL.md` называет
  `SKILL.md` или агент»), теперь пропускает папку `agents/`. Без этого `pnpm test` красный
  (`test/contract/harness-scripts-4.test.ts`: «agents/ lies next to SKILL.md, but neither SKILL.md nor an agent names it»
  для обоих skill-ов); скопированные skill-ы эта проверка не смотрела и раньше.

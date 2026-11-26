# Code story — worfy-polish 160: Правила `orchestrator.md` у предела 10 000 знаков: разделы «по случаю» — в skill, в файле — ссылки

Kind: pr · Epic: worfy-polish · Ticket: 160 · PR: - · Language: ru

## 1. Что было не так

`harness/hooks/rules/orchestrator.md` — правила главной Session, которые hook вставляет в каждую главную Session.
Test `rules-hooks.test.sh` держит каждую часть в пределе 10 000 знаков с длинным корнем плагина: Claude Code
обрезает вставку длиннее до превью. После Ticket-а 157 файл был на 9 991 знаке из 10 000, и любая следующая правка
правил сделала бы test красным.

- Требование: [Что происходит](../issues/160-правила-orchestrator-md-у-предела-10000-знаков.md#что-происходит)

## 2. В файле правил — заголовки и строки-ссылки

Code: `harness/hooks/rules/orchestrator.md:74-81` · key lines: 74, 76, 79

```markdown
## Quota

Before a phase, and at the fifth file you edit yourself: skill `worfy:orchestrator-rules`,
section "Quota".

## Long output: filter first, delegate second

Before a test, build, lint or `land` run, or reading agent output: skill
```

- Что делает: тело разделов «Quota» и «Long output» заменено одной строкой: когда читать, какой skill и какой раздел.
  Заголовки остались.
- Почему здесь: Ticket называет эти разделы кандидатами на перенос и требует оставить заголовки: перенос старого
  Harness (`src/main/harness/migrate/plan.ts`, `pluginRuleHeadings`) по заголовкам правил плагина решает, что раздел
  личного `CLAUDE.md` уже несёт плагин.
- Без него: без заголовков форма переноса предлагала бы оставить старые разделы «Quota» и «Long output» в личном
  `CLAUDE.md` с пометкой «плагин их не несёт».
- Требование: [Что строить, п. 2](../issues/160-правила-orchestrator-md-у-предела-10000-знаков.md#что-строить)
- Риски и пробелы test-ов: что модель откроет skill в нужный момент, проверить нечем: eval-а на эти разделы нет.

## 3. Phase 3: правило остаётся, подробности — в skill-е

Code: `harness/hooks/rules/orchestrator.md:133-139` · key lines: 133, 136, 139

```markdown
**Ticket status moves through `${CLAUDE_PLUGIN_ROOT}/bin/ticket`**: before a `claim`, `block` or
`done`, skill `worfy:orchestrator-rules`, section "Ticket status".

**A task is not finished until the project's state file is updated**: at a phase boundary and at
session end, skill `worfy:orchestrator-rules`, section "State file".

**State files and ADRs are different documents — never merge them**: before writing either, skill
```

- Что делает: каждый из трёх абзацев оставляет в файле само правило (выделенное предложение) и ссылку на раздел
  skill-а с подробностями: флаги `ticket`, форма файла состояния, журнал решений Wave, ADR.
- Почему здесь: Ticket называет абзацы «Ticket status moves through …», файл состояния и «state file vs ADR»;
  блок статуса из четырёх строк и строка Stage остаются в файле — они нужны в каждом ходе.
- Без него: правило «задача не закончена, пока не обновлён файл состояния» ушло бы из текста, который Session видит
  всегда.
- Требование: [Что строить, п. 3](../issues/160-правила-orchestrator-md-у-предела-10000-знаков.md#что-строить)
- Риски и пробелы test-ов: test-ы на блок статуса (`rules-hooks.test.sh`, раздел Phase 3) не менялись и зелёные.

## 4. Перенесённый текст — в новом skill-е, без правок

Code: `harness/skills/orchestrator-rules/SKILL.md:44-52` · key lines: 44, 46, 50

```markdown
## State file

**A task is not finished until the project's state file is updated.** The profile's
`docs.handoff` names it (`path`), its form (`kind`) and a `check` to run after editing — typically
`HANDOFF.md` at the root: a snapshot of what is in progress, what waits for the owner, the risks
that affect the next steps, the next step, and where the rest lives. Update it at phase
boundaries and at session end, never per message: it is committed with the work, and per-turn
churn is noise in the history. A documents PR rewrites only the lines of
its own epic and appends no block per wave; details go into the tickets' result sections (rules —
```

- Что делает: пять разделов (Quota, Long output, Ticket status, State file, State file vs ADR) — дословно прежний
  текст `orchestrator.md`; `description` skill-а называет, когда какой раздел нужен.
- Почему здесь: Ticket разрешает новый skill, если ни один существующий не подходит. `ship-ticket` — про один Ticket
  и требует, чтобы каждый файл рядом с `SKILL.md` назывался из самого `SKILL.md` (test `start-context.test.sh`),
  `epic-wave` — про Wave, а «Quota» и файл состояния нужны и без Ticket-а и без Wave.
- Без него: подробности правил потерялись бы.
- Требование: [Что строить, п. 1](../issues/160-правила-orchestrator-md-у-предела-10000-знаков.md#что-строить)
- Риски и пробелы test-ов: `description` skill-а попадает в список skill-ов каждой Session — 435 знаков вне
  предела `orchestrator.md`.

## 5. Test: ссылки ведут к разделам, темы на месте

Code: `harness/hooks/tests/rules-hooks.test.sh:647-674` · key lines: 650, 652, 654, 663, 666, 672

```bash
ORCH_SKILL="$HARNESS/skills/orchestrator-rules/SKILL.md"
check_topics "$all" "${ORCH_TOPICS[@]}"
check_topics "$RULES/common.md" "${COMMON_TOPICS[@]}"
for line in "${SKILL_TOPICS[@]}"; do
    head="${line%%|*}"
    awk -v h="## $head" '$0 == h { on = 1; next } on && /^## / { exit } on' "$ORCH_SKILL" >"$T/skill-section.md" 2>/dev/null
    if [ -s "$T/skill-section.md" ]; then
        check_topics "$T/skill-section.md" "orchestrator-rules, $line"
    else
        bad "skill orchestrator-rules: no section '## $head'"
    fi
done

# Every pointer of orchestrator.md names a section the skill has, and every section of the skill is
# named by a pointer: a moved rule that nothing points at is lost.
oflat_all="$(tr '\n' ' ' <"$RULES/orchestrator.md" 2>/dev/null | tr -s ' ')"
pointed="$(printf '%s' "$oflat_all" | grep -oE 'skill `worfy:orchestrator-rules`, section "[^"]+"' | sed -E 's/.*section "([^"]+)"/\1/' | sort -u)"
skill_heads="$(grep '^## ' "$ORCH_SKILL" 2>/dev/null | sed 's/^## //' | sort -u)"
[ -n "$pointed" ] && [ "$pointed" = "$skill_heads" ] \
    && ok "orchestrator.md: every pointer names a section of skill orchestrator-rules, and every section is named ($(printf '%s' "$pointed" | tr '\n' ',' ))" \
    || bad "orchestrator.md pointers and skill orchestrator-rules sections differ: pointers [$(printf '%s' "$pointed" | tr '\n' ',')] sections [$(printf '%s' "$skill_heads" | tr '\n' ',')]"
[ "$(sed -n 2p "$ORCH_SKILL" 2>/dev/null)" = 'name: orchestrator-rules' ] && grep -q '^description: ' "$ORCH_SKILL" \
    && ok "skill orchestrator-rules: name and description" || bad "skill orchestrator-rules: no name or description in its front matter"
# The moved sections keep their headings in orchestrator.md: the app's move from the old Harness takes
# a heading of the plugin's rules as a section of the old CLAUDE.md that the plugin carries.
for h in '## Quota' '## Long output: filter first, delegate second' '## Phase 3 — state, then report'; do
    grep -qxF -- "$h" "$RULES/orchestrator.md" 2>/dev/null && ok "orchestrator.md keeps the heading '$h'" || bad "orchestrator.md lost the heading '$h'"
done
```

- Что делает: оставшиеся темы правил «No rule lost» ищутся в частях правил, как раньше. Темы перенесённых разделов
  (`SKILL_TOPICS`) ищутся только в своём разделе skill-а: минимум одна фраза на абзац, и ни одной из строк-ссылок
  `orchestrator.md`. Множество разделов, на которые ссылается `orchestrator.md`, должно совпасть с разделами
  skill-а; три заголовка остаются в `orchestrator.md`. Проверка журнала решений Wave читает раздел «State file»
  skill-а.
- Почему здесь: Ticket требует test, что ссылки ведут к существующим разделам. Ревью (второй раунд) нашло, что при
  поиске по файлу правил и skill-у вместе фразы Quota находились в строке-ссылке и без текста правила.
- Без него: удалённый абзац skill-а, опечатка в имени раздела или новый раздел без ссылки остались бы незамеченными.
- Требование: [Готово, когда](../issues/160-правила-orchestrator-md-у-предела-10000-знаков.md#готово-когда)
- Риски и пробелы test-ов: 11 mutant-ов, каждый удаляет один абзац перенесённого раздела в копии, — все дают exit 1;
  переименованная ссылка и заголовок `## Quota` — тоже exit 1. Смысл текста test проверяет только по фразам.

## 6. Как проверено

Счёт знаков — `node -e` по `[...text].length` (как считает test) и вывод `inject-rules.mjs orchestrator` с длинным
корнем test-а: до — 9 572 знака в файле, 9 991 во вставке; после — 7 114 и 7 533.
`bash harness/hooks/tests/rules-hooks.test.sh`, `bash harness/bin/tests/agents-text.test.sh`,
`bash harness/bin/tests/start-context.test.sh`, `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0.
`pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0, green.

## Проверить себя

1. Почему заголовки «Quota» и «Long output» остались в `orchestrator.md`, хотя текст ушёл в skill?
   - Ответ: перенос старого Harness ищет заголовки разделов старого `CLAUDE.md` среди заголовков правил плагина; без
     них он счёл бы эти правила не перенесёнными.
   - Строки: `harness/hooks/tests/rules-hooks.test.sh:670-674`
2. Что поймает test, если в skill добавят раздел, на который `orchestrator.md` не ссылается?
   - Ответ: множество ссылок и множество заголовков skill-а не совпадут — FAIL «pointers and sections differ».
   - Строки: `harness/hooks/tests/rules-hooks.test.sh:663-667`
3. Почему фразы перенесённых разделов ищутся только в разделе skill-а, а не в файле правил и skill-е вместе?
   - Ответ: строки-ссылки повторяют слова правил («Before a phase», «fifth»), и поиск по обоим файлам находил их
     даже после удаления абзаца из skill-а.
   - Строки: `harness/hooks/tests/rules-hooks.test.sh:650-654`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-polish 160 (harness/hooks/rules/orchestrator.md brought from 9991 to about 7534 injected characters, under the 10000 limit of rules-hooks.test.sh, which was not raised: Quota, Long output, Ticket status, State file and State file vs ADR moved word for word into the new skill orchestrator-rules, with a one-line pointer each left in the file), head c7881bbb888529b9af1dafa6ca77b79600c583fd
>
> Gate (depth medium, two rounds):
> - Round 1, reviewer (lens: correctness) — FIX, one med, one low.
>   - med: the topics of the moved sections were searched in orchestrator.md and SKILL.md joined, and the pointer lines repeat the Quota phrases. Deleting a Quota paragraph from the skill left every test green (mutation, exit 0).
>   - low: docs/features/skills-agents-and-hooks.md:13 gave the wrong skill count and had no owner-check row.
>   - Checked fine:
>     - the moved text matches the deleted lines word for word (word diff: 0 differences);
>     - the status block, the Stage-line rule, the closed list and the delegate list stay in orchestrator.md;
>     - the pointers name real sections, and the frontmatter matches the other skills;
>     - the migrate plan's pluginRuleHeadings result is unchanged;
>     - no other test quotes a moved phrase;
>     - the new text is English only.
> - Fix c7881bbb8:
>   - SKILL_TOPICS in rules-hooks.test.sh:601-607, searched in each section of the skill alone, with at least one phrase per paragraph and none from the pointer lines (:647-658);
>   - 11 mutations, one paragraph each across all five sections: every one exits 1;
>   - docs count fixed to 15 and an owner-check row added; the ru page was already stale and is left (rules.md: behaviour PRs edit the English page).
> - Round 2: the test diff read by the orchestrator. It closes the finding.
> Evidence: rules-hooks, agents-text, start-context and plugin-neutral tests exit 0; harness-migrate contract exit 0; lint exit 0; gate fast green; story-check exit 0.
> Not verified: whether the model opens the skill at the right moment (no eval case).

Code: `docs/features/skills-agents-and-hooks.md:13-13` · key lines: 13

```md
plugin carries fifteen skills of worfy's own and twenty copied from Matt Pocock's skills.
```

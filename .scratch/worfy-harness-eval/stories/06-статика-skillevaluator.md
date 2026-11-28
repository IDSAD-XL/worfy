# Code story — worfy-harness-eval 06: Статика SkillEvaluator по 35 skill-ам

Kind: pr · Epic: worfy-harness-eval · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

worfy ставит `harness/` plugin-ом и в Claude Code, и в Codex, но ни один run наших eval-ов не проверял, загружает ли
Codex skill-ы Harness. Владелец согласился на один бесплатный прогон статики NVIDIA SkillEvaluator. Код продукта PR
не меняет: он несёт итог прогона в «Итог» Ticket-а.

- Требование: [Что происходит](../issues/06-статика-skillevaluator.md#что-происходит)

## 2. Общая причина degraded у всех 35 skill-ов

Code: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:84-90` · key lines: 84, 85, 87, 88

```md
Для всех 35 skill-ов ответ одинаковый: **Claude Code — degraded, Codex — degraded**; drops нет ни у одного. Причина
общая для каталога, не для skill-а: у 35 skill-ов 9 668 символов description, а список skill-ов, когда окно модели
неизвестно, вмещает 8 000 (`CC-LIST-BUDGET`: Claude Code укорачивает description; `CX-LIST-BUDGET`: Codex укорачивает,
потом убирает description, потом выбрасывает skill-ы). Это зависит от окна: на `qmd` с `--context-tokens 200000` —
Claude Code degraded, Codex loads; с `--context-tokens 1000000` — оба loads (exit 0 у обоих запусков). Сколько
символов занимают skill-ы других plugin-ов в той же сессии, `harness-check` не знает: он считает только папку
`harness/skills/`.
```

- Что делает: говорит, что одинаковый ответ degraded у всех skill-ов — свойство каталога (сумма description), а не
  отдельного skill-а, и что вердикт меняется с размером окна модели.
- Почему здесь: Ticket просит по каждому skill-у ответ для Claude Code и Codex «и почему» (`Что строить`); без этого
  абзаца таблица из 35 одинаковых строк читалась бы как 35 разных поломок.
- Без него: владелец не отличил бы общую причину (бюджет списка skill-ов) от находок отдельных skill-ов
  (`epic-wave`, `human-review-setup`, `overnight-fix-loop`).
- Требование: [Что строить](../issues/06-статика-skillevaluator.md#что-строить)
- Риски и пробелы test-ов: прогоны с `--context-tokens` сделаны на одном skill-е `qmd`; это допустимо, потому что
  находка считается по всей папке, но для других skill-ов этот прогон не повторялся.

## 3. Чего статика не проверила

Code: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:117-120` · key lines: 117, 118, 120

```md
- **Hook-и и `bin/` Tier 1 не сканировал вовсе.** Ни одной находки по `hooks/hooks.json`, в выводе нет слова «hook»;
  ожидаемая по их docs находка BH1 «hook payload unmodeled» не пришла ни на один из 21 command hook-а. Это совпадает с
  открытым issue #495 их репозитория (у plugin-а сканируются только bundled skills), а не с `docs/tier1-reference.mdx:362`. Значит,
  hook-и и скрипты Harness этой статикой не проверены.
```

- Что делает: записывает, что Tier 1 по plugin-у не сканировал `hooks/` и `bin/`, — «не проверено», а не «чисто».
- Почему здесь: бриф Orchestrator-а ждал на каждом command hook-е находку BH1 и велел считать её шумом; её отсутствие —
  факт о покрытии, а не чистый результат. Правило «`INCOMPLETE` — это не проверено» записано в Ticket-е
  (`Что строить`).
- Без него: отсутствие находок по hook-ам читалось бы как «hook-и Harness прошли проверку безопасности».
- Требование: [Готово, когда](../issues/06-статика-skillevaluator.md#готово-когда)
- Риски и пробелы test-ов: вывод сделан по отсутствию строк в отчёте; исходный код SkillEvaluator, который решает,
  что сканировать у plugin-а, не читался.

## 4. Что сознательно не меняли

- `harness/` и skill-ы: находки — вопросы владельцу в «Итог», Ticket-ы по правилу провала сами не заводятся.
- `docs/product/` — папки тем правит только Product Session.
- Tier 2 и Tier 3, `--llm` — не запускались: им нужны модель или embeddings.

## 5. Как проверено

- `skillevaluator harness-check <skill> -v --json …` — 35 запусков, exit 0 каждый.
- `skillevaluator validate <harness> --tiers 1 --no-llm` — exit 1 (`FAIL`, Security Scan `INCOMPLETE`).
- `skillevaluator tier1 <skill> --no-llm` — 35 запусков: exit 0 у двух, exit 1 у 33.
- `pnpm lint` — exit 0.

## Проверить себя

1. Почему все 35 skill-ов получили degraded и у Claude Code, и у Codex, хотя сами skill-ы разные?
   Ответ: Причина — сумма description всего каталога (9 668 символов) больше бюджета списка skill-ов (8 000 при
   неизвестном окне); при окне 1M tokens оба агента skill-ы загружают.
   Lines: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:84-90`
2. Почему отсутствие находок по hook-ам — не «hook-и чисты»?
   Ответ: Tier 1 по plugin-у hook-и и `bin/` не сканировал вовсе: даже ожидаемая шумовая BH1 не пришла.
   Lines: `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:117-120`

## 6. Что нашёл review и что осталось

> VERIFIED — round 1 found one low finding only (the «Итог» said 20 command hooks; hooks.json has 21); the Orchestrator fixed it in the ticket and its Code story (3a184a515; story-check ok). The reviewer's report of head a276855d4 follows.
>
> Reviewer's line was: REJECTED: [low] the «Итог» says Harness has 20 command hooks, but `harness/hooks/hooks.json` on origin/main has 21
>
> - `.scratch/worfy-harness-eval/issues/06-статика-skillevaluator.md:118`: [low] The text says the BH1 finding («hook payload unmodeled») came for none of the «20 command hook-ов». `git show origin/main:harness/hooks/hooks.json | grep -c '"type": *"command"'` returns 21. That folder is the same at commit `1f66f5994`, the main commit the run used, so the number is wrong at the time of the run too. Fix: write 21.
> - `…issues/06-статика-skillevaluator.md:134`: question, not a finding. The `body_heading` row (skill body has no `# heading` after the frontmatter) lists 12 skills. On origin/main `to-questionnaire/SKILL.md` also starts its body with plain text, which makes 13. The row may simply copy what SkillEvaluator printed. I did not rerun the tool, so I cannot tell whether the tool missed it or the row did.
> - These claims held on origin/main `0bfb5e57d`, where `harness/skills` and `harness/hooks` are unchanged since `1f66f5994` (`git diff --quiet` exit 0):
>   - There are 35 skills.
>   - `epic-wave/SKILL.md` is 162 984 bytes (`wc -c`).
>   - 13 skills set `disable-model-invocation: true`. 11 of them have `agents/openai.yaml` with `allow_implicit_invocation: false`; `human-review-setup` and `overnight-fix-loop` do not.
>   - `argument-hint` is used only by handoff, owner-check and teach.
>   - The XML-tag list matches exactly: connect-project, max-review, overnight-fix-loop, owner-check, pr-fix, pr-reply, ship-ticket.
>   - The cited lines match: epic-wave `:967/:1538/:1543`, pr-fix `:29`, human-review-setup `:188`, tdd `mocking.md:45`, to-questionnaire `:9`.
>   - Descriptions total 9 684 characters by my rough YAML parse against the claimed 9 668. The gap comes from how quotes and folded lines are counted; it is not a finding.
> - The «Готово, когда» items (done-when checklist) are all `[ ]`, and each has an evidence line. Commit `8671e4405` is in the branch (`merge-base --is-ancestor` exit 0). The `ci-ok` CI check is stated green in your brief.
> - The owner decisions line at `:154` matches your brief: 1 yes (openai.yaml for both skills), 2 yes (split epic-wave into step files like ship-ticket), 3 yes (shorter descriptions, trigger first), 4 no.
> - The Q1–Q3 follow-up work is not ticketed. On origin/main nothing in `.scratch` mentions openai.yaml or the epic-wave split for this work; the hits are older tickets from other epics. The last worfy-polish ticket is 174. Line `:154` says the Orchestrator will open these tickets in worfy-polish; that is still to do.
> - What I ran:
>   - `bin/profile` exit 0.
> [line 20 of the verdict is not quoted: personal data (home-path)]
>   - `git show`/`wc -c`/`grep`/`node` spot checks, 10+ claims.
> - Could not verify: the SkillEvaluator outputs themselves (degraded/loads results, Tier 1 counts, the 25/35 incomplete scans, the tool versions). The tool and its temporary environment were deleted, and I did not reinstall it.
>
> Nothing else found.
>
> Review depth: low — ticket

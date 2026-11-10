# 83 — Стартовый контекст implementer-а: вернуть запас не меньше 1000 token-ов

Type: task
Status: claimed 2026-11-10T03:06Z
Blocked by: —
Source: находка Orchestrator-а 2026-11-10: `node harness/bin/start-context --agent implementer` на main `c69ffd43b` —
14 993 token-а из порога 15 000, запас 7. Строки перечитаны по main `c69ffd43b`.

## Что происходит

`harness/bin/start-context` оценивает в token-ах то, что агент Harness-а читает до первой правки, и краснеет выше
порога 15 000. В порог идут только тексты, которые пишет Harness. У implementer-а их три:

- определение `harness/agents/implementer.md` — 4 982 token-а;
- `harness/hooks/rules/common.md` (его вставляет SubagentStart hook) — 2 402;
- `harness/skills/ship-ticket/SKILL.md` (skill, которому implementer следует с первого шага) — 7 609.

Итого 14 993: ok, но до порога 7 token-ов. Shell test `harness/bin/tests/start-context.test.sh`, раздел 3 («the real
texts of this Harness»), краснеет на первой же правке любого из трёх файлов, которая добавит строку. Поднимать порог
нельзя: комментарий у `THRESHOLD` и сообщение test-а прямо требуют сокращать тексты.

## Что делаем

- Сократить `harness/skills/ship-ticket/SKILL.md` и, если этого мало, `harness/agents/implementer.md` так, чтобы
  implementer стартовал не больше чем с 14 000 token-ов (запас ≥ 1000).
- Ни одно правило не теряется: подробности шага уезжают в файл шага рядом со `SKILL.md` (как уже сделано для
  `step-7-review.md`, `step-9-merge.md`, `implementer-report.md` и других), а в `SKILL.md` остаётся одна строка правила
  и ссылка `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/<файл>` с условием, когда его читать. Раздел 3a того же test-а
  проверяет, что каждый файл шага назван и существует.
- Кандидаты — самые длинные разделы `SKILL.md`: «0. Profile» (:32–89), «2. Fresh base, own worktree and free numbers»
  (:113–157), «5. Implementation» (:174–207), «6. Checks» (:208–230). Повторы между `implementer.md` и `SKILL.md`
  оставить в одном месте.
- `harness/hooks/rules/common.md` не трогать: его читают все агенты, и правки в нём — отдельное решение.
- Это текст Harness-а: перед merge — платный `node scripts/eval-harness.mjs --changed origin/main` по правилам
  `rules-merge.md` (сначала `--dry-run`, предодобрено до 100 USD), цена и итог — в «Итог».

## Готово, когда

- [ ] `node harness/bin/start-context --agent implementer` — exit 0, implementer не больше 14 000 token-ов; число в «Итог».
  - evidence: test-run pass · `node harness/bin/start-context --profile <fixture> --agent implementer` exit 0, implementer 13 723 tokens · mac - · 76c443d7895aa4cece0a1d3f79240d6bcf1cd70b
- [ ] Список правил `SKILL.md` и `implementer.md` до правки сверен с текстом после неё: каждое правило есть в
      `SKILL.md`, `implementer.md` или в файле шага, на который они ссылаются; таблица «правило → где теперь» — в «Итог».
  - evidence: commit pass · Ship-ticket skill: steps 2 and 5 details move into step files, implementer starts at 13 723 tokens (worfy-polish 83) · - - · 76c443d7895aa4cece0a1d3f79240d6bcf1cd70b
- [ ] `bash harness/bin/tests/start-context.test.sh` — exit 0 (разделы 3 и 3a), `THRESHOLD` не изменён.
  - evidence: test-run pass · `bash harness/bin/tests/start-context.test.sh` exit 0 · mac - · 76c443d7895aa4cece0a1d3f79240d6bcf1cd70b
- [ ] Test-ы Harness-а, которые читают skill `ship-ticket` (`harness/bin/tests/epic-wave-ship-ticket.test.sh` и
      другие, что grep-ом находят `ship-ticket/SKILL.md`), — exit 0.
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` and 11 other texts tests exit 0 · mac - · 76c443d7895aa4cece0a1d3f79240d6bcf1cd70b
- [ ] Платный `eval --changed` — все затронутые case-ы на пороге или выше; команда, exit code и цена — в «Итог».
- [ ] `ci-ok` на PR зелёный.

## Где в коде

- `harness/bin/start-context:65` — `const THRESHOLD = 15000`, комментарий :61–64 запрещает поднимать порог ради
  текстов; :100 — запись `implementer` (`skill: true`); :285–293 — какие части считаются (`counted: true`).
- `harness/bin/tests/start-context.test.sh:196–205` — раздел 3, реальные тексты Harness-а в пороге; :207–225 —
  раздел 3a, файлы шагов рядом с `SKILL.md` названы и существуют.
- `harness/skills/ship-ticket/SKILL.md` — 262 строки, разделы :32 «0. Profile» … :258 «When to stop».
- `harness/agents/implementer.md` — разделы :45 «Where to work», :79 «Boundaries», :118 «Order», :149 «Report».

## Вне скоупа

- Порог и коэффициент bytes per token в `start-context`.
- Части, которые Harness не пишет (константа Claude Code, правила пользователя, профиль, brief).

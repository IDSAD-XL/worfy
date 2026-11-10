# 91 — Вердикт reviewer-а читается с первой строки, которая начинается с `VERIFIED` или `REJECTED`

Type: bug
Status: claimed 2026-11-10T09:17Z
Blocked by: 84
Source: платный eval Orchestrator-а 2026-11-10 на head PR #1757 (worfy-polish 84): case `reviewer-verdict` — 0.89, в
run-е 2 третьего раунда grader `rejected-first` не прошёл (trace — `worfy-orch/eval-traces-1757/r3-run2-failed`).
Решение владельца 2026-11-10 — ниже, в «Что делаем». Строки перечитаны по main `2d591a7d5`.

## Что происходит

После тикета 84 reviewer пишет вердикт голой первой строкой (`VERIFIED` / `REJECTED: …`) в двух run-ах из трёх. В
третьем последнее сообщение subagent-а начинается с вводной фразы («This confirms the commit under review itself
introduced the regression…»), а `REJECTED: …` стоит на следующей строке. Основная сессия eval-а сохраняет ответ как
есть в `verdict.md`, grader `^REJECTED:` смотрит только на начало файла — и case падает, хотя вердикт верный.

Те же ответы читают и другие стороны, и каждая по-своему:

- worfy берёт вердикт только из первой строки ответа: Flight Recorder (`from-transcript.ts`), work-track
  (`work-track/transcripts.ts`), Subagent-ы в rail и на Canvas (`transcript/subagents.ts`, `codex/subagents.ts` — там
  слово ищется ещё и в середине первой строки); вводная фраза — и вердикта нет.
- PR comment-ы Gate-а (`pr-facts.mjs`, `github/prs.ts`) читаются только с начала тела comment-а.
- Skill `epic-wave` велит записать вердикт, который несёт ответ verifier-а, но не говорит, где его искать в ответе.

## Что делаем

Решение владельца 2026-11-10: сторона, которая сохраняет, публикует или читает вердикт, берёт текст с первой строки,
которая начинается с `VERIFIED` или `REJECTED`, и отбрасывает вводную часть до неё. Так исход не зависит от того, как
модель начала сообщение. Сообщение без такой строки остаётся «без вердикта», как сегодня, — вердикт никогда не
угадывается.

Решение Orchestrator-а 2026-11-10 (до ревью PR #1781): читатели терпимы к разметке, grader строгий. Reviewer по тикету
84 пишет вердикт голым, и grader это проверяет; но старые transcript-ы и ответы не по форме с вердиктом в начале
строки (жирным, с heading mark, в backtick-ах) читаются как раньше — их chip Subagent-а и outcome во Flight Recorder не
пропадают. Слово в середине первой строки («Вердикт: REJECTED…», «Round 2: REJECTED…») по правилу владельца больше не
вердикт — это в «Итог», removed.

- Одно правило — функция «найти вердикт» в двух копиях, как правила Evidence и Pipeline: в Harness —
  `harness/lib/verdict.cjs`, в worfy — `src/shared/workflow/verdict.mjs`. Обе читают общие fixture-ы Harness-а, и
  contract test держит их вместе.
- Строка вердикта: в начале строки (после пробелов) слово `VERIFIED` или `REJECTED` целиком, по желанию после
  heading mark и emphasis или backtick-а (`## `, `**`, `__`, `*`, `_`, `` ` ``) и после `NARROW:` (вердикт узкого
  раунда в PR comment-е). Текст вердикта начинается со слова: разметка перед ним и закрывающая пара сразу после слова
  (или после слова и двоеточия, или в конце строки) убираются, так что `startswith("REJECTED")` в skill-ах видит его.
  BOM в начале ответа пропускается. Не вердикт: слово внутри предложения, за меткой (`Verdict: REJECTED`), цитата и
  пункт списка (`> `, `- `, `* `, `1. `), слово, к которому приклеены буква или цифра (и не ASCII), `_` или `/`
  (`VERIFIED/REJECTED:`), и любая строка fenced code block-а (правило `harness/lib/code-fence.cjs`).
- Новый script `bin/verdict <файл>` (или stdin): печатает ответ с найденной строки, exit 0; без вердикта — exit 1 и
  причина в stderr. Skill `epic-wave` (раздел 3) велит записывать вердикт verifier-а через него. `ship-ticket` правки не
  требует: там вердикт составляет сама сессия по группам находок, а не берёт из одного ответа.
- Все читатели в worfy — через функцию: Flight Recorder, work-track, Subagent-ы Claude Code и Codex, PR comment-ы
  Gate-а (`verdictComments`) и вердикты узкого раунда (`narrowRoundsOf`).
- Grader `rejected-first` case-а `reviewer-verdict` строже читателей: находит строку вердикта так же, как они
  (с разметкой перед словом, без строк fenced code block-а), пропускает только вводную до неё и требует, чтобы эта
  строка была голым `REJECTED:` без `VERIFIED`. В каждом общем fixture-е записано, что скажет grader; contract test
  сверяет его и проверяет: если grader пропустил ответ, читатели видят тот же голый `REJECTED:`. `**REJECTED**`
  читатели читают как REJECTED, grader — не пропускает; `**VERIFIED**`, а ниже голый `REJECTED: x` — читатели видят
  VERIFIED, grader тоже не пропускает.
- Это правка script-ов Harness-а — платформенный PR.

## Готово, когда

- [ ] Unit/contract test-ы функции на общих fixture-ах: вводная фраза и `REJECTED` строкой ниже — `REJECTED`, текст
      без вводной; нет строки с вердиктом — нет вердикта; `VERIFIED` внутри предложения ниже — не вердикт; обе копии
      дают один ответ.
  - evidence: test-run pass · `pnpm test test/contract/verdict-rules-agree.test.ts` exit 0 · mac - · ad06fde2a0215b309da31d05bfc40e7e8b30fc76
  - evidence: test-run pass · `pnpm test test/contract/verdict-rules-agree.test.ts` exit 0 · mac - · 313617900cef7b0cd2b7d5523d99b59032e565d2
  - evidence: test-run pass · `pnpm test test/contract/verdict-rules-agree.test.ts` exit 0 · mac - · da09c53df92edad13383b990b2860851a851eded
- [ ] `harness/bin/tests/verdict.test.sh` — exit 0: script печатает ответ со строки вердикта, без вердикта — exit 1.
  - evidence: test-run pass · `bash harness/bin/tests/verdict.test.sh` exit 0 · mac - · ad06fde2a0215b309da31d05bfc40e7e8b30fc76
  - evidence: test-run pass · `bash harness/bin/tests/verdict.test.sh` exit 0 · mac - · 313617900cef7b0cd2b7d5523d99b59032e565d2
  - evidence: test-run pass · `bash harness/bin/tests/verdict.test.sh` exit 0 · mac - · da09c53df92edad13383b990b2860851a851eded
- [ ] Grader `rejected-first` принимает ответ из trace-а `r3-run2-failed` и по-прежнему не принимает `**REJECTED — …**`,
      `REJECTED —` без двоеточия и `VERIFIED` на одной строке с `REJECTED`.
  - evidence: test-run pass · `pnpm test test/contract/harness-evals.test.ts test/contract/verdict-rules-agree.test.ts` exit 0 · mac - · ad06fde2a0215b309da31d05bfc40e7e8b30fc76
  - evidence: test-run pass · `pnpm test test/contract/harness-evals.test.ts test/contract/verdict-rules-agree.test.ts` exit 0 · mac - · 313617900cef7b0cd2b7d5523d99b59032e565d2
  - evidence: test-run pass · `pnpm test test/contract/harness-evals.test.ts test/contract/verdict-rules-agree.test.ts` exit 0 · mac - · da09c53df92edad13383b990b2860851a851eded
- [ ] Читатели worfy берут вердикт после вводной фразы: test-ы Flight Recorder, Subagent-ов Claude Code и Codex,
      PR comment-ов.
  - evidence: test-run pass · `pnpm test test/unit/subagents.test.ts test/unit/flight-recorder-transcript.test.ts test/unit/flight-recorder-github.test.ts test/contract/claude-home-subagents.test.ts test/contract/codex-subagents.test.ts test/contract/github-prs.test.ts test/contract/work-track-transcripts.test.ts` exit 0 · mac - · ad06fde2a0215b309da31d05bfc40e7e8b30fc76
  - evidence: test-run pass · `pnpm test test/unit/subagents.test.ts test/unit/flight-recorder-transcript.test.ts test/unit/flight-recorder-github.test.ts test/contract/claude-home-subagents.test.ts test/contract/codex-subagents.test.ts test/contract/github-prs.test.ts test/contract/work-track-transcripts.test.ts` exit 0 · mac - · 313617900cef7b0cd2b7d5523d99b59032e565d2
  - evidence: test-run pass · `pnpm test:e2e test/e2e/subagent-tree.spec.ts` exit 0 · mac - · 313617900cef7b0cd2b7d5523d99b59032e565d2
  - evidence: test-run pass · `pnpm test test/unit/subagents.test.ts test/unit/flight-recorder-transcript.test.ts test/unit/flight-recorder-github.test.ts test/contract/claude-home-subagents.test.ts test/contract/codex-subagents.test.ts test/contract/github-prs.test.ts test/contract/work-track-transcripts.test.ts` exit 0 · mac - · da09c53df92edad13383b990b2860851a851eded
  - evidence: test-run pass · `pnpm test:e2e test/e2e/subagent-tree.spec.ts` exit 0 · mac - · da09c53df92edad13383b990b2860851a851eded
- [ ] `node scripts/eval-harness.mjs --case reviewer-verdict --dry-run` — exit 0 (платный run делает Orchestrator).
  - evidence: test-run pass · `node scripts/eval-harness.mjs --case reviewer-verdict --dry-run` exit 0 · mac - · ad06fde2a0215b309da31d05bfc40e7e8b30fc76
  - evidence: test-run pass · `node scripts/eval-harness.mjs --case reviewer-verdict --dry-run` exit 0 · mac - · da09c53df92edad13383b990b2860851a851eded
- [ ] gate fast — exit 0, `[gate] green`.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ad06fde2a0215b309da31d05bfc40e7e8b30fc76
  - evidence: gate pass · `gate fast` exit 0 · mac - · 313617900cef7b0cd2b7d5523d99b59032e565d2
  - evidence: gate pass · `gate fast` exit 0 · mac - · da09c53df92edad13383b990b2860851a851eded
- [ ] `ci-ok` на PR зелёный.

## Где в коде

- `harness/lib/verdict.cjs` (новый), `harness/lib/README.md` — правило в Harness-е.
- `harness/bin/verdict` (новый), `harness/bin/tests/verdict.test.sh` (новый), `harness/bin/tests/fixtures/verdict/`
  (новые общие fixture-ы).
- `harness/skills/epic-wave/SKILL.md:650` — «The verifier's answer starts with its verdict…».
- `harness/evals/reviewer-verdict/graders/rejected-first.md:4` — `pattern: '^REJECTED:(?!.*VERIFIED)'`.
- `src/shared/workflow/verdict.mjs`, `verdict.d.mts` (новые) — копия правила в worfy.
- `src/shared/flight-recorder/from-transcript.ts:80`, `:672` — вердикт verifier-а в фактах.
- `src/main/work-track/transcripts.ts:72`, `:127` — вердикт в урезанном transcript-е.
- `src/shared/transcript/subagents.ts:422` — вердикт Subagent-а Claude Code.
- `src/main/vendors/codex/subagents.ts:123` — вердикт Subagent-а Codex.
- `src/shared/flight-recorder/pr-facts.mjs:97` — PR comment-ы Gate-а.
- `src/main/github/prs.ts:278` — `narrowRoundsOf`.
- `docs/features/harness.md` — новый script; `docs/features/sessions.md` — chip вердикта Subagent-а;
  `docs/features/skills-agents-and-hooks.md` — линза «implementer's report».
- Test-ы: `test/contract/verdict-rules-agree.test.ts` (новый), `test/contract/harness-evals.test.ts`, test-ы
  читателей (`test/unit/subagents.test.ts`, `test/unit/flight-recorder-transcript.test.ts`,
  `test/unit/flight-recorder-github.test.ts`, `test/contract/claude-home-subagents.test.ts`,
  `test/contract/codex-subagents.test.ts`, `test/contract/github-prs.test.ts`,
  `test/contract/work-track-transcripts.test.ts`). Fixture `verify-07` с `**REJECTED**`
  (`test/fixtures/claude-home/projects/-Users-test-projects-agents/`) и `test/e2e/subagent-tree.spec.ts` не меняются:
  они доказывают, что вердикт с разметкой читается, как раньше.

## Вне скоупа

- `gate:` commit-ы (`from-gate.ts`): subject — одна строка, вводной фразы перед ним не бывает.
- `stripArmMarkers` в `scripts/eval-outcome-lib.mjs`: убирает метку arm-а для судьи outcome-eval-а, вердикт не
  читает.
- Отметка `review` (commit status) — не текст.

## Итог

- Правило вердикта — `harness/lib/verdict.cjs` и копия `src/shared/workflow/verdict.mjs`, общие fixture-ы
  `harness/bin/tests/fixtures/verdict/cases.json` (49 случаев, у каждого — ожидание grader-а). Script `bin/verdict`;
  skill `epic-wave` записывает вердикт verifier-а через него.
- Через правило идут все читатели worfy: Flight Recorder, work-track, Subagent-ы Claude Code и Codex (chip и summary
  со строки вердикта), PR comment-ы Gate-а, состояния узкого раунда.
- Grader `rejected-first` на сохранённых ответах eval-а PR #1757: два run-а с вводной фразой (r3-run2, r2-run3)
  теперь проходят, run с меткой `VERIFIED/REJECTED:` (r2-run1) по-прежнему не проходит.
- Что изменилось в поведении (removed):
  - Subagent-ы Claude Code: старый `verdictOf` (origin/main `src/shared/transcript/subagents.ts:244-247`) находил слово
    в любом месте первой строки. Теперь слово должно начинать строку, и такие ответы теряют chip: по подсчёту ревью
    раунда 1 это около 33 из 6220 настоящих ответов reviewer-ов («Вердикт: REJECTED…», «Round 2: REJECTED…»). Это прямо
    следует из правила владельца: слово внутри строки — не вердикт.
  - Subagent-ы Codex: то же — слово в середине первой строки больше не вердикт.
  - Строка `VERIFIED/REJECTED: …` раньше читалась как VERIFIED — теперь это не вердикт.
  - Строка вердикта внутри fenced code block-а больше не считается (раньше читалась, если блок открывал ответ).
  - PR comment с `NARROW: REJECTED` после вводной теперь состояние узкого раунда `rejected`.
  - Summary Subagent-а с вердиктом начинается со строки вердикта, а не с вводной фразы.
  - Вердикт с разметкой в начале строки (`**REJECTED**`, `## REJECTED`, `` `REJECTED: …` ``) читается, как и раньше.
- Grader `rejected-first` (раунд 2): ищет строку вердикта так же, как читатели (с разметкой, без fenced code), и
  пропускает только вводную до неё; эта строка должна быть голым `REJECTED:`. `**VERIFIED**`, а под ним голый
  `REJECTED: x` — читатели видят VERIFIED, grader не пропускает.
- Платный eval `reviewer-verdict` — за Orchestrator-ом; `--dry-run` — exit 0.

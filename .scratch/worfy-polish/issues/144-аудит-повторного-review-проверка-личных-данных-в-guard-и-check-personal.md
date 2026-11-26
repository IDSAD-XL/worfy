# 144 — Аудит повторного review: проверка личных данных в guard и check-personal

Type: bug
Status: done 2026-11-25T15:59Z
PR: #2214
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «В Ticket-ы»; checked open on main b0e073620 2026-11-25

Кто: агент. Глубина review — `medium`. Это правка hook-а Harness-а (`harness/hooks/guard.mjs`) и
`scripts/check-personal.mjs` — платформенный PR (ADR-0056): вердикт Windows — job-ы Windows в CI.

Три finding-а аудита повторного review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера 95, 121,
196), все про проверку личных данных (deny list пользователя, host name, token) в тексте, который уходит наружу: в
GitHub через `gh api` и в публичный repository через `pnpm lint`. Каждое проверено на main b0e073620: все три ещё
открыты, 95 — частично.

## Что происходит

- **95. Файл для `--input` проверяется со старым содержимым.** Guard (`harness/hooks/guard.mjs:822`, `fileText`)
  читает с диска файл, который команда отправляет (`gh api --input file`, `-F key=@file`, `gh pr --body-file`), до
  того, как команда запущена. Часть уже исправлена: файл, которого ещё нет и который назван в более ранней части той же
  команды, guard отклоняет (`u.earlier`, `guard.mjs:668-675`, текст отказа `:345-352`; test `WRITE_THEN_POST`,
  `harness/hooks/tests/guard-silent.test.sh:262-267`). Не исправлено для файла, который уже есть: в
  `cp draft.json payload.json && gh api -X POST repos/o/r/issues/7/comments --input payload.json` guard проверяет
  старый чистый `payload.json`, а в GitHub уходит новый текст. Сценарий: agent в Silent mode второй раз пишет ответ в
  тот же файл, теперь с фамилией пользователя из deny list, и комментарий с ней публикуется на публичном PR.
- **121. Неявный POST только с `--input` не проверен.** `guard.mjs:646-647`:
  `const write = method ? … : fields.length > 0 || input !== undefined`. Test-ы покрывают неявный POST через `-f`
  (`guard-silent.test.sh:105`, `:279`); все REST-test-ы с `--input` передают `--method POST` (`:115`, `:118`, `:120`,
  `:158`), а `gh api graphql --input` (`:153`) идёт веткой GraphQL. Mutant, который убирает `|| input !== undefined`,
  выживает: `gh api repos/o/r/issues/7/comments --input p.json` без `-X` публикует текст без проверки, а test-ы зелёные.
- **196. Кириллические deny-записи ловят только именительный падеж.** `scripts/check-personal.mjs:30-36` прямо пишет в
  «What is not caught»: «a non-Latin entry glued to any letter, mark or digit (a Cyrillic case ending)», и
  `test/unit/check-personal.test.ts:228-235` закрепляет это (`${CYRILLIC}ович не целое слово` — не finding). Guard
  сессий так не ошибается: `harness/lib/privacy.cjs:196-199` ищет слово deny list в любом месте текста. Сценарий: в
  личном deny list фамилия «Иванов»; commit с русским текстом docs, где стоит «Иванова» или «Ивановым», написанный не
  через Session (руками, другим инструментом), проходит `pnpm lint` (`check-personal`) и CI, и фамилия попадает в
  публичный repository.

## Вопрос владельцу (только для 196)

`check-personal` хранит в repository только hash-и записей, не сами слова (`scripts/check-personal.hashes.json`),
поэтому основу слова script не знает. Два пути:

- (а) пользователь сам вписывает падежные формы в `~/.claude/worfy-harness/user/privacy.json` — кода нет, hash-ей
  больше, docs объясняют правило;
- (б) для слова на кириллице script дополнительно хеширует слово без одного окончания из фиксированного списка падежных
  окончаний (`а`, `у`, `ом`, `ым`, `ой`, `е`, `ы`, `ов`, `ам`, `ами`, `ах`, `ых`, `им`, `ую`, `ая`…) и сравнивает с
  записями — больше ложных finding-ов на коротких записях.

Рекомендация: (б), только для записей из одного слова длиной от 4 букв. Если владелец не ответит до начала работы,
агент делает (б) и пишет это в PR.

Решено без владельца, 2026-11-25: сделан путь (б) — подтверждено владельцем 2026-11-26: для находки 196 принят
вариант (б), script отрезает типовые окончания и хеширует ещё раз; дополнение ниже подтверждено тем же словом. Дополнение к (б): после снятия окончания script
ставит на место окончание именительного (нет, -а, -я, -й, -ь, -ий, -ый, -ой), иначе запись на -а, -й или фамилия
на -ский, -цкий, -ой в косвенном падеже не находится. Голая основа (без окончания) — только для записей от пяти
букв (review round 1). Цена: `check-personal` на всём repository — user CPU 5.3 s → 6.1 s при низкой нагрузке,
8.7 s → 11.1 s при load average 35–45.

## Что делаем

1. 95: guard отклоняет отправку файла, который назван в более ранней части той же команды, и когда файл уже есть, — тем
   же текстом отказа «Write the file in one command, then send it in the next one». Отказ только при упоминании пути до
   `gh api`; файл, который команда не называет раньше, проверяется как сейчас.
2. 121: test на `gh api repos/o/r/issues/7/comments --input p.json` без `-X`/`--method` с deny-словом в файле — deny.
3. 196: выбранный путь (см. вопрос) в `scripts/check-personal.mjs`; блок «What is not caught» и test
   `check-personal.test.ts:228` меняются под новое правило. `harness/lib/privacy.cjs` не меняется.

## Готово, когда

- [ ] 95: test в `harness/hooks/tests/guard-silent.test.sh` рядом с `:267` — `payload.json` уже есть с чистым текстом,
      команда `cp <файл с deny-словом> payload.json && gh api -X POST … --input payload.json` — deny. Красный на
      origin/main.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 (passed 195; on origin/main code exit 1, 2 failed: overwrite then post) · mac - · a8a8d5260460332c373e13a8c0a0712837709865
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 (passed 203; review round 1 cases failed 6 before the fix) · mac - · b82f008bc0a4793e09ea84f04c74d7cb060a61a5
  - evidence: review pass · PR #2214 · - - · 13239775e3bd3551d34a8b3e31fcfddb26c05841
- [ ] 121: test в `harness/hooks/tests/guard-silent.test.sh` рядом с `:114` — `gh api <REST endpoint> --input p.json`
      без метода, в файле deny-слово — deny; mutant «убрать `|| input !== undefined`» (`guard.mjs:647`) — красный.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0; mutant without input in the implicit POST rule exit 1 (the --input only test failed) · mac - · a8a8d5260460332c373e13a8c0a0712837709865
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 (passed 203, the --input only implicit POST case included) · mac - · b82f008bc0a4793e09ea84f04c74d7cb060a61a5
  - evidence: review pass · PR #2214 · - - · 13239775e3bd3551d34a8b3e31fcfddb26c05841
- [ ] 196: unit test `test/unit/check-personal.test.ts` — запись на кириллице находится в косвенном падеже («…а»,
      «…ым»), по выбранному пути (при (а) — форма, вписанная в список). Красный на origin/main.
  - evidence: test-run pass · `vitest run test/unit/check-personal.test.ts` exit 0 (27 passed; the oblique-case test failed before the change) · mac - · a8a8d5260460332c373e13a8c0a0712837709865
  - evidence: test-run pass · `vitest run test/unit/check-personal.test.ts` exit 0 (29 passed; adjective and four-letter cases failed before the fix) · mac - · b82f008bc0a4793e09ea84f04c74d7cb060a61a5
  - evidence: review pass · PR #2214 · - - · 13239775e3bd3551d34a8b3e31fcfddb26c05841
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `bash harness/hooks/tests/guard-silent.test.sh` — exit 0;
      `ci-ok` зелёный на head PR, job-ы Windows CI зелёные (платформенный PR).
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45646721210/job/139330346506 · ci - · 13239775e3bd3551d34a8b3e31fcfddb26c05841

## Где в коде

- `harness/hooks/guard.mjs:640-690` (разбор `gh api`, `write`, `u.earlier`), `:345-352` (текст отказа), `:820-830`
  (`fileText`)
- `harness/hooks/tests/guard-silent.test.sh:100-160`, `:262-270`
- `scripts/check-personal.mjs:20-40` (правило слова, «What is not caught»)
- `test/unit/check-personal.test.ts:228-236`
- `harness/lib/privacy.cjs:196-199` — только читать (guard ищет слово в любом месте)

## Вне скоупа

- Остальные находки `triage.md`.
- Латинские записи, склеенные с буквой или цифрой (`foos` для `foo`): правило остаётся.

# 144 — Аудит повторного review: проверка личных данных в guard и check-personal

Type: bug
Status: claimed 2026-11-25T14:10Z
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
- [ ] 121: test в `harness/hooks/tests/guard-silent.test.sh` рядом с `:114` — `gh api <REST endpoint> --input p.json`
      без метода, в файле deny-слово — deny; mutant «убрать `|| input !== undefined`» (`guard.mjs:647`) — красный.
- [ ] 196: unit test `test/unit/check-personal.test.ts` — запись на кириллице находится в косвенном падеже («…а»,
      «…ым»), по выбранному пути (при (а) — форма, вписанная в список). Красный на origin/main.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `bash harness/hooks/tests/guard-silent.test.sh` — exit 0;
      `ci-ok` зелёный на head PR, job-ы Windows CI зелёные (платформенный PR).

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

# 146 — Аудит повторного review: файлы темы Product Session на Windows и mind-map.json

Type: bug
Status: done 2026-11-25T16:38Z
PR: #2216
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «В Ticket-ы»; checked open on main b0e073620 2026-11-25

Кто: агент. Глубина review — `medium` (утечка данных входа Windows). Не платформенный PR: test-ы подменяют `paths` и
`links`, как `test/unit/docs-remote-links.test.ts`; job-ы Windows CI всё равно должны быть зелёные.

Три finding-а аудита повторного review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера 58 с
дублями 59, 78, 80; 79; 93), все про то, как main process читает и пишет файлы Product Session. Каждое проверено на main
b0e073620: все открыты.

## Что происходит

- **58 (и 59, 78, 80). Symlink в папке темы ведёт к утечке NTLM на Windows.** `readProductTopic`
  (`src/main/docs/watch.ts:251-261`) на Windows проверяет `leadsToRemote` только для папки темы. Внутри неё
  `readTopic` читает `map.md` и `mind-map.json` (`src/main/product/topic.ts:62-66`, `readText`) и делает `readdir` по
  `issues/` (`topic.ts:114-118`) без проверки ссылок. `mind_map_read` (`src/main/mcp/mind-map-server.ts:264-269`)
  зовёт `readTopic` напрямую, без всякой проверки. Сценарий: в склонированном repository в папке темы лежит symlink
  `map.md` → `\\host.example\share\map.md`; пользователь открывает Product Session, worfy читает файл, и Windows сама
  отдаёт чужому host-у NTLM-данные входа пользователя, клика не нужно.
  - 59: `readAdviceShare` (`src/main/ipc/product.ts:57-66`) делает `readdir` папки Product Session (`:60`) до
    проверки ссылки, а `readReviews` (`:39-55`) читает каждый `critic/*.md` через `readFile` без проверки файла.
  - 78: отказ `readProductTopic` на ссылке к удалённому host-у не закреплён test-ом: в `test/unit/product-topic.test.ts`
    и `test/unit/product-share.test.ts` нет ни одного случая с удалённой ссылкой.
  - 80: `readReviews` и `readAdviceShare` не принимают `paths` и `links`, поэтому их отказ нельзя проверить test-ом.
- **79. Нечитаемый `mind-map.json` не проверен.** `topic.ts:158` (`if ('error' in mindMap) errors.push(…)`) не
  закреплён test-ом: `test/unit/product-topic.test.ts:66` проверяет только неверный JSON, `:95` — отсутствующий файл.
  Сценарий: `mind-map.json` не читается (EISDIR, EACCES); если проверку убрать, тема читается как пустая карта, writer
  перезаписывает карту одним node, а test-ы зелёные. Фильтр `STATUS_WORDS` (`topic.ts:109`: неизвестное слово в
  `Status:` даёт `none`) тоже без test-а.
- **93. Связка `productWrites` не проверена.** `src/main/vendors/claude/query.ts:476` передаёт `productWrites` в
  опции Session только внутри `sdkQueryFactory`; в `test/unit/agent-query-factory.test.ts` слова `productWrites` нет,
  test-ы с `kind: 'product'` идут через fake-фабрику. Сценарий: если строку убрать, test-ы зелёные, а Product Session
  молча получает отказ на каждую запись вне своей папки, которую владелец разрешил.

## Что делаем

1. 58: на Windows каждый файл и папка, которые читает тема (`map.md`, `mind-map.json`, `issues/` и файлы в нём),
   проверяются `walkLinks` (`src/main/remote-links.ts:236`) против корня Project-а, как `resolveDocPath`
   (`watch.ts:105-116`); ссылка на удалённый host — файл не читается, тема получает ошибку этого файла. `mind_map_read`
   идёт через ту же проверку.
2. 59, 80: `readAdviceShare` и `readReviews` принимают `paths` и `links` (как `readProductTopic`); ссылка проверяется до
   `readdir`, каждый файл `critic/*.md` — до `readFile`.
3. 79: test-ы на нечитаемый `mind-map.json` и на фильтр `STATUS_WORDS`.
4. 93: test `sdkQueryFactory` с `kind: 'product'`: разрешённая запись вне папки Product Session проходит, неразрешённая —
   нет.

## Готово, когда

- [ ] 58, 78: unit test `test/unit/product-topic.test.ts` (по образцу `test/unit/docs-remote-links.test.ts`, `paths:
      win32` и подменённые `links`) — `map.md`, `mind-map.json` и `issues/` темы ведут на удалённый host: ни один не
      читается, тема называет файл в ошибках. Красный на origin/main.
  - evidence: test-run pass · `vitest run test/unit/product-topic.test.ts` exit 0; 3 new link tests exit 1 on origin/main sources · mac - · 15b8d03a4
  - evidence: test-run pass · `vitest run` of 23 product, mind-map, docs, query-factory and remote-links files exit 0; topic link tests exit 1 on origin/main, unchecked mutant exit 1 · mac - · e6c221a0f
  - evidence: review pass · PR #2216 · - - · 335d015a48fb7e620854558bef06ded1945ee5e1
- [ ] 58: test `test/contract/mind-map-tools.test.ts` — `mind_map_read` темы со ссылкой на удалённый host не читает
      файл. Красный на origin/main.
  - evidence: test-run pass · `vitest run test/contract/mind-map-tools.test.ts` exit 0; 2 new tests exit 1 on origin/main sources · mac - · 15b8d03a4
  - evidence: test-run pass · `vitest run test/contract/mind-map-tools.test.ts` exit 0; read and write link tests exit 1 before the fix, documents-root mutant exit 1, writer-check mutant exit 1 · mac - · e6c221a0f
  - evidence: review pass · PR #2216 · - - · 335d015a48fb7e620854558bef06ded1945ee5e1
- [ ] 59, 80: unit test `test/unit/product-share.test.ts` — папка Product Session и файл `critic/*.md` ведут на
      удалённый host: `readdir` и `readFile` не зовутся, share без них. Красный на origin/main.
  - evidence: test-run pass · `vitest run test/unit/product-share.test.ts` exit 0; 2 new tests exit 1 on origin/main sources · mac - · 15b8d03a4
  - evidence: test-run pass · `vitest run test/unit/product-share.test.ts` exit 0; share link tests exit 1 on origin/main, critic folder mutant exit 1 · mac - · e6c221a0f
  - evidence: review pass · PR #2216 · - - · 335d015a48fb7e620854558bef06ded1945ee5e1
- [ ] 79: unit test `test/unit/product-topic.test.ts` — `mind-map.json` нечитаем (папка вместо файла): ошибка в
      `errors`, карта не пустая; `Status: someword` даёт `none`. Mutant «убрать проверку `'error' in mindMap`» и mutant
      «убрать `STATUS_WORDS.has`» — красные.
  - evidence: test-run pass · `vitest run test/unit/product-topic.test.ts` exit 0; mutant without the mind-map error check exit 1, mutant without STATUS_WORDS.has exit 1 · mac - · 15b8d03a4
  - evidence: test-run pass · `vitest run test/unit/product-topic.test.ts` exit 0; mutant without the mind-map error check exit 1, mutant without STATUS_WORDS.has exit 1 · mac - · e6c221a0f
  - evidence: review pass · PR #2216 · - - · 335d015a48fb7e620854558bef06ded1945ee5e1
- [ ] 93: unit test `test/unit/agent-query-factory.test.ts` в `describe('sdkQueryFactory')` — Session `kind: 'product'`
      получает `productWrites`; mutant «убрать `productWrites` в `query.ts:476`» — красный.
  - evidence: test-run pass · `vitest run test/unit/agent-query-factory.test.ts` exit 0; mutant without productWrites in query.ts exit 1 · mac - · 15b8d03a4
  - evidence: test-run pass · `vitest run test/unit/agent-query-factory.test.ts` exit 0; mutant without productWrites in query.ts exit 1 · mac - · e6c221a0f
  - evidence: review pass · PR #2216 · - - · 335d015a48fb7e620854558bef06ded1945ee5e1
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 15b8d03a4
  - evidence: gate pass · `gate fast` exit 0 · mac - · e6c221a0f
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45646169399/job/139337452625 · ci - · 335d015a48fb7e620854558bef06ded1945ee5e1

## Решено без владельца — подтверждено владельцем 2026-11-26

- 79: «карта не пустая» прочитано как «тема не читается как пустая карта без ошибок»: test требует ошибку
  `mind-map.json` в `errors`; `nodes` остаются пустыми, как и раньше.
- Текст отказа в ошибках темы и в `skipped`: `leads to another host through a link: not read`; ссылка, которую нельзя
  прочитать, — прежний текст `UNCHECKED` из `remote-links.ts`.
- Папка Product Session за ссылкой на другой host: доля принятых советов пустая, без строки в `skipped` (так раньше
  вела себя папка `critic/`); отдельный review за такой ссылкой назван в `skipped`.
- Ссылки при чтении и записи Mind map (`mind_map_*`, `product.layout`) проверяются от корня документов Project-а, как
  экран (`docsSource`: в Silent mode — Workflow folder), в виде как записан и как real path (review round 1 PR #2216).
  Если real path не нашёлся, обход идёт от корня как записан.
- `readTopic` без `allowed` начинает обход от папки темы.
- Абзац о поведении — в `docs/features/product-session.md` и в переводе `docs/features/ru/product-session.md`.

## Где в коде

- `src/main/docs/watch.ts:105-116` (`resolveDocPath`, образец), `:245-261` (`readProductTopic`)
- `src/main/product/topic.ts:62-70` (`readText`), `:100-125` (`STATUS_WORDS`, `readTickets`), `:150-165` (`readTopic`)
- `src/main/ipc/product.ts:35-66` (`readReviews`, `readAdviceShare`)
- `src/main/mcp/mind-map-server.ts:260-270` (`mind_map_read`)
- `src/main/remote-links.ts:236`, `:344` (`walkLinks`, `leadsToRemote`)
- `src/main/vendors/claude/query.ts:470-480`
- `test/unit/product-topic.test.ts`, `test/unit/product-share.test.ts`, `test/unit/docs-remote-links.test.ts`,
  `test/contract/mind-map-tools.test.ts`, `test/unit/agent-query-factory.test.ts:90-110`

## Вне скоупа

- Остальные находки `triage.md`.
- Чтение docs вне Product Session: оно уже идёт через `resolveDocPath`.

# 02 — Строка Stable copy пункта и группа Update first: есть ли изменение в Stable copy владельца

Type: task
Status: claimed 2026-11-23T23:09Z
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 2; «Решения по реализации» → «Stable copy пункта»; «Решения по test-ам», Seam 1
и 2; «Риски», «Commit-а Stable copy нет в checkout-е» и «Лимит gh»

Кто: агент.

Не платформенный Ticket (`src/main/`, `src/shared/`). Глубина ревью — `medium`.

## Что происходит

- После Ticket-а 01 очередь знает пункты и группы, но вход «есть ли изменение в Stable copy» у неё пустой: группы Update
  first нет.
- Update знает commit Stable copy: поле `running` (`src/shared/ipc/update.ts`, схема), когда окно — сама Stable copy, иначе
  файл рядом с копией (`stableCopyPath`, `readStableMetadata`, `src/main/update/stable-copy.ts`).
- Поле `mergeCommit` PR даёт gh (`FIELDS`, `src/main/github/prs.ts`) под учётной записью Project-а (`accountAuth`).
- `gitRunner` (`src/main/workflow/stages.ts`) уже запускает `git merge-base --is-ancestor` для Stage Deploy.
- Номер сборки — `git rev-list --count` (`buildNumber`, `scripts/build-version.ts`), текст — `numberedVersion`
  (`src/shared/version-number.ts`).
- Репозиторий самого worfy узнаётся по `UPDATE_REPO_PAGE` (`src/shared/ipc/update.ts`); у других Project-ов Stable copy
  нет.

## Что делаем

1. `src/main/acceptance/stable-line.ts` (новый): только для Project-а, чей `repoUrl` — репозиторий worfy. Merge commit —
   PR из строки `PR:` Ticket-а, иначе по ветке, как у Stage; спрашивается один раз на влитый PR и хранится в памяти. У
   Ticket-а без своего PR, который ждёт владельца, — merge-и его блокеров.
2. Есть ли изменение: `git merge-base --is-ancestor <merge> <commit Stable copy>` через `gitRunner`. Commit-а нет в
   checkout-е — «Stable copy not checked»; `git fetch` worfy не делает (ADR-0005). Отказ GitHub — тоже «not checked».
3. Версии: «In your Stable copy 0.4.N — the change is there since 0.4.M» или «Not in your Stable copy yet: it runs 0.4.K,
   the change is in 0.4.M». Другие Project-ы — «merged #N» или «not merged».
4. Служба 01 кладёт строку в снимок; пункт, которого нет в Stable copy, уходит в Update first. Update first несёт
   «Update worfy», когда есть Available update, иначе текст «`main` waits for a green CI».
5. merge commit спрашивается только для групп Ready to check и Update first.
6. Английская страница `docs/features/acceptance.md`: раздел «Stable copy».

## Готово, когда

- [ ] Unit test (`test/unit/acceptance-stable-line.test.ts`, новый): текст строки для «есть», «нет», «not checked», для
      Project-а не worfy; номер версии из числа commit-ов. Красный до правки — в «Итог».
  - evidence: test-run pass · `pnpm test test/unit/acceptance-stable-line.test.ts` exit 0 · mac - · 277ad9de81bfb03ca5f17aacdea858b0d98ac661
  - evidence: test-run pass · `pnpm test test/unit/acceptance-stable-line.test.ts test/unit/acceptance-stable-sources.test.ts test/unit/acceptance-service-timers.test.ts` exit 0 · mac - · bcc89692818c6204e8c19c9139d6e832c2dd12af
- [ ] Contract test (`test/contract/acceptance-stable-copy.test.ts`, новый): временный репозиторий и Stable copy через
      `WORFY_UPDATE_STABLE` с `worfy-stable.json`; stand-in `GhRunner` даёт `mergeCommit`; merge — предок → Ready to
      check, не предок → Update first, commit-а нет → «not checked»; второй снимок не спрашивает gh второй раз.
  - evidence: test-run pass · `pnpm test test/contract/acceptance-stable-copy.test.ts` exit 0 · mac - · 277ad9de81bfb03ca5f17aacdea858b0d98ac661
  - evidence: test-run pass · `pnpm test test/contract/acceptance-stable-copy.test.ts test/contract/acceptance-service.test.ts` exit 0 · mac - · bcc89692818c6204e8c19c9139d6e832c2dd12af
- [ ] Английская страница `docs/features/acceptance.md` описывает строку Stable copy и Update first;
      `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 277ad9de81bfb03ca5f17aacdea858b0d98ac661
  - evidence: test-run pass · `pnpm lint` exit 0 (check-feature-docs ok) · mac - · bcc89692818c6204e8c19c9139d6e832c2dd12af
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 277ad9de81bfb03ca5f17aacdea858b0d98ac661
  - evidence: gate pass · `gate fast` exit 0 · mac - · 277ad9de81bfb03ca5f17aacdea858b0d98ac661
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcc89692818c6204e8c19c9139d6e832c2dd12af

## Где в коде

- `src/main/acceptance/stable-line.ts` (новый), `src/main/acceptance/service.ts` (Ticket 01)
- `src/shared/ipc/acceptance.ts` (Ticket 01: поле строки Stable copy)
- `test/unit/acceptance-stable-line.test.ts`, `test/contract/acceptance-stable-copy.test.ts` (новые)
- `docs/features/acceptance.md`

Только читать: `src/main/update/stable-copy.ts`, `src/shared/ipc/update.ts`, `src/main/github/prs.ts`,
`src/main/workflow/stages.ts`, `scripts/build-version.ts`, `src/shared/version-number.ts`.

## Вне скоупа

- Сборка ПК для `needs: windows …` — Ticket 07.
- Кнопка в окне — Ticket 05 рисует то, что даёт снимок.

## Итог

- Строка Stable copy — `src/main/acceptance/stable-line.ts` (`StableLine`): у пункта групп Ready to check и Update first
  поле `stable` снимка (`acceptanceStableSchema`, `src/shared/ipc/acceptance.ts`) — `in`, `out` (пункт в Update first,
  `update`: `available` или `waits-ci`), `not-checked` с причиной; у Project-а не worfy — `merged`/`not-merged`.
- Красный до правки: `pnpm test test/unit/acceptance-stable-line.test.ts test/unit/acceptance-queue.test.ts
  test/contract/acceptance-stable-copy.test.ts` — exit 1 (модуля `stable-line` нет; Update first пустая; у строк нет
  `stable`).
- Решено без владельца: версия `0.4.N` берёт major и minor из `package.json` того commit-а (`git show <sha>:package.json`);
  Update worfy — только когда номер Available update не меньше номера merge (или номер неизвестен); ответ «not checked»
  и «PR ещё не влит» спрашиваются снова через 5 минут, влитой merge commit хранится до конца работы приложения.
- Вне следа: `src/shared/acceptance/queue.ts` (опция `inStable` стала `stable`, строка кладётся в строку пункта) и
  `src/main/ipc/acceptance.ts` (источники строки в приложении: gh PR tracker-а, Available update службы Update).
- Раунд 2 ревью #2158: в shallow clone номера сборки нет (`rev-parse --is-shallow-repository`, как `buildNumber`), строка
  называет commit-ы коротким SHA, а Update worfy решает `merge-base --is-ancestor <merge> <commit Available update>`;
  равные номера — Update worfy; commit Stable copy — `running` службы Update, когда окно — сама Stable copy, иначе файл
  рядом с копией; копия без проверки обновлений (dev-запуск) — `update: no-update-check` с текстом «This copy does not
  check for updates: update from your Stable copy» вместо «`main` waits for a green CI». Решено без владельца: без
  ответа git (commit-а Available update нет в checkout-е) Update worfy не предлагается.

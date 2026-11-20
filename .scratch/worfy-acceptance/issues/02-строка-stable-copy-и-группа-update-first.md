# 02 — Строка Stable copy пункта и группа Update first: есть ли изменение в Stable copy владельца

Type: task
Status: open
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
- [ ] Contract test (`test/contract/acceptance-stable-copy.test.ts`, новый): временный репозиторий и Stable copy через
      `WORFY_UPDATE_STABLE` с `worfy-stable.json`; stand-in `GhRunner` даёт `mergeCommit`; merge — предок → Ready to
      check, не предок → Update first, commit-а нет → «not checked»; второй снимок не спрашивает gh второй раз.
- [ ] Английская страница `docs/features/acceptance.md` описывает строку Stable copy и Update first;
      `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

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

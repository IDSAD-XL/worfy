# 04 — Версия worfy и Harness: `0.2.0+<SHA>` в сборке, копия Harness в `.app`, версия в UI

Type: task
Status: open
Blocked by: 02
Source: решения владельца 2026-10-07 (Q1, Q12); [spec.md](../spec.md); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md); [ADR-0019](../../../docs/adr/0019-harness-claude-code-plugin.md); [ADR-0008](../../../docs/adr/0008-claude-code-native-binary-path.md)

## Что происходит

- У приложения нет версии: `"version": "0.0.0"` (`package.json:3`). Electron отдаёт её как
  `app.getVersion()`; канал `app.version` возвращает её же (`src/main/ipc/app.ts:5`, схема —
  `src/shared/ipc/app.ts:6`). Toolbar показывает `v0.0.0` (`src/renderer/shell/toolbar/AppVersion.tsx:22-23`).
  e2e проверяет только, что подпись видна и целиком лежит в окне (`test/e2e/toolbar.spec.ts:91-100`).
- По Q12 semver приложения поднимается в конце каждого Epic-а: сейчас 0.2.0, после E3 — 0.3.0.
  Версия Harness — та же строка с коротким SHA сборки: `<semver>+<SHA>`. По ней worfy решает,
  переставлять ли plugin (Ticket 13), и её показывает UI.
- `harness/.claude-plugin/plugin.json` заводит Ticket 02, без поля `version`.
- В `.app` Harness-а нет. electron-builder кладёт в `app.asar` только `out/**` и `package.json`
  (`electron-builder.yml:9-11`); вне `app.asar` распакованы только `node-pty` и бинарь SDK
  (`electron-builder.yml:23-25`): файл внутри `app.asar` нельзя запустить (ADR-0008). Установщик
  (Ticket 13, Q1) копирует `harness/` своей версии из `.app` в `~/.claude/worfy-harness/plugin/`.
- `scripts/install-stable.sh` пишет коммит и признак незакоммиченных изменений рядом с копией, а
  не внутрь `.app` — запись внутрь сломала бы подпись (`scripts/install-stable.sh:68`, `:70`).
- `test/e2e/packaged.spec.ts` (`@packaged`) уже проверяет файлы в `Contents/Resources` (иконка,
  `:172`) и распакованный бинарь SDK (`:237-243`).

## Что делаем

1. **Версия приложения** (Q12). `package.json` — `0.2.0`. Подъём до 0.3.0 в конце E3 — не этот
   Ticket.
2. **Строка версии сборки** (Q12). Новый helper `scripts/build-version.ts`: `<version из
   package.json>+<короткий SHA HEAD>`. Если в дереве есть незакоммиченные изменения (как их считает
   `scripts/install-stable.sh:70`: `git status --porcelain` не пуст) — в конец добавляется `.dirty`:
   такая сборка не совпадает с коммитом. semver допускает точку в build metadata. Вне
   git-репозитория сборка падает с понятной ошибкой: версия без SHA не различает сборки.
3. **Копия Harness с версией.** Сборка (`electron-vite build`, то есть `pnpm build`, `pnpm test:e2e`,
   `pnpm package` и `pnpm dev`) копирует `harness/` в `out/harness/`, без `bin/tests/` и
   `hooks/tests/`, с правами на исполнение. В `out/harness/.claude-plugin/plugin.json` она пишет
   `version` — строку пункта 2. Исходный `harness/.claude-plugin/plugin.json` сборка не меняет:
   после сборки `git status` чистый. Это и есть «сборка пишет `<semver>+<SHA>` в
   `harness/.claude-plugin/plugin.json`» из Q12 — в копию, которая едет в `.app`.
4. **Harness в `.app`.** electron-builder кладёт `out/harness/` в
   `worfy.app/Contents/Resources/harness/` (`extraResources`), вне `app.asar`: скрипты Harness
   запускаются, а из `app.asar` запустить файл нельзя (ADR-0008). В `app.asar` копия не
   дублируется: `out/harness/**` исключается из `files`.
5. **main знает свою копию.** Новый `src/main/harness/bundled.ts`: путь копии Harness этой сборки
   — `<process.resourcesPath>/harness` в собранном приложении, иначе `out/harness/` рядом с
   собранным main (`out/main/`) — и её `version` из `plugin.json`. Путь отсюда берут Ticket-ы 12
   (Session-ы worfy получают plugin своей версии inline) и 13 (установщик).
6. **Версия в UI.** `app.version` отвечает `version` копии Harness, то есть строкой сборки. Нет
   копии или поля (unit-test-ы, `pnpm dev` до первой сборки) — `app.getVersion()`, как сейчас.
   Toolbar показывает `v0.2.0+<SHA>`; `AppVersion.tsx` не меняется. Подпись длиннее прежней:
   проверка toolbar в e2e (всё целиком и в окне) должна держаться.

**Не входит:** установка и обновление plugin-а по смене строки, состояние установленного Harness в
UI (Ticket 13); минимальная версия Claude Code (Q20, Ticket 19).

## Готово, когда

- [ ] `node -p "require('./package.json').version"` печатает `0.2.0`.
- [ ] Unit `test/unit/build-version.test.ts`: `0.2.0` и `abc1234` дают `0.2.0+abc1234`; дерево с изменениями — `0.2.0+abc1234.dirty`; строка совпадает с `^\d+\.\d+\.\d+\+[0-9a-f]{7,}(\.dirty)?$`; вне git — ошибка.
- [ ] После `pnpm build`: `node -p "require('./out/harness/.claude-plugin/plugin.json').version"` равна строке helper-а для текущего дерева; `git diff --quiet -- harness` — exit 0; в `out/harness/` нет `bin/tests/` и `hooks/tests/`; `test -x out/harness/bin/profile` — exit 0.
- [ ] Contract test `test/contract/main-ipc-wiring.test.ts`: `app.version` отвечает `version` копии Harness, когда она есть, и `app.getVersion()`, когда копии нет.
- [ ] e2e `test/e2e/toolbar.spec.ts`: текст `app-version` совпадает с `^v0\.2\.0\+[0-9a-f]{7,}(\.dirty)?$`; проверка «всё целиком и в окне» проходит.
- [ ] e2e `test/e2e/packaged.spec.ts` (`@packaged`): `Contents/Resources/harness/.claude-plugin/plugin.json` есть, его `version` равна тексту `app-version` без `v`; скрипты `Contents/Resources/harness/bin/*` исполняемые; в списке файлов `app.asar` нет `out/harness/`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный; перед мержем `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` (с `test:e2e` и `test:package`) под замком e2e — exit 0 и «[gate] зелено».

## Тесты

Сначала падающий test — `test/contract/main-ipc-wiring.test.ts`: при копии Harness с `version`
`0.2.0+abc1234` в фикстуре `app.version` должен ответить ею. На нынешнем main он отвечает
`app.getVersion()` (`1.2.3` в подмене, `:33`) — test красный. В «Итог» — как он падал.

- `test/unit/build-version.test.ts` — новый: строка версии, `.dirty`, вне git.
- `test/contract/main-ipc-wiring.test.ts` — `app.version` с копией и без.
- `test/e2e/toolbar.spec.ts` — текст подписи версии.
- `test/e2e/packaged.spec.ts` — копия Harness в `Contents/Resources`, версия, права, нет в `app.asar`.

## Где в коде

- `package.json`
- `scripts/build-version.ts` (новый) — строка `<semver>+<SHA>[.dirty]`
- `electron.vite.config.ts` — копия `harness/` в `out/harness/` с версией в `plugin.json`
- `electron-builder.yml` — `extraResources`, `out/harness/**` вне `app.asar`
- `src/main/harness/bundled.ts` (новый) — путь копии Harness сборки и её версия
- `src/main/ipc/app.ts`
- `src/shared/ipc/app.ts` — комментарий к `appVersion`: что за строка
- `test/unit/build-version.test.ts` (новый)
- `test/contract/main-ipc-wiring.test.ts`
- `test/e2e/toolbar.spec.ts`
- `test/e2e/packaged.spec.ts`

Не меняются: `harness/` (в том числе `harness/.claude-plugin/plugin.json`),
`src/renderer/shell/toolbar/AppVersion.tsx`, `scripts/install-stable.sh`. Ticket-ы 05–08 той же
Wave по плану правят только `harness/` — общих файлов нет.

## Итог

Заполняется при закрытии.

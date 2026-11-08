# 74 — CI берёт binary Electron из `actions/cache`, а не из GitHub releases

Type: task
Status: claimed 2026-11-08T10:22Z
Branch: worfy-polish/74
Blocked by: —
Source: решение владельца 2026-11-08 (Q8): с утра GitHub releases отвечает HTTP 504 на zip Electron, и CI красный
до первого test-а. Строки перечитаны по main `ac77622d4`.

## Что происходит

Electron 44 скачивает свой binary не при `pnpm install`, а при первом `require('electron')`
(`node_modules/electron/index.js` → `install.js` → `@electron/get`). Значит, каждый job CI, которому нужен Electron,
сам идёт за `electron-v44.10.2-<os>-<arch>.zip` в GitHub releases: shard-ы `linux-tests`, `macos-tests`, `macos-e2e`,
`macos-package`, `windows-e2e` в `.github/workflows/ci.yml` и оба job-а `.github/workflows/windows-tests.yml`
(`listed-tests`, `full-suite`). С утра 2026-11-08 releases отвечает 504, и job падает до любого test-а:
«HTTPError: Response code 504 … electron-v44.10.2-darwin-arm64.zip», затем «electron.launch: Electron failed to install
correctly». Кэша между run-ами нет: `actions/setup-node` с `cache: pnpm` хранит только store pnpm, а binary лежит в
`node_modules/electron/dist`, которого в store нет.

Где `@electron/get` 5.1.0 (зависимость `electron` 44.10.2) держит скачанный zip: `cacheRoot` из
`process.env.electron_config_cache` (`node_modules/electron/install.js`), без него — `env-paths('electron').cache`:
`~/.cache/electron` (или `$XDG_CACHE_HOME/electron`) на Linux, `~/Library/Caches/electron` на macOS,
`%LOCALAPPDATA%\electron\Cache` на Windows. Внутри — папка `<sha256 адреса>/electron-v<version>-<os>-<arch>.zip`. На
попадании в кэш zip сверяется с `checksums.json` пакета `electron`, без сети. Переменную `ELECTRON_CACHE` ни `install.js`,
ни `@electron/get` 5.1.0 не читают.

## Что делаем

1. В каждом job-е, которому нужен Electron, сразу после `pnpm install --frozen-lockfile` — одни и те же четыре step-а:
   - `Read the Electron version` (id `electron`): версия из `node_modules/electron/package.json`, то есть ровно та, что
     записана в lockfile, — в output `version`;
   - `Restore the Electron download` (id `electron-cache`, `actions/cache/restore`): папка
     `${{ runner.temp }}/electron-cache`, key `electron-<runner.os>-<runner.arch>-<version>`;
   - `Download the Electron binary`: `node -e "require('electron')"` с `electron_config_cache` на эту папку; на тёплом
     кэше zip берётся из неё, и GitHub releases не спрашивают;
   - `Save the Electron download` (`actions/cache/save`): только при промахе (`cache-hit != 'true'`), сразу после
     скачивания, а не в конце job-а, — кэш пополняется, даже если test-ы потом упадут.
   Холодный кэш скачивает zip, как раньше. Shared composite action-а в репозитории нет (`.github/actions/` не
   заведена), поэтому step-ы повторены в каждом job-е, а одинаковость их проверяет contract test.
2. `macos-package` уже скачивал binary отдельным step-ом — этот step становится частью тех же четырёх.
3. `lint-typecheck` и `changes` Electron не запускают — их не трогаем.
4. Test-ы: `test/contract/ci-workflow.test.ts` — каждый job, который запускает `pnpm test`, `pnpm test:e2e` или
   `pnpm test:package`, несёт эти четыре step-а сразу после install, слово в слово одинаковые, и ни в одном `run` нет
   `${{`; `test/contract/windows-tests-workflow.test.ts` — новые step-ы в списках step-ов, команд, `if:` и выражений
   обоих job-ов. Пределы (timeout-ы, 10 и 60 минут) не меняются.

Ограничения: только бесплатные стандартные runner-ы; никакого `pull_request_target` и secrets; timeout-ы test-ов и
job-ов не меняются; ручных повторов CI нет.

Кэш PR-а виден только этому PR-у; кэш `main` виден всем PR-ам. Push в `main` запускает все job-ы и наполняет кэш для
Linux X64, macOS ARM64 и Windows X64, так что после merge PR-ы берут binary из кэша `main`.

Глубина review — `medium`. **Платформенный**: меняется CI, вердикт — job-ы Windows в CI.

## Готово, когда

- [ ] В каждом job-е CI с Electron (`linux-tests`, `macos-tests`, `macos-e2e`, `macos-package`, `windows-e2e`,
  `listed-tests`, `full-suite`) после install стоят одни и те же четыре step-а кэша Electron; key — ОС, arch и версия
  Electron из lockfile.
- [ ] Тёплый кэш не идёт в сеть: локально, с zip в папке `electron_config_cache` и недоступным `ELECTRON_MIRROR`,
  `node -e "require('electron')"` — exit 0, «Cache hit» в `DEBUG=@electron/get*`; с пустой папкой — ошибка скачивания.
- [ ] `test/contract/ci-workflow.test.ts`, `test/contract/windows-tests-workflow.test.ts`, `actionlint` (если есть),
  `check-cyrillic`, lint, typecheck, gate fast — exit 0.
- [ ] `ci-ok` зелёный на head PR, job-ы Windows в нём зелёные.

## Тесты

- `node scripts/vitest-electron.mjs test/contract/ci-workflow.test.ts test/contract/windows-tests-workflow.test.ts
  test/contract/ci-scope-e2e.test.ts`.
- Второй run того же head PR: в step-е `Restore the Electron download` — «Cache restored from key: electron-…», в step-е
  `Download the Electron binary` нет строки «Downloading Electron binary...», step `Save the Electron download` пропущен.

## Где в коде

- `.github/workflows/ci.yml` — job-ы `linux-tests`, `macos-tests`, `macos-e2e`, `macos-package`, `windows-e2e`;
  комментарий в начале файла.
- `.github/workflows/windows-tests.yml` — job-ы `listed-tests`, `full-suite`.
- `test/contract/ci-workflow.test.ts` — команды job-ов и одинаковые step-ы кэша Electron.
- `test/contract/windows-tests-workflow.test.ts` — step-ы, команды, `if:` и выражения обоих job-ов.
- `node_modules/electron/install.js`, `@electron/get` (`dist/Cache.js`, `dist/index.js`) — только читаются.

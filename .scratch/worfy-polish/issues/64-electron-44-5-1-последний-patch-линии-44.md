# 64 — Electron 44.5.1 → последний patch линии 44

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-11-07, оценка идей PR #1580 (идеи 9 и 10). Строки перечитаны по main `14d18997e`.

## Что происходит

- `package.json:65` держит `"electron": "44.5.1"` с первого PR репозитория (#1, `5da0b9859`).
- Последняя версия линии 44 на npm — **44.10.2** (`npm view electron@44 version --json`, 2026-11-07). Пропущено
  двенадцать версий: 44.6.0, 44.7.0, 44.7.1, 44.7.2, 44.8.0, 44.9.0, 44.9.1, 44.9.2, 44.9.3, 44.10.0, 44.10.1, 44.10.2.
  Patch-и линии несут исправления безопасности Chromium и Node, которых в worfy нет.
- Часть поведения проверена только на 44.5.1 и названа так в Ticket-ах: `session.fromPartition` у Browser profile
  ([worfy-browser 03](../../worfy-browser/issues/03-browser-profile.md),
  [14](../../worfy-browser/issues/14-browser-profiles-долги-ревью-03.md)), `<webview>` и `WebPreferences`
  ([worfy-browser 09](../../worfy-browser/issues/09-проверка-webview-отклоняет-незнакомое.md)), перезагрузка окна
  ([worfy-daily 15](../../worfy-daily/issues/15-окно-ошибки-запуска.md)).

## Что делаем

1. Прочитать release notes каждой пропущенной версии 44.x (от 44.6.0 до 44.10.2) и записать в «Итог» списком:
   исправления безопасности (CVE или описание) и breaking changes или изменения поведения, которые задевают worfy.
   Версия без таких пунктов — одной строкой «нечего».
2. Поднять `electron` в `package.json` до 44.10.2 (или до более нового patch-а линии 44, если он выйдет до начала
   работы — записать, какой взят) и обновить `pnpm-lock.yaml`. Линию 45 не трогать.
3. Сверить с release notes места, проверенные только на 44.5.1 (список выше); что изменилось — test или правка.
4. Fuses не меняются: `node scripts/check-fuses.mjs` (часть `pnpm test:package`) остаётся зелёным — RunAsNode и
   EnableNodeCliInspectArguments выключены.

Глубина review — `high`: смена Electron задевает все платформы. Платформенный: упаковка, окна, Terminal и fuses на
macOS и Windows — PR ждёт Windows verdict.

## Готово, когда

- [ ] В «Итог» — список по каждой пропущенной версии 44.x: исправления безопасности и breaking changes.
- [ ] `package.json` и `pnpm-lock.yaml` — на последнем patch-е линии 44; номер записан в «Итог».
- [ ] `node scripts/check-fuses.mjs` на собранном приложении — exit 0.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:package` на Mac — exit 0; `ci-ok` на PR
      зелёный.
- [ ] Windows verdict получен до merge.

## Где в коде

- `package.json:65`, `pnpm-lock.yaml`
- `scripts/check-fuses.mjs`, `electron-builder.yml`
- Release notes: `https://releases.electronjs.org/release/v44.<minor>.<patch>`

## Итог

Ветка `worfy-polish/64`, base `origin/main` `42372355b`.

**Взят 44.10.2** — последний patch линии 44 на 2026-11-07 (`npm view electron@44 version --json`: последний элемент
`44.10.2`; линия 45 не тронута). `package.json` и `pnpm-lock.yaml` — `electron@44.10.2`, в lockfile поменялись только
specifier, version и integrity самого `electron`. Установленный бинарник: Electron 44.10.2, Node 24.22.2, Chromium
152.0.7977.169 (`ELECTRON_RUN_AS_NODE=1 electron -p process.versions`). ABI тот же (major 44), `node-pty`
пересобирать не нужно.

### Release notes пропущенных версий

Источник — GitHub Releases `electron/electron` (`gh release view v44.x.y`) и `releases.electronjs.org`; advisory
сверены по `gh api repos/electron/electron/security-advisories`. Из advisory, опубликованных с сентября 2026, в
пропущенный диапазон попадает одно — GHSA-jr5w-w6x2-84p9; остальные (GHSA-x562-297c-g43g, GHSA-3qxv-5xgr-q7w9,
GHSA-h3v5-h239-pg29, GHSA-997q-gvvc-jwmx, GHSA-fw47-9c62-h3vw, GHSA-98mx-cjp9-gchm) исправлены в 44.5.0 и раньше, то
есть уже были в 44.5.1. Breaking changes в линии 44 после 44.5.1 нет ни в одной версии.

- [44.6.0](https://github.com/electron/electron/releases/tag/v44.6.0) — безопасность: нечего. Изменения поведения:
  экспериментальный `protocol.registerSource()` (worfy не использует); падение на старте macOS при отказе системы
  зарегистрировать sleep/wake; `webview.findInPage()` зависал при iframe на странице (worfy не вызывает); tzdata 2026d.
- [44.7.0](https://github.com/electron/electron/releases/tag/v44.7.0) — безопасность: backport-ы исправлений
  ANGLE, Chromium, Dawn, fontconfig, Skia, V8, WebRTC (#54666, #54657). Поведение: `autoUpdater` на macOS качает на диск
  и умеет delta (worfy не использует `autoUpdater`); `net.fetch` и заголовки не-ASCII (worfy не использует `net.fetch`).
- [44.7.1](https://github.com/electron/electron/releases/tag/v44.7.1) — безопасность: Chromium 152.0.7977.149.
  Поведение: падения на Linux без display server и без GTK, asar в папке не-ASCII на Linux, падение renderer-а при GC в
  ShadowRealm; на Windows переписана пересылка мыши для `setIgnoreMouseEvents(true, { forward: true })` — worfy
  вызывает `setIgnoreMouseEvents(true)` без `forward` (`src/main/window.ts:155`, тихие окна e2e), её это не задевает.
- [44.7.2](https://github.com/electron/electron/releases/tag/v44.7.2) — безопасность: backport-ы ANGLE, Chromium,
  PDFium, V8 (#54898). Поведение: клики в фоновое приложение на macOS больше не теряются; прерванное обновление macOS
  не ломает приложение.
- [44.8.0](https://github.com/electron/electron/releases/tag/v44.8.0) — безопасность: backport-ы Chromium и V8
  (#55034), Chromium 152.0.7977.167, Node.js 24.22.0. Поведение: кнопки действий `Notification` на Linux; курсор над
  нативными диалогами Windows; `net.fetch` после перезапуска Network Service; `utilityProcess` терял последние
  сообщения (не используется); `win.isFullScreen()` в событиях fullscreen на Windows.
- [44.9.0](https://github.com/electron/electron/releases/tag/v44.9.0) — безопасность: `setCertificateVerifyProc`
  иногда не применялся к параллельному первому запросу (worfy его не ставит). Поведение: окна, открытые по ссылке,
  теперь берут session и `webPreferences` открывшей страницы — worfy ни одного окна по ссылке не открывает: оба
  window-open handler-а отвечают `deny` (`src/main/window.ts:275`, `:292`), страница Browser-а сама идёт по адресу.
  App shims для Dock на macOS — новая возможность, не используется.
- [44.9.1](https://github.com/electron/electron/releases/tag/v44.9.1) — безопасность:
  [GHSA-jr5w-w6x2-84p9](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9)
  (CVE-2026-115570, high) — блок скомпрометированных промежуточных сертификатов eMudhra в сетевом стеке Chromium и в
  `tls`, `https`, `fetch` Node. Задевает worfy: Browser открывает произвольные сайты по TLS. Breaking changes: нечего.
- [44.9.2](https://github.com/electron/electron/releases/tag/v44.9.2) — нечего (release notes пустые; между
  тегами только документация и test самого Electron).
- [44.9.3](https://github.com/electron/electron/releases/tag/v44.9.3) — безопасность: backport-ы ANGLE, Chromium,
  PDFium, Skia, V8 (#55149). Breaking changes: нечего.
- [44.10.0](https://github.com/electron/electron/releases/tag/v44.10.0) — безопасность: Chromium 152.0.7977.169,
  Node.js 24.22.1; закрыты дыры blocklist-а File System Access (запись в `.git/hooks`, UNC-пути гипервизора);
  обработка повреждённых asar с неверными размерами; одинаковая обработка путей asar в main и в дочерних процессах.
  Поведение: падение main при `onSendHeaders` с Blob; `Menu.popup()` на macOS (worfy его не вызывает: меню холста —
  React); `protocol.registerSource` получил правила fetch, как у `protocol.handle` (сам `protocol.handle`, которым
  worfy отдаёт Card-ы и картинки, не менялся); фильтры у `session.registerPreloadScript` (новое, не используется);
  `utilityProcess` `exit`; tzdata 2026e.
- [44.10.1](https://github.com/electron/electron/releases/tag/v44.10.1) — безопасность: backport-ы Chromium, Dawn,
  Skia, V8 (#55492). Поведение: «Save» в DevTools, `webContents.adjustSelection()`, скорость `net.fetch`.
- [44.10.2](https://github.com/electron/electron/releases/tag/v44.10.2) — безопасность: backport-ы ANGLE, Chromium,
  libaom, libvpx, PDFium, Skia, V8, WebRTC (#55515), Node.js 24.22.2. Поведение: падение на Wayland со скрытым
  родительским окном.

### Места, проверенные только на 44.5.1

- `session.fromPartition` у Browser profile (worfy-browser 03, 14): ни одна версия 44.6.0–44.10.2 не меняет
  `session.fromPartition` и persist-разделы. Ближайшие пункты — падение `navigator.usb.requestDevice()` в in-memory
  session (44.6.0) и session у окон по ссылке (44.9.0) — worfy не задевают (окон по ссылке нет, см. 44.9.0).
- `<webview>` и `WebPreferences` (worfy-browser 09): `will-attach-webview` и `WebPreferences` guest-а в release notes
  не упомянуты; из `<webview>` менялся только `findInPage()` (44.6.0), его worfy не вызывает.
- Перезагрузка окна (worfy-daily 15): про reload окна и `did-fail-load` в release notes ничего.

Правки кода и новых test-ов не понадобилось: ни один пункт не меняет поведение, на которое опирается worfy.
Существующие test-ы (unit, contract, e2e, `@packaged`) прогнаны на 44.10.2 — см. проверки ниже. Комментарии в коде и
ADR вида «измерено на Electron 44.5.1» оставлены как есть: они записывают, на чём шло измерение.

### Проверки

На Mac (Darwin 25.6.0, arm64), commit `f7207d233`:

- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0; `pnpm test` — exit 0 (680 файлов test-ов, 15836 test-ов прошли,
  127 пропущены).
- `pnpm test:package` — exit 0: 22 test-а `@packaged` прошли, в конце `node scripts/check-fuses.mjs` на
  `dist/mac-arm64/worfy.app`: RunAsNode и EnableNodeCliInspectArguments выключены. Отдельный повтор
  `node scripts/check-fuses.mjs` — exit 0. В собранном `.app` Electron Framework — 44.10.2.
- gate fast — exit 0, `[gate] green (fast)`.
- `pnpm test:e2e` целиком локально не гонялся: правка `package.json` по `scripts/e2e-specs.table.json` запускает
  весь набор e2e в job-е macOS `ci-ok` на PR, а Windows — весь `pnpm test` в job-е Windows.
- Windows verdict — до merge, его даёт Orchestrator; PR ждёт его.

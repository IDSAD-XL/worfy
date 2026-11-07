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

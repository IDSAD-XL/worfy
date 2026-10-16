# 31 — Системные уведомления приходят с иконкой Electron вместо знака worfy

Type: task
Status: open
Blocked by: —
Source: замечание владельца 2026-10-17 («вылазит дефолт иконка электрона, а должна ворфи»), во время
grilling-а о Pipeline; [worfy-daily 31](../../worfy-daily/issues/31-иконка-приложения.md), «Итог».

## Что происходит

- На macOS иконка слева в уведомлении — иконка bundle-а, который его показал. `Notification` в
  `src/main/notify.ts` (`new Notification`, около `:287`) своей иконки не задаёт, и это верно: опция
  `icon` добавила бы вторую картинку справа, а не заменила бы левую (worfy-daily 31, «Итог»).
- Stable copy (`~/Applications/worfy-stable.app`): `CFBundleIdentifier` = `dev.worfy.app`,
  `CFBundleIconFile` = `icon.icns`, файл на месте (проверено 2026-10-17). Её уведомления должны
  идти со знаком worfy.
- Dev-сборка и e2e запускают `node_modules/electron/dist/Electron.app` (`com.github.Electron`,
  `electron.icns`): их уведомления идут с иконкой Electron. worfy-daily 31 оставил это как есть.
- Какой процесс показал уведомление, которое видел владелец, не установлено. Кандидаты: dev-сборка
  или e2e-прогон агента (Autopilot гоняет e2e во время Wave), либо Stable copy со старой иконкой в
  кэше Notification Center (иконка в Stable copy появилась позже, чем первые уведомления от
  `dev.worfy.app`).

## Что делаем

1. Установить источник: по журналу Notification Center или повтором — уведомление от Stable copy и
   от `pnpm dev`, снимок каждого. Записать в «Итог», какой bundle показал иконку Electron.
2. Stable copy с иконкой Electron — найти и устранить причину (кэш иконок, порядок установки,
   `lsregister`), без ручных шагов у пользователя после `pnpm install:stable`.
3. Dev-сборка и e2e: уведомления не должны выглядеть как от «Electron». Варианты — свой bundle
   для dev с именем и иконкой worfy (например, копия Electron.app с заменёнными `Info.plist` и icns
   в `node_modules/.cache`), или e2e без системных уведомлений. Выбор и причина — в «Итог».

## Готово, когда

- [ ] Уведомление Stable copy — со знаком worfy: снимок в `evidence/31-*.png`.
- [ ] Уведомление `pnpm dev` — со знаком worfy и именем worfy, или в «Итог» названа причина, почему нет.
- [ ] e2e-прогон не показывает системных уведомлений с иконкой Electron.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Linux CI зелёный.

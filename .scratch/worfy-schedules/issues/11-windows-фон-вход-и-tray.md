# 11: Windows — работа в фоне, запуск при входе и значок в tray

Type: task
Status: open
Blocked by: 05
Source: [spec.md](../spec.md), «Ticket-ы», 11; «Решения по реализации» («Windows»); решения владельца Q11 grilling-а и
Q5 spec-а; «Волны», Wave 6

Кто: агент. Глубина ревью — `medium`. Платформенный PR (ADR-0056, пункт 2; окно и автозапуск Windows): вердикт
Windows — Windows CI job на head PR (ADR-0071, ADR-0086), ручной пункт — на ПК.

## Что происходит

- На Windows закрытое окно завершает worfy: `window-all-closed` → `app.quit()` (`src/main/index.ts:348`). Scheduled run
  там не пойдёт.
- Login item и tray в `src` нет. Повторный запуск открывает окно (`requestSingleInstanceLock`, `src/main/index.ts:96`).
- Q11: «работать в фоне» и «запускать при входе», обе выключены. Q5 spec-а: в фоне — значок в tray с «Open worfy» и
  «Quit».

## Что строить

- Settings → General, только на Windows: «Keep worfy running in the background while schedules are active» и «Start
  worfy when I sign in» (`app.setLoginItemSettings`), обе выключены по умолчанию.
- Пока первая включена и есть Active Schedule, `window-all-closed` не завершает worfy; в tray значок с пунктами «Open
  worfy» и «Quit». Окно открыто или Active Schedules нет — значка нет.
- Вторая стартует worfy без окна, если включена первая, иначе — с окном. Выключение снимает login item.
- На macOS ничего не меняется.

## Где в коде

- `src/main/index.ts` (`window-all-closed`), `src/main/schedules/tray.ts` (новый, имя — предложение)
- `src/renderer/settings/GeneralSection.tsx`
- `test/unit/schedule-windows-background.test.ts` (новый, имя — предложение)

## Test-ы

- Unit: решение «завершать ли worfy» по платформе, настройке и Active Schedules; login item по настройкам; пункты tray.
- Сначала падающий test.

## Готово, когда

- [ ] На Windows обе настройки есть и выключены по умолчанию; в фоне закрытое окно не завершает worfy, в tray — «Open
      worfy» и «Quit».
- [ ] Платформенный PR: Windows CI job зелёный на head PR.
- [ ] (вручную) На ПК: включи фон, закрой окно при Active Schedule → worfy в tray; «Open worfy» открывает окно, «Quit»
      завершает; при выключенном фоне закрытое окно завершает worfy, как раньше.
  - needs: windows stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

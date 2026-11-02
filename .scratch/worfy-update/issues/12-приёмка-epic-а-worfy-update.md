# 12 — Приёмка Epic-а worfy-update с владельцем: Mac и Windows-ПК

Type: task
Status: done 2026-11-02T04:09Z
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13
Source: «Готово, когда» Epic-а worfy-update ([spec.md](../spec.md)); решения владельца 2026-10-31, пункты 1–11; [ADR-0089](../../../docs/adr/0089-update-builds-main-in-own-clone.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенная часть — на Windows-ПК владельца)

## Что происходит

- К claim Ticket-ы 01–11 влиты. Их test-ы не ходили на настоящий GitHub и не меняли настоящую Stable copy
  (соглашения spec-а): API — заглушка, сборка — подменная команда, копия — во временной папке.
- Настоящий Update требует, чтобы на `main` был commit новее Stable copy с зелёным `ci-ok`, который меняет
  приложение. Первую копию с Update ставит `pnpm install:stable`, следующий влитый PR с кодом и есть
  Available update.
- Сборка в clone занимает 2–3 GB и минуты; первая — дольше (clone и все зависимости).
- Приёмка — не в Autopilot: её ведёт владелец вместе с Orchestrator-ом. Autopilot над worfy во время
  приёмки остановлен.

## Что делаем

1. Stable copy из `origin/main` с влитыми 01–11 (`pnpm install:stable`) на Mac и на ПК, Harness обновлён
   из неё.
2. Дождаться следующего влитого PR с кодом и зелёного `ci-ok` на `main` (или влить маленький PR приёмки).
3. **Mac** — владелец проходит пункты ниже, Orchestrator ведёт записи и снимки в `../evidence/12-*.png`.
4. **Windows-ПК владельца** — те же пункты; вердикт gate full на ПК на коммите приёмки.
5. Найденный дефект — новый Ticket Epic-а, номер дописывается в `Blocked by` этого.
6. Риски 1 и 3 spec-а: записать время первой и повторной сборки и место `update/` на обеих машинах.
7. Отмечает пункты «Готово, когда» в `spec.md` со ссылкой на «Итог».

Не входит: новые функции.

## Готово, когда

**Mac.**

- [ ] (вручную) При старте Stable copy: точка на version chip-е, Settings → Health — красная строка
      «worfy version»; без сети (Wi-Fi выключен) — ни ошибок, ни toast-ов.
- [ ] (вручную) «Update automatically» включено: сборка идёт в фоне (подсказка «Building…»), потом toast
      «worfy <version> ready · Restart now · Later». В `~/Library/Application Support/worfy/update/` —
      `repo/` и `build.log`.
- [ ] (вручную) Session в ходе — в toast-е «Restart when idle»; после нажатия и конца хода worfy
      перезапустился сам.
- [x] (вручную) После перезапуска: новая версия в chip-е, toast «worfy updated to…», Harness новой копии
      поставлен без диалога (`claude plugin list`), новая Session видит его.
      Покрыто обновлением из приложения 2026-11-02 03:39Z: Stable и Harness стали c22e29d0; toast и новую Session отдельно не записывали.
- [ ] (вручную) `~/Applications/worfy-stable.previous` есть; Settings → General → Updates «Roll back to
      previous version» — подтверждение, перезапуск, прежняя версия; автоматический Update молчит;
      «Check now» снова показывает новую.
- [ ] (вручную) «What's new» — заголовки PR между двумя версиями.
- [ ] (вручную) Сбой сборки (например, `pnpm` убран из `PATH` запуска): «Update failed · Show log»,
      строка Health называет `pnpm`, Stable copy работает прежняя.
- [ ] (вручную) Отстаёт только Harness (поставить Harness старше руками): акцентная кнопка Harness с
      точкой, toast «Harness out of date», «Update Harness» с диалогом согласия.
- [ ] (вручную) dev-сборка (`pnpm dev`): нет точки, нет блока «Updates», нет команды «Update worfy».

Остальные пункты Mac отдельно не проходились: владелец принял приёмку 2026-11-02 по обновлению из приложения, без них. Не проверено: пункты выше без отметки.

**Windows-ПК владельца.**

- [ ] (вручную) Те же пункты: сборка в `%APPDATA%\worfy\update\`, замена `%LOCALAPPDATA%\worfy-stable`,
      `worfy-stable.previous` рядом, откат, Harness после Update.
      Не проверено: владелец принял без Windows-части.
- [ ] gate full на ПК на коммите приёмки — код 0 и строка `[gate] green (full)`.
      Не проверено: владелец принял без Windows-части.

**Записи.**

- [ ] «Итог» (не записано: время сборок и размер `update/` не измеряли): на каждой машине — время первой и повторной сборки, размер `update/`, что владелец попросил
      поменять в текстах.
- [x] Пункты «Готово, когда» Epic-а отмечены в `spec.md`: в `spec.md` списка с отметками нет, отмечать нечего.

## Тесты

- Новых test-ов нет: проверки — вручную и gate full. Найденный дефект получает test в своём Ticket-е.

## Где в коде

- `.scratch/worfy-update/spec.md` — отметки «Готово, когда»
- `.scratch/worfy-update/evidence/` (новая) — снимки

## Итог

Принят владельцем 2026-11-02 на Mac: обновление из приложения 2026-11-02 03:39Z собрало и поставило c22e29d0 (в log сборки шаг `node node_modules/electron/install.js` — докачка из Ticket-а 15 сработала, «Ready.»), Harness обновился до c22e29d0. Ранее, 2026-11-01 14:44Z, сборка из версии без Ticket-а 15 упала на `electronDist`; исправлено в 15. Windows-часть не проводилась: владелец принял без неё.

Промежуточные записи:

- 2026-11-01, Windows-ПК, Update из приложения со Stable `a03f5f63` на `e7fbac67` (по данным bridge-сессии ПК).
  - Попытка 1 упала на `pnpm package`: `The specified electronDist does not exist` (`%APPDATA%\worfy\update\repo\node_modules\electron\dist`). В папке обновления не была докачана загрузка Electron. `pnpm install --frozen-lockfile` её не повторяет, а сборка Update, в отличие от `install-stable`, наличие Electron не проверяет. Это bug, worfy-update 15.
  - Папку починили вручную по слову владельца: `node node_modules/electron/install.js`.
  - Попытка 2 прошла, владелец: «Прошло». Stable `0.3.0+e7fbac67`, `lastRestart.ok=true` в 22:20:49Z, главное окно открыто.
  - Остальные ручные пункты на ПК (откат, Harness после Update, тексты) и время и размер сборки не записаны. gate full на `e7fbac67` не шёл.

# 03 — Browser profile: создать и удалить, `persist:` partition, список origin-ов, флажок «доступен Autopilot»

Type: task
Status: open
Blocked by: 02, 10, 11
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 5
(Browser profile — у Project-а, на Machine; вход и создание — только пользователь; список origin-ов;
один Browser profile — в нескольких Browser-ах), пункт 3 (`partition="persist:…"`), пункт 10 (флажок
«доступен Autopilot»); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) (состояние worfy —
на Machine, не в репозитории). Термин Browser profile — `CONTEXT.md`. Код перечитан по main `dd6b0afb`.

## Что происходит

- Данные Project-а на Machine лежат в его папке: `ProjectStore.dataDir(id)`
  (`src/main/projects/store.ts:130`); так её берёт Layout (`src/main/layout/store.ts:400`).
- После Ticket-а 02 Browser открывается на одном partition-е (вопрос 1 Ticket-а 02), а
  `src/main/browser/attach-policy.ts` сверяет partition со списком.
- Каналы IPC объявляются с доступом и видом `read` или `write`
  (`src/shared/ipc/channels.ts:52`); всё, что не `read`, read-only экрану Linked machine закрыто
  (ADR-0066).

## Что делаем

1. **Хранилище** — `src/main/browser/profiles.ts` (новый): файл Browser profile-ов в папке данных
   Project-а. Запись: id, имя (роль: «admin», «moderator», «user»), список origin-ов, флажок
   «доступен Autopilot». В репозитории Project-а следов нет (ADR-0005).
2. **Partition** — `persist:<id Project-а>-<id Browser profile>`: свой для каждого Browser profile,
   один для всех Browser-ов под ним — куки общие (ADR-0078, п. 5).
3. **Создать и удалить** — только пользователь, только из UI; у Session такого действия нет.
   Удаление стирает хранилище partition-а (куки и данные сайтов).
4. **Список origin-ов** — `scheme://host:port`, например `http://localhost:3000`,
   `https://staging.example.com`; пустой список допустим. Здесь список только хранится и
   редактируется; переходы Session по нему проверяет Ticket 04.
5. **Флажок «доступен Autopilot»** — по умолчанию выключен. Здесь только хранится; читает Ticket 08.
6. **Открыть Browser под Browser profile.** «New browser» спрашивает Browser profile; в шапке
   рамки — имя Browser profile. id Browser profile — в `data` Node-а. Browser без Browser profile
   не открывается.
7. **`will-attach-webview`** разрешает только partition-ы Browser profile-ов своего Project-а.
   На `session` каждого `persist:` partition-а, когда она создаётся, ставятся свои
   `setPermissionRequestHandler` и `setPermissionCheckHandler` с отказом по умолчанию, как в
   Ticket-е 02: обработчик `session.defaultSession` (`src/main/window.ts:222`) на неё не действует.
8. **Вход в аккаунт** — пользователь сам, руками в Browser. worfy ничего не вводит и паролей не
   хранит.
9. **Каналы** — `src/shared/ipc/browser.ts` (новый): список Browser profile-ов — `read` (read-only
   экран показывает имя, ADR-0078, п. 14), создать, изменить, удалить — `write`.

## Готово, когда

- [ ] Unit `test/unit/browser-profiles.test.ts`: имя partition-а из id Project-а и id Browser
      profile; разбор и проверка origin-а (схема, host, порт; путь отклонён; `*` — по вопросу 2);
      флажок по умолчанию выключен.
- [ ] Contract `test/contract/browser-profiles.test.ts`: создать, изменить, удалить во временной
      папке данных; файл не в репозитории Project-а; удаление стирает хранилище partition-а;
      read-only экран читает список и получает отказ на создание.
- [ ] Unit `test/unit/webview-attach-policy.test.ts`: partition чужого Project-а и удалённого
      Browser profile отклонён.
- [ ] Contract `test/contract/browser-profiles.test.ts`: у `session` нового `persist:` partition-а
      стоят свои обработчики разрешений; запрос разрешения от guest-страницы — отказ, проверка —
      `false`; у partition-а двух Browser profile-ов — у каждого свой обработчик.
- [ ] e2e `test/e2e/browser-profile.spec.ts`: создать «admin», открыть два Browser-а под ним,
      fixture-страница ставит куку в одном — второй её видит; Browser под другим Browser profile —
      нет; после перезапуска worfy кука на месте; снимок `browser-profile` в обеих темах.
- [ ] Мутант красный: два Browser profile-а на одном partition-е.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: e2e «кука одного Browser profile не видна под другим».
- Unit `test/unit/browser-profiles.test.ts` (новый), `test/unit/webview-attach-policy.test.ts`;
  contract `test/contract/browser-profiles.test.ts` (новый); e2e `test/e2e/browser-profile.spec.ts`
  (новый).

## Где в коде

- `src/main/browser/profiles.ts` (новый)
- `src/main/browser/attach-policy.ts`
- `src/shared/ipc/browser.ts` (новый)
- `src/main/ipc/browser.ts` (новый; регистрация — как остальные в `registerIpc`,
  `src/main/ipc/index.ts:172`)
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/renderer/browser/BrowserProfiles.tsx` (новый; место в UI — вопрос 1)
- `test/unit/browser-profiles.test.ts` (новый)
- `test/unit/webview-attach-policy.test.ts`
- `test/contract/browser-profiles.test.ts` (новый)
- `test/e2e/browser-profile.spec.ts` (новый)

Только чтение: `src/main/projects/store.ts` (`dataDir` `:130`), `src/shared/ipc/channels.ts` (`:52`).

## Вне скоупа

- Проверка переходов Session по списку origin-ов — Ticket 04.
- Autopilot по флажку — Ticket 08.
- Вход и создание Browser profile с экрана Linked machine — после Ticket-а 07 (кадры и ввод).

## Открытые вопросы

1. **Где пользователь управляет Browser profile-ами.** ADR не говорит. Варианты: «Project settings…»
   (Browser profile принадлежит Project-у; Settings — настройки worfy на Machine, `CONTEXT.md`),
   меню Browser Node, отдельная панель. Решает владелец до claim.
2. **Поддомены в списке origin-ов** (`https://*.example.com`). ADR приводит только точные origin-ы.
   Предложение: только точные; решает владелец.
3. **Удаление Browser profile, под которым открыты Browser-ы:** закрыть их или отказать в удалении —
   ADR не решает.
4. **Переименование Browser profile** — разрешено ли (partition от id, не от имени) — ADR не
   говорит. Предложение: да.

## Итог

Заполняется при закрытии.

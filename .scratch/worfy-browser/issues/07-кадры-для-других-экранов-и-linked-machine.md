# 07 — Кадры для других экранов и Linked machine: `Page.startScreencast`, пересылка ввода, одна живая страница

Type: task
Status: open
Blocked by: 05
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 9
(Browser исполняется на Machine Project-а; Linked machine — кадры `Page.startScreencast` /
`Page.screencastFrame` и ввод; отдельный Ticket после базового Browser), пункт 14 (Read only: кадры и
ввод — `write`, видна только рамка с именем Browser profile), пункт 16 (Live — в одном окне, остальные
экраны — кадры; сон смотрит на все экраны), «Последствия» (на Linked machine нет ни кук, ни
CDP-сессии); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md),
[ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md),
[ADR-0066](../../../docs/adr/0066-read-only-access-for-a-linked-machine.md). Код перечитан по main
`dd6b0afb`.

## Что происходит

- Вывод Terminal идёт окну событием `terminal.output` (`src/main/ipc/terminal.ts:52-57`), канал
  объявлен `'project', 'write'` (`src/shared/ipc/terminal.ts:120-125`): read-only экрану он закрыт
  (`src/shared/ipc/channels.ts:47`). Адаптер Linked machine отказывает в `write` read-only машине
  (`src/main/link/ipc-adapter.ts:239`).
- После Ticket-а 05 живая страница есть в каждом окне, где виден Browser, а на Linked machine её нет:
  CDP-сессия и куки — только на Machine Project-а.

## Что делаем

1. **Окно-владелец.** Live Browser живёт ровно в одном окне — там, где с ним работали последним
   (ADR-0078, п. 16). Решает main: `src/main/browser/owner.ts` (новый), чистая функция от событий
   «работали с Browser» по окнам.
2. **Кадры** — `src/main/browser/screencast.ts` (новый): CDP `Page.startScreencast` на живой
   странице; кадры `Page.screencastFrame` уходят всем экранам, кроме окна-владельца: другим окнам
   этой Machine и Linked machine-ам. Пока кадры никто не смотрит, screencast выключен.
3. **Ввод.** Клик, прокрутка и клавиши в кадрах другого экрана main передаёт живой странице через
   CDP (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`). Это тот же ввод пользователя, что и в
   окне-владельце: он перехватывает управление у Session (Ticket 04).
4. **Каналы** — в `src/shared/ipc/browser.ts`: кадры и ввод — `write` (ADR-0078, п. 14). Снимок
   Asleep (Ticket 05) — тоже `write`.
5. **Read-only экран** видит только рамку Browser с именем Browser profile: без кадров, без снимка
   спящей страницы, без адресной строки и без URL. URL Browser-а лежит в `data` Node-а (Ticket 02),
   а Layout read-only машина получает: `layout.get` и `layout.changed` — `read`
   (`src/shared/ipc/layout.ts:16`, `:33`). Поэтому URL из того, что уходит read-only машине, main
   убирает явно; то же — для снимка Asleep, если Ticket 05 положит его в Layout.
6. **Сон.** Видимость на Linked machine считается в правилах сна, как видимость в окне (Ticket 05):
   Browser засыпает, только если его не видно ни на одном экране.

## Готово, когда

- [ ] Unit `test/unit/browser-owner.test.ts`: владелец — окно, где работали последним; закрытие окна
      передаёт страницу другому; одно окно — владелец сам.
- [ ] Contract `test/contract/browser-frames.test.ts`: кадры и ввод доходят до Linked machine с полным
      доступом; read-only машина получает отказ на ввод, не получает кадров и снимка Asleep, но
      получает имя Browser profile; в Layout, который получает read-only машина (`layout.get` и
      `layout.changed`), у Browser Node-а нет URL; кадров нет, когда их никто не смотрит.
- [ ] e2e `test/e2e/browser-screens.spec.ts` (`openSecondWindow`, `test/e2e/helpers.ts:243`): второе
      окно показывает кадры Browser; клик во втором окне доходит до fixture-страницы; после работы во
      втором окне живая страница переезжает туда; снимок `browser-frames` в обеих темах.
- [ ] e2e `test/e2e/linked-browser.spec.ts` (как `test/e2e/linked-read-only.spec.ts`): Linked machine
      с полным доступом видит кадры и печатает в странице; read-only — только рамку с именем: на ней
      не видно адресной строки и URL, у спящего Browser не видно снимка Asleep.
- [ ] Мутанты красные: кадры идут read-only машине; URL Browser-а уходит read-only машине в Layout;
      Browser засыпает, хотя виден на Linked machine;
      две живые страницы одного Browser в двух окнах.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: contract «read-only машина не получает кадров».
- Unit `test/unit/browser-owner.test.ts` (новый); contract `test/contract/browser-frames.test.ts`
  (новый); e2e `test/e2e/browser-screens.spec.ts` (новый), `test/e2e/linked-browser.spec.ts` (новый).

## Где в коде

- `src/main/browser/owner.ts` (новый)
- `src/main/browser/screencast.ts` (новый)
- `src/main/browser/sleep.ts` (видимость на Linked machine)
- `src/shared/ipc/browser.ts` (кадры и ввод — `write`)
- `src/main/ipc/browser.ts`
- `src/renderer/canvas/nodes/BrowserNode.tsx` (кадры; рамка на read-only экране)
- `src/renderer/canvas/overlays/BrowserLayer.tsx` (живая страница только в окне-владельце)
- `test/unit/browser-owner.test.ts` (новый)
- `test/contract/browser-frames.test.ts` (новый)
- `test/e2e/browser-screens.spec.ts` (новый)
- `test/e2e/linked-browser.spec.ts` (новый)

Только чтение: `src/shared/ipc/channels.ts` (`CHANNEL_USE` `:52`), `src/main/link/ipc-adapter.ts`
(`:239`), `src/main/ipc/terminal.ts` (`clientSink` `:53`), `test/e2e/helpers.ts` (`openSecondWindow`
`:243`).

## Вне скоупа

- Создание Browser profile и вход с экрана Linked machine — отдельно, если владелец захочет (вопрос 4).
- Dock со встроенным браузером (ADR-0078, п. 17).

## Открытые вопросы

1. **Что считается «работали»** для выбора окна-владельца — фокус, клик, ввод, прокрутка. ADR
   говорит только «где с ним работали последним».
2. **Переезд живой страницы в другое окно** в Electron, скорее всего, пересоздаёт `<webview>` и
   перезагружает страницу — тогда несохранённая форма теряется, как при сне. ADR этого не
   обсуждает. Исполнитель проверяет и записывает в «Итог»; если переезд перезагружает страницу при
   `beforeunload`, решает владелец.
3. **Частота и качество кадров** (`maxWidth`, `quality`, кадров в секунду), в том числе для Linked
   machine по сети, — ADR не задаёт.
4. **Вход в аккаунт с экрана Linked machine** через кадры — разрешён ли. ADR-0078, п. 9 говорит, что
   Browser profile один с любого экрана, но про вход с Linked machine прямо не говорит.

## Итог

Заполняется при закрытии.

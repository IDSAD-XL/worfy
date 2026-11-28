# 173 — Mind map Product Session показывает тему своей Session, а не последнюю изменённую в Project-е

Type: bug
Status: done 2026-11-28T10:29Z
PR: #2366
Branch: worfy-polish/173
Blocked by: None — can start immediately
Source: два bug-а владельца 2026-11-28, оба про Link (Link — связь двух машин worfy: гость смотрит и ведёт Session-ы
хоста). Слова владельца:
1. «при переключении между двумя разными продакт сессиями не переключается граф, если делать с другого компа через Link»;
2. «иногда не подгружается граф, пока не нажмёшь на какую-то идею в чате, если я стартанул продакт сессию с другого
   устройства, а потом посмотрел на хосте».

Кто: агент. Глубина review — `medium`. Не платформенный PR.

## Что происходит

Root cause у обоих bug-ов один: тема, чей Mind map рисует панель Product Session, не взята из самой Session. Это
догадка окна по событиям, которые оно услышало, и хранится она в localStorage этого окна.

- `src/renderer/session/ProductSessionPanel.tsx:102-117` (`useShownTopic`): пока панель Node открыта, она подписана на
  `product.changed` и на каждое событие Project-а зовёт `followTopic(key, change.name)` (`:108-111`). Какая Session
  (или какое окно, или рука) поменяла файлы темы — не проверяется. Без события панель берёт имя из localStorage
  (`:117`, ключ `worfy.productSession.topic:<projectId>:<nodeId>`, `:75`, запись — `followTopic`, `:89-96`).
- `src/renderer/product/useMindMap.ts:54-69`, `:92`: `product.topic` читается, только когда имя темы известно. Пока
  имени нет, панель показывает заглушку «The Mind map appears once the advisor adds its first node»
  (`ProductSessionPanel.tsx:450-453`).
- `product.changed` уходит каждому подписчику документов Project-а (`src/main/docs/watch.ts:851-852`), через Link — в
  каждое окно гостя (`src/main/ipc/docs.ts:121-123` → `src/main/ipc/linked.ts:42`). Больше того, первое чтение темы
  watcher-ом (watcher — наблюдатель файлов Project-а в main) — в том числе по `product.topic` из любого окна любой
  машины — тоже шлёт `product.changed` (`watch.ts:588-597`: `reads.last` ещё пуст, значит «изменилось»). Значит, одно
  только открытие графа темы X на одной машине переключает на X открытую панель другой Session на другой машине.
- Так задумал не владелец: это выбор исполнителя worfy-product-session 08
  (`.scratch/worfy-product-session/issues/08-отрисовка-mind-map.md:145-147`), записанный в
  `docs/features/product-session.md:306-309` и `docs/features/ru/product-session.md:243`.

Почему так выходит через Link:

- **Bug 2 (хост, пустой граф до клика по идее).** Session B запущена с гостя. Её advisor пишет тему Y на хосте, но на
  хосте панель Node B в этот момент не открыта. Подписка `useShownTopic` живёт только у открытой панели, поэтому хост
  имени Y для Node B не узнаёт: ни в памяти, ни в своём localStorage (у гостя localStorage свой). Владелец открывает B на
  хосте — имени нет, заглушка. Клик по чипу идеи в чате (chip — ссылка на узел в сообщении) зовёт `pickNode`
  (`src/renderer/product/node-chips.ts:174`). `useTopicOfChip` (`ProductSessionPanel.tsx:138-174`) видит тему чипа,
  читает её и зовёт `followTopic(key, wanted.topic)` (`:164`) — граф появляется. «Иногда» — потому что, если панель B
  на хосте была открыта во время записи Y или Y поменялась уже после открытия, событие пришло и граф есть.
  Уверенность: высокая — код даёт ровно этот симптом и ровно этот обход.
- **Bug 1 (гость, при переключении остаётся граф первой Session).** На госте панель Node A показывает тему X. Владелец
  переключается на B (тот же экземпляр `SessionPanel`, меняется `nodeId`, `src/renderer/session/SessionView.tsx:475`).
  Ключ B берёт то имя, что гость услышал, пока B была открыта в прошлый раз: любую тему Project-а, в том числе X
  (запись advisor-а A, перетаскивание узла X на хосте через `product.layout`, первое чтение X watcher-ом). А пока B на
  экране, каждая следующая запись advisor-а A в X снова переключает панель B на X. С двумя Session-ами в одном
  Project-е, которые обе работают на хосте, панель показывает тему, изменённую последней, а не тему открытой Session.
  Уверенность: средняя. Код даёт этот симптом, но какой из путей сработал у владельца, по коду не решить. Другой
  вариант того же корня: у B на госте имени нет вовсе, и после переключения видна заглушка, а не граф A.

Одна правка закрывает оба bug-а: тема берётся из вызовов самой Session, одинаково на хосте и на госте, в любом окне.

## Что строить

1. **Тема Session — из её собственных вызовов.** Панель (`ProductSessionPanel`) и заголовок (`ProductTopicName`,
   `SessionView.tsx:358`) берут тему из `events` этой Session (`SessionView.tsx:170-171`: загруженный транскрипт и живые
   события; у гостя транскрипт читается с хоста). Тема — `topic` последнего удачного вызова `mind_map_add`,
   `mind_map_update`, `mind_map_decide` или `mind_map_read` с `topic`, по тем же именам tool-ов, что узнают чипы
   (`WRITING_TOOLS`, `node-chips.ts:39`, плюс `mind_map_read`; разбор `topic` — `writtenNode`, `:48-61`). Вызовы
   Subagent-ов Session считаются так же, как их считают чипы (`transcriptChips`, `node-chips.ts:103`): не больше и не
   меньше.
2. **`product.changed` Project-а больше не переключает тему.** Подписку `followTopic` на любое `product.changed`
   (`ProductSessionPanel.tsx:105-115`) убрать. `useMindMap` по-прежнему обновляет копию уже показанной темы по
   `product.changed` (`useMindMap.ts:39-42`) — это остаётся.
3. **Чип другой темы** (`useTopicOfChip`) по-прежнему переключает карту на свою тему и выделяет узел
   (worfy-polish 147). Выбор чипа держится, пока Session не сделает следующий свой вызов `mind_map_*` с другой темой:
   тогда карта идёт за Session.
4. **Запоминание по Node** (localStorage, `:75`, `:89-96`) остаётся только как запас: пишется из вызовов Session и из
   клика по чипу, читается, пока в загруженной части транскрипта нет ни одного вызова `mind_map_*` с `topic` (длинный
   транскрипт грузится частями, `past.earlier`). Событие другой Session его больше не пишет.
5. **Main не трогать.** То, что первое чтение темы шлёт `product.changed` (`watch.ts:588-597`), после пункта 2 вреда
   не делает: панель на это событие тему уже не меняет. Если исполнитель найдёт другой подписчик, которого оно
   переключает, — записать его в «Итог» и решить в этом же PR.
6. **Документация.** Абзац «Which topic shows» в `docs/features/product-session.md:306-309` и
   `docs/features/ru/product-session.md:243`: карта показывает тему последнего вызова `mind_map_*` этой Session, чип
   другой темы переключает до следующего такого вызова, на хосте и на госте Link одинаково.

## Где в коде

- `src/renderer/session/ProductSessionPanel.tsx:75-117` (`TOPIC_PREFIX`, `followTopic`, `useShownTopic`),
  `:138-174` (`useTopicOfChip`), `:181-190` (`ProductTopicName`), `:435-460` (`ProductSessionPanel`).
- `src/renderer/session/SessionView.tsx:170-171`, `:358`, `:431` — откуда берутся `events` и куда передаются.
- `src/renderer/product/node-chips.ts:39`, `:48-61`, `:103` — имена tool-ов и разбор `topic` из вызова.
- `src/renderer/product/useMindMap.ts` — без изменений по смыслу.
- `src/main/docs/watch.ts:588-597`, `:851-852`; `src/main/ipc/docs.ts:121-123`; `src/main/ipc/linked.ts:42` — для
  сверки, не менять без нужды.
- `docs/features/product-session.md:306-309`, `docs/features/ru/product-session.md:243`.

## Test-ы

Сначала красные unit test-ы в `test/unit/product-session-panel.test.tsx` (fake bridge там уже есть, `:58-124`).
Каждый красный на текущем коде:

- **Переключение Session (bug 1).** Две Product Session одного Project-а: у Node `n1` в `events` удачный
  `mind_map_add` с `topic: 'demo-roadmap'`, у `n2` — с `topic: 'pricing'`. Mount с `n1`, потом rerender того же
  дерева с `n2` и событиями `n2`, как делает `SessionView` без `key` → нарисована карта `pricing`, заголовок — её
  title. Затем `product.changed` темы `demo-roadmap` (пишет advisor `n1`) → панель `n2` остаётся на `pricing`.
- **Первое открытие без событий (bug 2).** Чистый localStorage, ни одного `product.changed`. В загруженном транскрипте
  Session есть удачный `mind_map_add` темы X → карта X нарисована без клика; `product.topic` спрошен один раз.
- **То же через Link.** Оба случая в окне гостя: адрес `?machine=<id>`, вызовы идут как `linked.invoke`, события
  приходят как `linked.event` (образец stub-а Link bridge — `test/unit/modes-menu.test.tsx:70-111`, `:789-794`).
  Настоящего соединения нет.
- **Чип другой темы.** Существующий test `:993` остаётся зелёным. Новый: после клика по чипу темы `pricing` следующий
  вызов Session в `demo-roadmap` возвращает карту на `demo-roadmap`.
- **Запас.** В загруженной части транскрипта нет вызовов `mind_map_*` → берётся имя из localStorage этого Node.
  `product.changed` другой темы его не меняет.
- Test `:955` («draws the Mind map of the topic whose files changed…») описывает старое поведение. Его переписать на
  новое, а не удалить: тема из вызова Session, повторное открытие показывает её снова.
- Все unit и contract test-ы модуля: `test/unit/product-session-panel.test.tsx`, `test/unit/product-use-mind-map.test.tsx`,
  `test/unit/node-chips.test.tsx`, `test/unit/session-view.test.tsx`, `test/unit/mind-map-hand.test.tsx`.
- E2e не нужен: seam — renderer, Link bridge — stub. CI гоняет остальные e2e сам.

## Готово, когда

- [ ] Панель Product Session и её заголовок показывают тему последнего вызова `mind_map_*` своей Session. При
      переключении на другую Session карта переключается; запись другой Session в её тему карту не меняет.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/product-session-panel.test.tsx, test/unit/node-chips.test.tsx) · mac - · d97b8bb6e5df9416500be3aace4e7b4320af0194
  - evidence: review pass · PR #2366 · - - · 0479117127fbcee192d36db3ebc299406894bda0
- [ ] Session, запущенная на другой машине, при первом открытии на этой показывает свою карту без клика по идее.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/product-session-panel.test.tsx, test/unit/node-chips.test.tsx) · mac - · d97b8bb6e5df9416500be3aace4e7b4320af0194
  - evidence: review pass · PR #2366 · - - · 0479117127fbcee192d36db3ebc299406894bda0
- [ ] Чип другой темы переключает карту и выделяет узел; следующий вызов Session возвращает карту на её тему.
  - evidence: test-run pass · `pnpm test` exit 0 (test/unit/product-session-panel.test.tsx, test/unit/node-chips.test.tsx) · mac - · d97b8bb6e5df9416500be3aace4e7b4320af0194
  - evidence: review pass · PR #2366 · - - · 0479117127fbcee192d36db3ebc299406894bda0
- [ ] Unit test-ы на оба bug-а, в том числе в окне гостя через stub Link bridge, красные до правки; test `:955`
      переписан под новое поведение.
  - evidence: test-run pass · `pnpm test` test/unit/product-session-panel.test.tsx exit 1 on origin/main panel (10 red), exit 0 after the change · mac - · d97b8bb6e5df9416500be3aace4e7b4320af0194
  - evidence: review pass · PR #2366 · - - · 0479117127fbcee192d36db3ebc299406894bda0
- [ ] Абзац «Which topic shows» в `docs/features/product-session.md` и `docs/features/ru/product-session.md` говорит,
      откуда берётся тема.
  - evidence: commit pass · worfy-polish/173: a Product Session's Mind map shows the topic of its own calls · - - · d97b8bb6e5df9416500be3aace4e7b4320af0194
  - evidence: review pass · PR #2366 · - - · 0479117127fbcee192d36db3ebc299406894bda0
- [ ] (вручную) Сделай: на Mac в Stable worfy (хост) открой Project с двумя Product Session, у которых разные темы;
      на ПК открой этот Project через Link. На ПК переключись с первой Session на вторую и обратно, пока advisor
      первой ещё пишет → Должно быть: каждый раз граф своей Session, и запись первой не перекидывает вторую.
  - needs: windows stable
- [ ] (вручную) Сделай: на ПК в Stable worfy открой через Link Project Mac-а (хост), запусти на ПК новую Product
      Session и дождись первого узла; на Mac открой эту Session → Должно быть: граф виден сразу, без клика по идее в
      чате.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · d97b8bb6e5df9416500be3aace4e7b4320af0194
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/46127578823/job/140949136635 · ci - · 0479117127fbcee192d36db3ebc299406894bda0

## Итог

- Тема карты и заголовка Product Session теперь берётся из вызовов самой Session: `sessionTopicCall`
  (`src/renderer/product/node-chips.ts`) ищет в свёрнутом `foldTranscript` транскрипте последний удачный
  `mind_map_add`, `mind_map_update`, `mind_map_decide` или `mind_map_read` с `topic`. Свёртка та же, что у чипов,
  поэтому вызовы Subagent-ов не считаются, как и в `transcriptChips`. `ProductTopicName` получает те же `events`, что
  панель (`SessionView.tsx`); свёртка делается один раз на массив событий (`WeakMap` в `ProductSessionPanel.tsx`).
- Подписка панели на `product.changed` Project-а убрана: событие другой Session и первое чтение темы watcher-ом больше
  не переключают карту. `useMindMap` по-прежнему обновляет копию показанной темы по `product.changed`. Других
  подписчиков, которых это событие переключало бы, в renderer нет (`grep 'product.changed' src/renderer`: только
  `useMindMap` и счётчик принятых советов в заголовке). Main не менялся.
- Чип другой темы переключает карту до следующего вызова Session: выбор чипа хранит id последнего вызова Session на
  момент клика; новый вызов (другой id) возвращает карту к теме Session.
- localStorage по Node остаётся запасом: пишется из вызовов Session и из клика по чипу, читается, только пока в
  загруженной части транскрипта нет ни одного такого вызова.
- Test-ы сначала красные: на коде `origin/main` (без правки панели) 10 test-ов блока «the Mind map pane of a Product
  Session» в `test/unit/product-session-panel.test.tsx` падали — переключение Session (bug 1), первое открытие без
  событий (bug 2), оба случая в окне гостя через stub `linked.invoke` / `linked.event`, запас из localStorage, чип и
  возврат после чипа. Test «draws the Mind map of the topic whose files changed…» переписан под новое поведение. В трёх
  прежних test-ах (ошибка чтения темы, чип другой темы, чип пропавшей темы) тема теперь задаётся вызовом Session в
  `events`, а не `product.changed`: старый способ больше не переключает карту; проверки этих test-ов не менялись.
  Чистые test-ы `sessionTopicCall` — в `test/unit/node-chips.test.tsx`.
- Абзац «Which topic shows» в `docs/features/product-session.md` и `docs/features/ru/product-session.md` переписан.
- E2e на CI (windows-e2e 1/4, первый head PR) упал: `test/e2e/a11y.spec.ts:99` и ещё три test-а
  `test/e2e/product-session.spec.ts` (вторая половина test-а про перетаскивание узла после перезапуска, длинные тексты,
  Graph) открывали новую Product Session без единого сообщения и писали файлы темы руками, полагаясь на старое
  поведение «карта идёт за изменённой темой». Теперь в них сначала ход fake-агента `product-mind-map` (его
  `mind_map_add` называет тему `roadmap`), потом запись файла; проверки test-ов не менялись. Эти файлы вне
  «Где в коде», правка вынужденная. Локально e2e не запускались (бриф), решает CI.
- Ревью, раунд 1 (VERIFIED с [low]): выбор чипа, сделанный, пока в загруженном транскрипте не было вызова
  `mind_map_*`, больше не сбрасывает «Load earlier» со старым вызовом — выбор помнит последнее событие на момент
  выбора, и сбрасывает его только вызов после этого события (`chipHolds`; test «a chip chosen while the loaded
  transcript held no topic call…» был красным до правки); два пропущенных пробела исправлены; ручной пункт разбит на
  два — `needs: windows stable` (ПК-гость) и `needs: mac stable` (Mac-хост), чтобы `ticket evidence` их читал.
- Ручные пункты (Mac-хост и ПК-гость через Link) не проверялись: нужен владелец на обеих машинах.

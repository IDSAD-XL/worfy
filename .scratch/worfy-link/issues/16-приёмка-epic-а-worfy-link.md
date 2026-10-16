# 16 — Приёмка Epic-а worfy-link по «Готово, когда»

Type: task
Status: blocked — приёмка вместе с владельцем (HANDOFF, «Дальше»: приёмки `worfy-harness` 26 и `worfy-link` 16 — не в Autopilot); Autopilot не берёт
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15
Source: «Готово, когда» Epic-а worfy-link ([spec.md](../spec.md)); решения владельца 2026-10-07, Q12 (после E3 параллельно с Windows-портом; первая проверка — dev-сборка и Stable copy на одном Mac; мерж в main по очереди; [spec.md](../spec.md)); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md)

## Что происходит

- К claim Ticket-ы 01–15 влиты, у каждого свои test-ы. Ticket-ы проверяли две копии worfy с двумя папками данных: в e2e или в одном процессе vitest. Папку данных задаёт `WORFY_DATA_DIR` (`src/main/storage/paths.ts:30-34`). Целиком на живых сборках Epic никто не проверял.
- На одном Mac одновременно работают dev-сборка (`pnpm dev`) и Stable copy (`~/Applications/worfy-stable.app`, ставит `pnpm install:stable`, `scripts/install-stable.sh`).
  - Папки данных у них разные: `worfy-dev` и `worfy` в `~/Library/Application Support` (`src/main/storage/paths.ts:20-34`).
  - Single-instance lock берётся по папке данных (`src/main/index.ts:21-35`), поэтому обе копии запускаются вместе.
  - Это две Machine: у каждой папки данных своя (Ticket 02).
- Dev-сборка не ведёт Autopilot над репозиторием самого worfy (`SELF_PROJECT_MESSAGE`, `src/main/autopilot/run.ts:151`). Для пунктов про Autopilot нужен другой Project.
- Уведомления dev-сборки из `pnpm dev` могут прийти от «Electron» или не прийти вовсе (`src/main/notify.ts:18-19`).
- Пары Mac + Windows пока нет. Она появится, когда Epic worfy-windows поставит worfy на Windows-ПК владельца (его «Готово, когда», пункт 1). Заблокировать этот Ticket тем Epic-ом через `Blocked by` нельзя: там только Ticket-ы своего Epic-а.
- CI на PR идёт только на Linux (`.github/workflows/ci.yml:26`). e2e — локально, в gate full.

## Что делаем

1. Ставит Stable copy из `origin/main` с влитыми 01–15 (`pnpm install:stable`) и запускает dev-сборку того же коммита.
2. Проходит пять пунктов «Готово, когда» Epic-а на одном Mac. Каждый пункт ниже — с командой или test-ом. Для Autopilot берётся Project, подключённый через E3 (Epic worfy-harness), только не сам worfy. Его репозиторий клонируется дважды: один клон — Project Stable copy, второй — Project dev-сборки.
3. Пишет сквозной e2e в `test/e2e/linked-machines.spec.ts` — один сценарий на двух worfy от связи до отзыва: правка Canvas, сообщение в Session, ввод в Terminal, старт и Stop Autopilot. Ticket-ы 01–15 проверяют каждый свою часть, этот test держит Epic целиком.
4. Найденный дефект оформляется новым Ticket-ом Epic-а, а не правкой здесь. Номер нового Ticket-а дописывается в `Blocked by` этого.
5. Mac пройден, а Epic worfy-windows ещё не принят — Ticket получает `ticket block` с причиной «ждёт Epic worfy-windows». После приёмки того Epic-а — вторая часть: те же проверки на паре Mac + Windows.
6. В `.scratch/worfy-link/spec.md` отмечает пункты «Готово, когда» Epic-а со ссылкой на «Итог» этого Ticket-а.

Не входит: новые функции.

## Готово, когда

**Mac: dev-сборка + Stable copy.** Каждая ручная проверка — со снимками окон обеих копий в `../evidence/16-*.png`.

Пункт 1 Epic-а — связь и отзыв.

- [ ] (вручную) dev-сборка и Stable copy связаны по 6-значному коду. Секция Machines боковой панели свёрнута, пока её не развернули: кнопка «Link a machine…» и список Linked machine-ов — в развёрнутой секции (клик по заголовку «Machines»). Связь видна в этом списке у обеих копий и по зелёной точке рядом с заголовком «Machines» — она видна и у свёрнутой секции, её подсказка — «1 linked machine online».
- [ ] (вручную) отзыв с каждой стороны по очереди (правый клик по строке в развёрнутой секции Machines → «Revoke»). Вторая копия сразу теряет соединение: её нет в списке Linked machine-ов развёрнутой секции Machines, зелёной точки у заголовка «Machines» нет, её Project-ы пропадают из боковой панели.

Пункт 2 — работа с Project-ом другой машины.

- [ ] (вручную) Из dev-сборки открыт Canvas Project-а Stable copy. Сделано: перемещение Node-а, новая Note, сообщение в Session, `echo linked` в Terminal, старт и Stop Autopilot. Каждое видно в окнах обеих копий без перезагрузки.
- [ ] Команда: всё выполняется на машине Project-а. `pgrep -lP <pid Stable copy>` показывает процесс `claude` этой Session и shell Terminal среди дочерних процессов Stable copy. `pgrep -lP <pid dev-сборки>` их не показывает.
- [ ] (вручную) Камера своя: сдвиг и масштаб Canvas в одном окне не двигают другое.
- [ ] (вручную) ⌘Z в dev-сборке отменяет только её правку. Если тот же Node потом правила Stable copy, шаг пропущен с подсказкой.

Пункт 3 — Session без окна и «Add Project».

- [ ] (вручную) Session запущена из dev-сборки в Project-е Stable copy. Окно dev-сборки закрыто, потом dev-сборка остановлена. Session жива: видна и отвечает в окне Stable copy, её процесс `claude` не завершился (`ps -p <pid>`).
- [ ] (вручную) «Add Project» в dev-сборке: выбор Machine Stable copy, папка — просмотром её файлов внутри worfy. Project появился в окне Stable copy и в dev-сборке, в группе Machine Stable copy.

Пункт 4 — уведомления, сон, второй Autopilot.

- [ ] (вручную) Окна обеих копий без фокуса (активно другое приложение). Ход Session Project-а Stable copy кончается — приходят два уведомления, по одному от каждой копии. Клик по уведомлению dev-сборки открывает эту Session в окне dev-сборки.
- [ ] Команда: копии связаны, доступ включён только у Stable copy (переключатель «Linked machines can work with my Projects» — в Settings → Machines, ⌘, или меню worfy → «Settings…»; в боковой панели его больше нет). `pmset -g assertions` показывает `PreventUserIdleSystemSleep` у pid Stable copy. После отзыва связи — не показывает.
- [ ] (вручную) Второй Autopilot. Project-ы — два клона одного репозитория: один у Stable copy, другой у dev-сборки. Autopilot Epic-а запущен на Stable copy. Старт того же Epic-а на dev-сборке отклонён, отказ называет Machine Stable copy. «Start anyway» здесь не нажимать: обход проверен e2e Ticket-а 15. Прогон на Stable copy остановлен.

Пункт 5 — безопасность.

- [ ] Команда: worfy с пустой папкой данных (`WORFY_DATA_DIR=$(mktemp -d) pnpm dev`). Переключатель «Linked machines can work with my Projects» в Settings → Machines выключен. Порт связи не слушается, пока нет Linked machine и не открыт «Link a machine»: `lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>` пуст. Правило — из «Итог» Ticket-ов 01–02.
- [ ] test-ы проверки Origin/Host Ticket-а 01 есть и зелёные: их имена — из «Итог» Ticket-а 01, `pnpm test` — exit 0.
- [ ] Команда: обе копии запущены из терминала с выводом в файлы — `~/Applications/worfy-stable.app/Contents/MacOS/worfy > stable.log 2>&1` и `pnpm dev > dev.log 2>&1`. Сделаны связывание, работа с Project-ом и отзыв. `grep -c <код с экрана> stable.log dev.log` — 0 и 0. Отсутствие токена в выводе проверяет test Ticket-а 01, он зелёный.

Сквозной test.

- [ ] e2e `test/e2e/linked-machines.spec.ts` со сквозным сценарием зелёный в `GATE_SCOPE=all gate.sh full`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

**Mac + Windows: после приёмки Epic-а worfy-windows.**

- [ ] (вручную) Mac и Windows связаны по коду: «Link a machine…» — в развёрнутой секции Machines боковой панели. Отзыв с каждой стороны сразу рвёт соединение.
- [ ] (вручную) С Windows на Canvas Project-а Mac: правка, Session, Terminal (zsh на Mac), старт и Stop Autopilot. С Mac на Canvas Project-а Windows — то же (Terminal — PowerShell на Windows). Оба экрана обновляются вживую.
- [ ] (вручную) Session, запущенная с Windows, переживает закрытие окна worfy на Windows. «Add Project» с Windows на Mac — через просмотр папок Mac.
- [ ] (вручную) Уведомления в обе стороны.
- [ ] Команда: пока машины связаны, `powercfg /requests` на Windows показывает процесс worfy в разделе SYSTEM, а `pmset -g assertions` на Mac — assertion у worfy.
- [ ] (вручную) Mac уходит в сон из меню . На Windows в развёрнутой секции Machines Mac показан как «спит», а не «недоступна»; зелёной точки у заголовка «Machines» при этом нет. Так проверяется, что сообщение перед сном уходит по сети (Ticket 14).
- [ ] (вручную) На Windows старт Autopilot того же Epic-а с тем же origin, что идёт на Mac, отклонён с именем Mac.

## Тесты

Сквозной e2e пишется без «сначала падающего test-а»: к claim всё, что он проверяет, уже влито. Если он падает, это дефект одного из Ticket-ов 01–15 — новый Ticket (пункт 4 раздела «Что делаем»).

Сценарий использует helper двух связанных worfy из Ticket-а 02 и fake-агента (`WORFY_AGENT=fake`, `test/e2e/helpers.ts:128-133`). `test/e2e/helpers.ts` этот Ticket не правит.

## Где в коде

- `test/e2e/linked-machines.spec.ts`
- `.scratch/worfy-link/spec.md`

## Итог

Заполняется при закрытии.

## Решения владельца (2026-10-16)

- Приёмка — после конца run Autopilot на worfy-link (Ticket-ы 21–24): шаг 3 стартует Autopilot в
  Stable copy.
- В приёмку входит живая проверка уровня Read only на двух Machine: `agent.event` и уведомления
  ([18](18-право-только-чтение-для-linked-machine.md), «Решения владельца»), и ручной пункт Ticket-а 02 —
  Bonjour и запрос Local Network.

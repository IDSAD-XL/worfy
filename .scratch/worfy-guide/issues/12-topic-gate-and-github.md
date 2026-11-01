# 12 — Topic Gate and GitHub

Type: task
Status: done 2026-11-01T07:06Z
PR: #1179
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/gate-and-github.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

## Что делаем

1. Простой уровень: живая схема и короткий текст, понятный без знания кода. Объём судит автор по этому Feature: текст должен читаться быстро, но его не режут под число слов (Q5).
2. Under the hood, свёрнут: техническая схема потока данных, короткий текст, таблица главных файлов и важные лимиты.
3. Английский и русский в одном PR; технические термины и названия UI по-английски.
4. Страницы-источники и их SHA в реестре Topic-ов.

## Готово, когда

- [ ] Каждое утверждение и подпись на схемах сверены с кодом вторым агентом.
- [ ] Снимки: обе темы, оба языка, reduced motion, развёрнутый Under the hood, в `.scratch/worfy-guide/evidence/`.
- [ ] Topic читается быстро: второй агент называет места, которые можно убрать.
- [ ] Tokens автора и проверки в `## Итог`.

## Тесты

Новых нет: test-ы реестра из Ticket-а 03 покрывают Topic.

## Где в коде

- `src/renderer/guide/`, `docs/features/gate-and-github.md` — только чтение страниц.

## Итог

Topic `gate-and-github` (`src/renderer/guide/topics/gate-and-github/`): `spec.ts` с двумя схемами, `Scene.tsx` (простой
уровень, `viewBox` 836×494, 6 блоков, 6 связей, 5 шагов проигрывателя), `Flow.tsx` (поток данных badges в Under the hood,
976×476, 8 блоков, 8 связей), `en.json`, `ru.json`, `topic.json` и одна строка `registry.ts`. `topic.json` сверен с
`docs/features/gate-and-github.md` на 1c9d99c7 (последний commit страницы). Блок Gate на Map of worfy теперь открывает этот
Topic. Блоки Canvas, Ticket и Session ведут в Topic-и `canvas`, `workflow`, `sessions`, пока Topic-а нет — на его страницу.
Gate, Worktree и GitHub только подсвечиваются: это сам Topic.

Ключи поиска: `gate full`, `ci badges`, `verdict`. Проверено разовым test-ом (в PR не входит): для заголовка, каждого слова
заголовка и каждого ключа каждой команды палитры (плюс `gate`, `github`, `pr`, `ci`, `open pr`, `gate queue`) первая строка
`rankItems` с этим Topic-ом та же, что без него; Topic стал первым только там, где раньше не находилось ничего
(`github`, `verdict`, `gate full`, `ci badges`). `gate` и `gate queue` по-прежнему находят Process gate queue первым.

Решено без владельца: группы цвета — Gate `harness` (как на Map of worfy), Worktree и GitHub `project` (репозиторий
Project-а и его PR-ы), код worfy в Under the hood — нейтральный `machine`; GitHub в обеих схемах одной группы. Связь
Session → GitHub «pushes, opens a PR» взята из skill-а, а не со страницы: страница говорит только «PR of its branch».
Шаг 3 (удержание хода) связей не подсвечивает: hook `Stop` — отдельная программа, на схеме её нет.

**Утверждения и их источники.** `g.md` = `docs/features/gate-and-github.md` на 1c9d99c7.

| Что на схеме или в тексте | Источник |
|---|---|
| Gate — проверка из Harness, готовы ли изменения в worktree; «one program of the Harness» | `g.md:3`, `:11`, `CONTEXT.md:115-116`, `:127-128` |
| Запускает проверки Project-а на том, что изменилось, и даёт один вердикт; «checks what changed» (Gate → Worktree) | `g.md:11-12`, `:50-51`, `harness/hooks/gate.mjs:882-908` |
| worfy Gate никогда не запускает; вердикт читает | `g.md:12-13`, `src/main/gate/state.ts:23-24` |
| Вердикт worfy показывает chip-ом на Ticket-ах и Session-ах, а PR, его CI и review с GitHub — chip-ами только на Ticket-ах; Ticket «gate, PR, CI, verdict chips»; Session «its worktree's gate chip»; Canvas «the chips are on its Nodes» | `g.md:268`, `:271-281`, `src/renderer/canvas/badges/ChecksBadges.tsx:40-50`, `:61-68` |
| Worktree «a branch checked out»; Session берёт свой worktree | `g.md:300-303`, `src/shared/ipc/checks.ts:239` |
| GitHub «the PR, CI, the review mark» | `g.md:277-279`, `:313-318`, `src/main/github/prs.ts:22`, `:204` |
| Связь Session → Gate «runs it»; шаг 1: агент или hook из Harness запускает Gate в worktree | `g.md:13`, `:15-16`, `harness/hooks/hooks.json:62-79` |
| Шаг 2 и связи «gate chip»: вердикт green, red, not verified или nothing ran; worfy показывает chip на Ticket-е и Session; nothing ran никогда не green | `g.md:20-28`, `:105-107`, `:273-276`, `src/renderer/canvas/badges/ChecksBadges.tsx:41-48` |
| Шаг 3: пока последний run red, hook удерживает конец хода и говорит запустить Gate и исправить, не больше двух раз | `g.md:83-85`, `harness/hooks/stop.mjs:6`, `:32`, `:223-229` |
| Шаг 4 и связь «pushes, opens a PR»: агент открывает PR | `harness/skills/ship-ticket/step-8-pr-and-ci.md:14`, `harness/skills/ship-ticket/implementer-finish.md:5` |
| Шаг 4 и связь «PR, CI, verdict chips»: worfy читает PR, CI и review mark через gh, показывает их на Ticket-е, на GitHub ничего не меняет | `g.md:277-279`, `:317`, `:343-344`, `src/main/github/prs.ts:3`, `:450` |
| Шаг 5: что нужно для merge, говорит Profile — Gate full перед merge (на ветке Ticket-а, на каждом PR или на наборе PR-ов Wave) или итоговая проверка CI и review mark; в репозитории worfy — второе | `g.md:3-4`, `:173-183` |
| UTH, поток: Gate пишет исход run-а в папку состояния (не каждого: run, остановленный сигналом или с неизвестным profile, не пишет ничего — `g.md:32-36`) — marker-ы и файл вердикта («writes the outcome», «Gate state: markers, verdict-<tag>.json», «gate.mjs: scope, cache, scripts») | `g.md:113-116`, `:131`, `:139-147`, `harness/hooks/gate.mjs:44`, `:335` |
| UTH, поток: GateReader читает состояние для каждого worktree («markers, verdict, transcripts», «markers, verdict file», «Gate per worktree») | `g.md:287-294`, `:384`, `src/main/gate/state.ts:7-22`, `:143`, `:546` |
| UTH, поток: PrTracker — `gh pr list`, список PR-ов не чаще раза в 60 s («PR list at most once per 60 s»); «PR, CI, verdict» в checks.get | `g.md:326`, `:386`, `src/main/github/prs.ts:3`, `:35`, `:450` |
| UTH, поток: checks.get — readChecks, `git worktree list`; снимок в useChecks; useChecks «one copy, every 10 s in focus»; ChecksBadges «picks the worktree and PR» | `g.md:324-326`, `:361`, `:396-399`, `src/main/ipc/checks.ts:39-45`, `src/renderer/canvas/badges/use-checks.ts:29`, `:101`, `src/renderer/canvas/badges/ChecksBadges.tsx:87-88`, `:107` |
| UTH: marker важнее файла вердикта, потому что run без проверок не снимает red; вердикт о другом commit-е, чем HEAD, не берётся | `g.md:289-296` (HEAD — `:291`), `src/main/gate/state.ts:12-15` (порядок marker → файл) |
| UTH: renderer может спрашивать часто, когда запускать gh, решает один tracker в main, общий для badges, Autopilot и Stage | `g.md:360-362` |
| UTH: gh работает от `github.account` из Profile, если Profile его называет, иначе от аккаунта login shell; token не хранится | `g.md:338-339`, `:370-371`, `src/main/github/prs.ts:141-149`, `:161` |
| Таблица файлов: назначение каждого из семи | `g.md:131`, `:136`, `:382-389`; шапки самих файлов |
| Лимит: обычно проверяется только то, что отличается от origin/main; `GATE_SCOPE=all`, больше 50 commit-ов впереди или 300 позади — всё | `g.md:50-57`, `harness/hooks/gate.mjs:883-891` |
| Лимит: hook даёт Gate 900 секунд; ход с red удерживается не больше двух раз на Session и worktree | `g.md:15-16`, `:84`, `harness/hooks/hooks.json:68`, `:79`, `harness/hooks/stop.mjs:32` |
| Лимит: список PR-ов не чаще раза в 60 s на папку, после сбоев — до 32 минут, в нём 100 последних PR-ов; ветка Ticket-а не из списка — отдельный поиск, каждая не чаще раза в 5 минут | `g.md:326-331`, `src/main/github/prs.ts:3-6`, `:35-38`, `:460-468` |

**Снимки** (Playwright против сборки ветки, окно 1280×800; у каждого есть пара `-dark`):
[EN](../evidence/12-gate-and-github-en-light.png), [RU](../evidence/12-gate-and-github-ru-light.png),
[подсветка Gate](../evidence/12-gate-and-github-lit-en-light.png), [шаг 2](../evidence/12-gate-and-github-step-en-light.png),
[подсветка GitHub EN](../evidence/12-gate-and-github-lit-github-en-light.png) / [RU](../evidence/12-gate-and-github-lit-github-ru-light.png),
[шаг 4](../evidence/12-gate-and-github-step-4-en-light.png),
[reduced motion, RU](../evidence/12-gate-and-github-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/12-gate-and-github-under-the-hood-en-light.png) / [RU dark](../evidence/12-gate-and-github-under-the-hood-ru-dark.png),
[таблица файлов и лимиты EN](../evidence/12-gate-and-github-under-the-hood-files-en-light.png) / [RU](../evidence/12-gate-and-github-under-the-hood-files-ru-light.png),
[подсветка checks.get на потоке данных](../evidence/12-gate-and-github-flow-lit-en-light.png).
Контраст текста: каждый видимый текст Topic-а (HTML, подписи блоков, областей и связей обеих схем, до 99 текстов на
замер) против своего фона, обе темы, EN и RU — минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 нет ни одного.
Снимки сняты со сборки закоммиченной ветки без незакоммиченных правок (в шапке приложения версия без `.dirty`).

**Подписи связей.** Разовая проверка Playwright вне репозитория (удалена): наведение на каждый блок обеих схем и каждый
шаг проигрывателя, EN и RU, — 38 состояний, 74 подсвеченные подписи; ни одна не задевает другую подпись, блок, заголовок
области (THIS MACHINE, GITHUB, RENDERER…) или наконечник стрелки, и заголовки областей не задевают блоки (сравнение
bounding box). Первый прогон нашёл подпись «runs it, or a hook does» поверх блоков Gate и Session: подпись сокращена до
«runs it» (hook назван в шаге 1), Canvas, Ticket и Session сдвинуты вправо.

**Объём.** Простой уровень — 53 слова EN / 47 RU, шаги — 153 / 128; Under the hood (текст, таблица файлов и лимиты
вместе) — 170 / 160.

**Tokens.** Автор: около 150 тыс. токенов контекста (точного счётчика у агента нет; оценка по объёму прочитанного и
написанного). Проверка: заполняет ревьюер.

**Доработка после REJECTED (PR #1179, ревью medium).** Утверждения сужены до источника, EN и RU: список PR-ов читается не
чаще раза в 60 s, а ветка Ticket-а не из списка ищется отдельно, каждая не чаще раза в 5 минут (заметка PrTracker и
лимит); gh работает от `github.account` из Profile, только если Profile его называет, иначе от аккаунта login shell;
шаг 5 — Gate full «перед merge», а не «на ветке» (при `merge_gate` `wave` run идёт на наборе PR-ов Wave); summary и шаг 4:
chip-ы PR, CI и вердикта — только на Ticket-ах, на Session — только chip gate; поток данных: «исход run-а», а не «каждого
run-а». Исправлены три ссылки таблицы. Схема: GitHub и заголовок GITHUB опущены и сдвинуты вправо, подпись связи
GitHub → Ticket больше не закрывает заголовок; заголовки областей в RU — «Эта Machine», «GitHub», «Harness и GitHub», как
на Map of worfy. Проверка подписей теперь сравнивает их и с заголовками областей: на сборке до доработки она нашла ровно
находку ревью (подпись github->ticket на заголовке GITHUB при наведении на Ticket и GitHub и на шагах 4–5, EN и RU), на
промежуточной раскладке — подпись session->github на блоке Session; на итоговой — ничего. Добавлены снимки: наведение на
GitHub (EN, RU) и шаг 4.

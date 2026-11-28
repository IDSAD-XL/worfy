# Паритет с Claude Projects и встроенная память Claude — карта

Тема Product Session `claude-projects-parity`, начата 2026-11-28. Вход — PR #2270 «docs: Claude Projects parity and
native memory discovery proposal»: один файл `docs/claude-projects-parity-proposal.md` на ветке
`docs/claude-projects-parity-native-memory`. PR открыт 2026-11-26, на 2026-11-28 не влит, review и комментариев нет.
Сам документ называет себя так: «proposal for Product Session, not an accepted specification or implementation
authorization». Тесты не запускались, SDK и benchmark не проверялись — так сказано в описании PR. Копия документа без
правок — [brief.md](brief.md). PR закроет Orchestrator ([просьба](для-orchestrator-а-pr-2270.md)).

## Destination

Подтверждено владельцем 2026-11-28: «да».

Владелец решил по каждому направлению PR: брать, отложить или отклонить, и в каком порядке. Для первого принятого
направления в `drafts/` лежит черновик Epic-а (первая строка под заголовком — `Advisor draft`), и его разобрал критик.
Другой допустимый финал: владелец решил ничего из PR не брать, и это решение записано здесь.

## Notes

- Skills темы: `worfy:grilling` и `worfy:domain-modeling` для вопросов; `worfy:research` для фактов, заметки — в этой
  папке; `worfy:prototype` — один HTML-файл в этой папке; `worfy:to-spec` для черновика; `worfy:critic` перед приёмкой.
- Направления PR, как их называет документ:
  1. P0 — Project Conversation и smart routing: один постоянный разговор на Project, который сам отвечает,
     передаёт просьбу в уже идущую Session или начинает новую работу.
  2. P0 — Canvas и Library: режим без Canvas на пробу, обзор работы Project-а, каталог Card-ов и файлов.
  3. P0 — Native Memory (Claude first): встроенная auto memory Claude Code, сначала discovery spike, потом UI памяти.
  4. P0 — Scheduled Tasks: задачи по расписанию и по событию поверх Assistant-а и Autopilot.
  5. P1 — Session convenience parity: /btw, /fork, snooze, архив, пауза Project-а, расход по Session и Ticket-у и др.
  6. P1 — Smart onboarding: worfy читает репозиторий и предлагает Profile, интеграции и первые задачи.
  7. P1 — Headless execution и mobile companion: работа без включённого Mac, телефон как пульт.
  8. P1/P2 — области памяти, синхронизация между машинами, отбор памяти и Harness Eval; постоянный аудит changelog-ов
     конкурентов.
- Ограничения: репозиторий публичный — в файлах темы нет имён людей, адресов и рабочих Project-ов владельца.
  Аналитики использования нет. «Tester observation» из PR в репозитории не записано. На вопрос о тестерах владелец
  ответил 2026-11-28: «на канвасе легко потеряться, в кучу смешанна информация и по видимому антропик выбрала более
  удобный и выверенный вариант UX». К ответу он приложил три скриншота боковой панели Claude Projects:
  - вкладка Threads: полоса Artifacts с миниатюрами и thread-ы по группам состояния (Idle, Resolved);
  - вкладка Context: Instructions, Memory, Files, Artifacts;
  - вкладка Custom view: «Pin an artifact to see it here, or ask Claude to make one, like a dashboard, a checklist or
    a weekly digest»;
  - меню «+» добавляет вкладки Scheduled tasks и Custom view.
- Заметки темы, 2026-11-28 (main `c66e7215a`):
  - [research-claude-projects-и-память-claude-code.md](research-claude-projects-и-память-claude-code.md) — что
    Anthropic документирует о Claude Projects, auto memory и Agent SDK;
  - [research-память-claude-в-worfy-сейчас.md](research-память-claude-в-worfy-сейчас.md) — как auto memory работает
    в worfy сейчас: код, runtime, файлы на диске;
  - [research-что-уже-есть-разговор-library-удобства.md](research-что-уже-есть-разговор-library-удобства.md) —
    направления 1, 2 и 5 против того, что уже есть в worfy;
  - [research-что-уже-есть-расписание-onboarding-headless.md](research-что-уже-есть-расписание-onboarding-headless.md)
    — направления 4, 6, 7 и 8 против того, что уже есть, и для кого worfy по roadmap.
- Главные факты, перепроверены советником:
  - Claude Projects существует: https://code.claude.com/docs/en/claude-projects, public beta на Pro, Max и Ultra,
    блог Anthropic датирует выход 2026-09-17. Работает в claude.ai/code, desktop app и мобильном приложении, не в
    terminal CLI. Один разговор на Project. Claude сам заводит thread на задачу — облачную Session или Session на своём
    компьютере через Remote Control. Есть панель Overview с группами Ready for review, Waiting on you, Working,
    Landing, Idle, Resolved. Облачные thread-ы не запускают hook-и, правила permissions и `env` из
    `.claude/settings.json` и не грузят `.mcp.json`. Project принадлежит одному пользователю, поделиться им нельзя.
  - Исследование конкурентов от 2026-11-13 уже описывало Projects: «разговор-координатор, который раздаёт работу
    параллельным threads» (`docs/research/2026-11-13-competitors/README.md:174`).
  - Auto memory Claude Code в worfy уже включена. Session получают preset `claude_code` и `settingSources` user,
    project, local (`src/main/vendors/claude/options.ts:793-794`). В папке памяти основного checkout 177 файлов.
    Индекс `MEMORY.md` — 107 строк при пределе 200 строк или 25 KB. Все worktree одного репозитория пишут в одну
    папку. UI памяти Claude в worfy нет, ADR об auto memory нет.
  - Индекс памяти приходит в каждую Session и в каждый Subagent вместе с `CLAUDE.md`, под шапкой «These instructions
    OVERRIDE any default behavior». В последних 20 transcript-ах Subagent-ов основного checkout он есть во всех 20.
    Запись `.md` в папку памяти runtime пускает без вопроса, и `canUseTool` worfy её не видит.
  - Для кого worfy по roadmap: product owner, который один ведёт продукт (`docs/roadmap.md:388-389`). Этап E4 «Для
    других людей» начинается только с первым внешним пользователем (`docs/roadmap.md:454`). Аналитика продукта — «не
    в направлении» (`docs/roadmap.md:438`).
  - Session-ы Claude desktop работали в worktree-ах репозитория worfy на этом Mac до 2026-11-26. Последние записи
    transcript-ов 19 ключей `.claude/worktrees` датированы 2026-11-10 — 2026-11-26.

## Decisions so far

Раунд вопросов 2026-11-28; узлы решений — на Mind map темы.

- Финал темы подтверждён (Q1): «да».
- Для кого паритет (Q2): аудитория не меняется. Из PR берём то, что мешает владельцу и двум пользователям, а паритет
  для новичков ждёт этапа E4. Ответ: «да».
- Что владелец делал в Claude desktop (Q3): «тестировал Claude Projects, фактически не делал ничего».
- Canvas (Q4): ответ владельца и скриншоты панели Claude Projects — в Notes выше.
- Память (Q6): идёт первой из направлений темы. Блокирующий spike из PR убран. P0 — три части: правила Harness о том,
  что писать в память; guard на запись памяти из Session без человека; вид Memory в worfy. Ответ: «да».
- PR #2270 (Q7): документ скопирован в [brief.md](brief.md), PR закроет Orchestrator. Ответ: «да».

Раунд 2, 2026-11-28, ответ владельца на все вопросы: «все да».

- Пять направлений уходят из темы (Q5), подробности — в Out of scope ниже.
- Панель Project-а (Q8): прототип одним HTML-файлом. Окно открывается на разговоре Orchestrator-а с боковой панелью;
  Canvas остаётся видом, но не стартовым.
- Guard памяти (Q9): в Session без человека (Autopilot) запись в память получает отказ, заметка идёт в отчёт.
- Вид памяти (Q10): отдельный компонент, сначала в Settings рядом с Settings → Assistant → Memory.
- Разговор Project-а (Q11): это сам Orchestrator, глоссарий не меняется. Нового три вещи: follow-up свободным текстом
  в связанную Session, `@Session`, разговор, который переживает смену Session Orchestrator-а.
- Черновик Epic-а памяти: [drafts/worfy-memory.md](drafts/worfy-memory.md), 7 Ticket-ов в 4 Wave-ах.

Раунд 3, 2026-11-28, ответ владельца: «принимаю».

- Критик разобрал черновик `worfy-memory` ([разбор](../critic/worfy-memory-2026-11-28.md), вердикт Keep). Владелец
  принял все три возражения:
  - guard решает, есть ли в Session человек, на каждом вызове (Q12);
  - память читается так же, как её читает runtime: знаки, а не байты; имена папок с hash; база из env (Q13);
  - связь с Ticket-ом 06 Epic-а `worfy-harness-guarantees`; строку в его spec дописывает Orchestrator
    ([просьба](для-orchestrator-а-harness-guarantees-06.md)) (Q14).
- Черновик `worfy-memory` принят с этими правками (Q15). Финал темы для направления «память» достигнут. Разговор
  Project-а и панель ждут прототипа.
- Прототип панели готов: [prototype-панель-project-а.html](prototype-панель-project-а.html), один файл, открывается
  двойным щелчком. Три варианта, переключаются полосой внизу или `?variant=a|b|c`:
  - A — разговор слева, справа панель с вкладками Work, Epics, Context, Pinned Card и «+»;
  - B — разговор слева, справа одна колонка без вкладок: сначала то, что ждёт владельца;
  - C — узкий список работы слева, разговор в центре, детали выбранного справа; адресат сообщения выбирается явно.

  Тема сохраняется после прототипа: «ждем прототип и вот тогда сохрани» (2026-11-28).

## Not yet specified

- Где проходит граница между Assistant-ом и Orchestrator-ом внутри Project-а. Assistant уже будит Orchestrator и
  продолжает Session-ы внутри Project-а (`docs/features/assistant.md:225`), а разговор Project-а теперь — Orchestrator.
- Как follow-up свободным текстом находит свою Session: по Binding-у (связь Session с Ticket-ом), по словам или
  моделью, и что видит владелец, когда адрес неясен.
- Какой вариант панели брать и сколько в ней Library — после того, как владелец посмотрит прототип.

## Out of scope

Решение Q5, 2026-11-28: эти направления PR живут вне темы.

- Задачи по расписанию → Assistant. После приёмки Assistant-а (`worfy-assistant`, Ticket 20) тема `proactive-runtime`
  получает вопрос о задачах пользователя по расписанию. Туда же ушёл вопрос, может ли такая задача запускать Session
  без щелчка.
- Умный onboarding → этап E4. Строку в темы E4 добавляет Orchestrator ([описание](для-orchestrator-а-roadmap.md)).
- Работа без Mac и телефон → направления 1 и 2 от 2026-11-14, своя тема Product Session. Устаревшую строку
  «управление с телефона» Orchestrator убирает из roadmap ([описание](для-orchestrator-а-roadmap.md)).
- Harness Eval и сравнение с Claude Code → план `worfy-harness-eval` и Ticket `worfy-harness` 52. Сбор повторяющихся
  поправок → отложенный Epic `worfy-lessons-loop`.
- Удобства Session → четыре Ticket-а в `worfy-polish` ([описание](для-orchestrator-а-polish.md)). Не берём перезапуск
  координатора без исполнителей, экспорт и sharing, resolve/reopen. Расход по Session уходит в `worfy-limits-ledger`.

# 36: Rework of worfy-product-session 27, item 9

Type: task
Status: open
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-product-session 27, item 9 — 27-кнопки-полосы-и-шапка-как-в-прототипе.md

**What to build:** the owner checked item 9 of worfy-product-session 27 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Real turn, 1160 px: panels 300 px, chat 333→229 px, one at a time; Critic, Drafts fine. Escape after reopening Agents did not close it; Idea generator showed «No idea generator in this Session yet» though the skill ran.

## Что происходит

После настоящего хода advisor-а: Esc после повторного открытия панели Agents её не закрывает; панель Idea generator показывает «No idea generator in this Session yet», хотя advisor запускал skill.

## Где в коде

Панели rail Product Session (Agents, Critic, Idea generator, Drafts): `src/renderer/product/` — обработчик Esc панели и источник списка запусков idea generator.

## Готово, когда

- [ ] (вручную) Сделай: нажми по очереди Critic, Idea generator, Drafts, щёлкни черновик, потом ещё раз Drafts; затем Agents, «›», снова Agents и Escape → Должно быть: каждая кнопка открывает свою панель в колонке 300 px, чат сужается, но не закрыт; Critic — строка состояния с числом возражений, имя файла и отзыв; Idea generator — задание, состояние, ответ; Drafts — черновик хода, по щелчку его текст; повторный щелчок, «›» и Escape сворачивают; открыта одна панель.
  - needs: mac stable

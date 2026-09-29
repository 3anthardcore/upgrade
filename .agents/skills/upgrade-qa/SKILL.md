---
name: upgrade-qa
description: Проверить артефакты, исходный scope, маршруты и готовность проекта Upgrade. Использовать для независимой приёмки, QA-отчёта и разграничения локальных тестов и настоящего Битрикс.
---

# Независимая проверка

Автор результата не принимает его сам. Читай актуальные `docs/requirements-tests.md` и `status --project ID`, проверь хеши входов и артефактов.

```bash
npm run check
npm test
npm run test:e2e
npm run upgrade -- verify --project ID --target-url 'https://demo.example.org'
npm run upgrade -- report --project ID
```

Подставляй действующий разрешённый адрес демо; исходный сайт не подменяет целевой. Без target URL HTTP-проверки NOT_RUN. Полноту считать по immutable scope, сохраняя отсутствующие/ошибочные URL в знаменателе. Проверять title/H1 недостаточно для фактического контента, каталога или сценариев.

`npm run test:agents` — отдельный реальный тест двух Codex CLI процессов, расходующий доступный бюджет. Не повторяй его при неизменном адаптере без причины. Проверяй report, task IDs, overlap, SHA-256 и независимого reviewer; имитатор unit-теста AT-22 не заменяет.

Для задачи подготовь массив фактических Check `{id,status,details}` и используй `task review --project ID --task TASK --reviewer REVIEWER --decision accept --report checks.json` либо `--decision reject --reason TEXT`. Не превращай NOT_RUN в PASS; отсутствие Битрикс, admin editing, изоляции, backup restore или обязательного сценария запрещает DEMO_READY.

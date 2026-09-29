---
name: upgrade-import
description: Проверить и выполнить контролируемый импорт пакета Upgrade в отдельный Битрикс, сверяя неизвестные записи до повтора. Использовать для validate, dry-run, reconcile и шлюза единственного писателя.
---

# Импорт и сверка

Сначала `npm run upgrade -- import --project ID --dry-run`. Эта команда проверяет локальный пакет; она не выполняет PHP или записи в Битрикс. `--apply --environment demo` пока возвращает BLOCKED. Не обходи этот статус повторными вызовами.

Реальный исполняемый PHP-интерфейс — `bitrix/importer/cli.php` (в релизе `code/importer/cli.php`). Подготовь проверенный пакет и SHA-256 его `manifest.json` из доверенного реестра:

```bash
php bitrix/importer/cli.php --command=validate --package='/absolute/release' --project='site-id' --manifest-sha256='TRUSTED_MANIFEST_SHA256'
```

Это шаблон команды: все значения должны быть фактическими. `validate` не загружает Битрикс. Для `dry-run`, `claim`, `reconcile`, `apply` дополнительно нужны `--document-root`, `--state-dir`, окружение `UPGRADE_DEMO=1`, совпадающий `UPGRADE_PROJECT_ID` и установленный `upgrade.core`. Прочитай актуальный cli.php перед использованием; `apply` требует owner/fencing token и валидный `--backup-receipt`.

После неизвестного результата сначала `--command=reconcile` с тем же пакетом и назначением. Не выдавай новую запись только потому, что клиент не получил ответ. Целевую БД изменяет один gateway. Правки владельца не затираются молча; конфликт фиксируется отдельно. Не восстанавливай production из демо-снимка. До доступа к настоящему Битрикс протокол fixture — только локальное доказательство, а импорт Битрикс NOT_RUN.

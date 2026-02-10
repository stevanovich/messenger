# Тестовые файлы для отладки

Эта папка содержит все тестовые файлы для проверки работоспособности мессенджера.

## Список тестовых файлов

### 1. `test_db.php`
Проверка подключения к базе данных и наличия всех необходимых таблиц.

**Использование:**
```
https://your-domain.example/messenger/test/test_db.php
```

### 2. `test_session.php`
Проверка работы сессий PHP.

**Использование:**
```
https://your-domain.example/messenger/test/test_session.php
```

### 3. `test_paths.php`
Проверка путей и конфигурации. Автоматически создает недостающие папки.

**Использование:**
```
https://your-domain.example/messenger/test/test_paths.php
```

### 4. `test_api.php`
Проверка API endpoints и их структуры.

**Использование:**
```
https://your-domain.example/messenger/test/test_api.php
```

### 5. `test_js_files.php`
Проверка наличия и доступности всех JavaScript и CSS файлов.

**Использование:**
```
https://your-domain.example/messenger/test/test_js_files.php
```

### 6. `test_logs.php`
Проверка настроек логирования PHP и веб-сервера.

**Использование:**
```
https://your-domain.example/messenger/test/test_logs.php
```

### 7. `phpinfo.php`
Полная информация о конфигурации PHP.

**Использование:**
```
https://your-domain.example/messenger/test/phpinfo.php
```

**⚠️ ВАЖНО:** Удалите этот файл после проверки в продакшене!

### 8. `check-php-pdo-mysql.sh`
Скрипт для NAS: в каком PHP из `/usr/local/etc/` настроен pdo_mysql. Запуск на NAS: `sh test/check-php-pdo-mysql.sh`.

**Если ошибка `syntax error near unexpected token do\r'`** — в файле переводы строк в формате Windows (CRLF). На NAS выполните один раз:
```bash
sed -i 's/\r$//' test/check-php-pdo-mysql.sh
```

## Как использовать

1. Откройте любой тестовый файл в браузере
2. Проверьте результаты тестирования
3. Исправьте обнаруженные проблемы
4. После завершения отладки удалите `phpinfo.php` для безопасности

## Подробная информация

Подробный отчет о всех проверках находится в файле `DEBUG_REPORT.md` в корне проекта.

# Веб-мессенджер

Современный веб-мессенджер с функциями популярных мессенджеров (Telegram, WhatsApp, Viber).

## Технологический стек

- **Backend**: PHP 7.3+
- **Frontend**: JavaScript (Vanilla ES6+)
- **База данных**: MySQL
- **Стили**: CSS3 (адаптивный дизайн)

## Возможности

### Основные функции
- ✅ Регистрация и авторизация пользователей
- ✅ Личные чаты (1-на-1)
- ✅ Групповые чаты
- ✅ Отправка текстовых сообщений
- ✅ Загрузка изображений и документов
- ✅ Редактирование и удаление сообщений
- ✅ Real-time обновления: **WebSocket** (новые сообщения, реакции, список бесед); при недоступности WebSocket — **polling** каждые 2 секунды (fallback)
- ✅ **Сквозное шифрование (E2EE)** — сообщения шифруются на клиенте; разблокировка чатов по WebAuthn или PIN; резерв ключей на сервере (опционально)

### UX функции
- ✅ Список контактов — вкладка «Контакты» в боковой панели, выбор контакта для чата
- ✅ Новый чат — модальное окно с поиском пользователя и выбором для личного чата
- ✅ Реакции на сообщения (эмодзи) — правый клик / долгое нажатие по сообщению
- ✅ Стикеры — панель стикеров, отправка эмодзи-стикеров
- ✅ Жесты (свайпы) — свайп по чатам и сообщениям, долгое нажатие для реакций
- ✅ Эмодзи панель — вставка эмодзи в поле ввода
- ✅ Вставка изображения из буфера обмена (Ctrl+V в поле ввода чата)

### Админ-панель
- ✅ Статистика использования — дашборд, сообщения за 7 дней
- ✅ Тепловые карты кликов — по страницам за выбранный период
- ✅ Аналитика событий — список событий с фильтром по типу
- ✅ Резерв ключей E2EE — настройка защиты ключей (лимиты, блокировки), раздел «Защита ключей» в админке

## Установка

### 1. Клонирование и зависимости

```bash
git clone <url-репозитория> messenger
cd messenger
composer install
```

### 2. Требования
- PHP 7.3 или выше
- MySQL 5.7 или выше
- Apache с mod_rewrite (или другой веб-сервер)
- Расширения PHP: PDO, PDO_MySQL, GD (для работы с изображениями)

### 3. Настройка конфигурации

1. Скопируйте шаблоны и заполните настройки:

```bash
cp config/config.example.php config/config.php
cp config/database.example.php config/database.php
```

2. Отредактируйте `config/database.php` — укажите host, dbname, username и пароль БД (файл не должен попадать в репозиторий).
3. Отредактируйте `config/config.php` — укажите BASE_URL, ADMIN_URL, OAuth-ключи (Google, Yandex), VAPID для push (см. `tools/generate_vapid_keys.php`), ADMIN_UUIDS. Секреты храните только в config.php, не коммитьте их в Git.
4. При использовании E2EE: скопируйте `config/e2ee_key_backup.example.php` в `config/e2ee_key_backup.php` и при необходимости настройте лимиты и блокировки (редактируется также из админки — раздел «Защита ключей»).

### 4. Настройка базы данных

1. Создайте базу данных и пользователя MySQL с правами на неё
2. Импортируйте схему:

```bash
mysql -u <user> -p <database> < sql/schema.sql
```

3. При обновлении с более старой версии примените миграции из `sql/migrations/` (например `002_add_conversation_member_keys.sql` и др.). Для E2EE предусмотрены скрипты `tools/run_e2ee_migration.php` и `tools/run_e2ee_migration_002.php` (запускать при необходимости по инструкциям в миграциях).
4. Узнайте UUID администратора: зарегистрируйтесь, войдите и откройте `/api/auth.php?action=me` — добавьте UUID в `ADMIN_UUIDS` в `config/config.php`

**Публикация на GitHub без секретов.** Файлы с секретами (`config/config.php`, `config/database.php` и др.) перечислены в `.gitignore`: они не должны попадать в публичный репозиторий. В своей рабочей ветке (например `master`) вы можете хранить их в Git для работы и пуша на свой сервер (origin). Чтобы публиковать код на GitHub без секретов: пушите туда отдельную ветку (например `main`), в которой эти файлы не закоммичены — создайте ветку из текущей, выполните `git rm --cached config/config.php config/database.php config/e2ee_key_backup.php config/reset_admin_password.php`, закоммитьте и пушьте эту ветку в GitHub.

### 5. Настройка прав доступа

Создайте папки для загрузок (в т.ч. аватаров) и дайте веб-серверу право на запись:

```bash
mkdir -p uploads/images uploads/documents uploads/avatars uploads/stickers
chmod 755 uploads uploads/images uploads/documents uploads/avatars
```

Пользователь, от которого работает веб-сервер (например `www-data`, `nginx`, `apache`), должен иметь право записи в эти папки. Если загрузка аватара возвращает 400 с сообщением про права:

- Проверьте: `ls -la uploads/` — владелец и права (рекомендуется 755 или 775).
- Назначьте владельца: `sudo chown -R <пользователь_веб_сервера> uploads/`
- Или откройте запись для группы: `chmod 775 uploads uploads/avatars uploads/images uploads/documents`

### 6. Настройка веб-сервера

#### Apache

Убедитесь, что включен mod_rewrite. Файл `.htaccess` уже настроен.

#### Nginx

Добавьте в конфигурацию:

```nginx
location / {
    try_files $uri $uri/ /index.php?$query_string;
}

location ~ \.php$ {
    fastcgi_pass unix:/var/run/php/php7.3-fpm.sock;
    fastcgi_index index.php;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}
```

### 7. WebSocket (опционально)

Для доставки обновлений в реальном времени (без ожидания интервала polling) можно запустить WebSocket-сервер из папки `websocket/` (Ratchet). Без него мессенджер работает в режиме polling (запросы каждые 2 секунды). Подробности и настройка прокси — в `websocket/docs/` (в т.ч. WEBSOCKET_NAS_SETUP.md, WEBSOCKET_TRANSITION_PLAN.md).

## Использование

1. Откройте мессенджер в браузере по адресу вашего сайта (например `https://your-domain.example/` или `http://localhost/messenger/`)
2. Зарегистрируйте нового пользователя
3. Войдите в систему
4. Создайте новый чат или начните общение

5. Админ-панель: откройте `BASE_URL/admin/` (доступ только для пользователей, чей UUID указан в `ADMIN_UUIDS` в config.php)

## Структура проекта

```
messenger/
├── admin/              # Админ-панель (доступ по правам, см. config: ADMIN_UUIDS), key_backup.php — резерв ключей E2EE
├── api/                # API endpoints
│   ├── auth.php
│   ├── keys.php        # E2EE: публичные ключи, key_backup, decryption_failed, limits
│   ├── messages.php
│   ├── conversations.php
│   ├── users.php
│   ├── analytics.php
│   ├── upload.php
│   ├── reactions.php
│   ├── stickers.php
│   ├── calls.php
│   └── ...
├── assets/
│   ├── css/            # Стили
│   └── js/             # JavaScript (в т.ч. e2ee-keys.js, e2ee-webauthn-lock.js)
├── auth/               # OAuth (Google, Yandex)
├── config/             # Конфигурация (config.php, database.php, e2ee_key_backup.php — из *.example)
├── includes/           # Вспомогательные файлы
├── sql/
│   ├── schema.sql      # Схема БД
│   └── migrations/     # Миграции (E2EE и др.)
├── uploads/            # Загруженные файлы
├── websocket/          # WebSocket-сервер
├── docs/               # Документация и планы
├── index.php
├── login.php
├── register.php
├── logout.php
├── call-room.php       # Страница звонка
├── join-call.php
├── join-conversation.php
└── sw.js               # Service Worker (push)
```

## API Endpoints

### Авторизация
- `POST /api/auth.php?action=register` - Регистрация
- `POST /api/auth.php?action=login` - Вход
- `POST /api/auth.php?action=logout` - Выход
- `GET /api/auth.php?action=me` - Текущий пользователь

### Беседы
- `GET /api/conversations.php` - Список бесед
- `GET /api/conversations.php?id=X` - Одна беседа (с участниками и `my_role` для группы)
- `POST /api/conversations.php` - Создание беседы
- `POST /api/conversations.php` (body: `action=add_participants`, `conversation_id`, `user_uuids[]`) - Добавить участников в группу (только админ)
- `DELETE /api/conversations.php?id=X` - Скрыть беседу для себя
- `DELETE /api/conversations.php?id=X&user_uuid=Y` - Исключить участника из группы или выйти из группы

### Сообщения
- `GET /api/messages.php?conversation_id=X&last_message_id=Y&limit=50` - Получение сообщений
- `POST /api/messages.php` - Отправка сообщения (в т.ч. type=sticker)
- `PUT /api/messages.php?id=X` - Редактирование сообщения
- `DELETE /api/messages.php?id=X` - Удаление сообщения

### Реакции
- `POST /api/reactions.php` - Добавить/снять реакцию (body: message_id, emoji)
- `GET /api/reactions.php?action=emoji_list` - Список эмодзи для реакций (публичный)
- `DELETE /api/reactions.php?id=X` - Удалить реакцию по ID

### Ключи E2EE
- `GET /api/keys.php` - Публичный ключ текущего пользователя или по `user_uuid`
- `POST /api/keys.php` - Сохранить свой публичный ключ
- `GET /api/keys.php?action=key_backup` - Получить зашифрованный резерв ключей (при разблокировке)
- `GET /api/keys.php?action=limits` - Лимиты и параметры защиты ключей (для клиента)
- `GET /api/keys.php?action=group_key&conversation_id=X` - Ключ группы для участника беседы
- `POST /api/keys.php` (action: save_key_backup, decryption_failed) - Сохранить резерв ключей / сообщить о неудачной расшифровке

### Стикеры
- `GET /api/stickers.php` - Список стикеров
- `GET /api/stickers.php?action=categories` - Категории стикеров
- `POST /api/stickers.php?action=favorite` - Добавить стикер в избранное (body: sticker_id)

### Пользователи
- `GET /api/users.php?action=search&q=query` - Поиск пользователей
- `GET /api/users.php?action=contacts` - Список контактов (все пользователи кроме текущего)
- `GET /api/users.php?id=X` - Информация о пользователе

### Загрузка файлов
- `POST /api/upload.php` - Загрузка файла

### Аналитика
- `POST /api/analytics.php?action=event` - Отправка события
- `POST /api/analytics.php?action=click` - Отправка клика

## Безопасность

- Пароли хешируются с помощью `password_hash()`
- Защита от SQL-инъекций через prepared statements
- Защита от XSS через `htmlspecialchars()`
- Валидация загружаемых файлов
- Ограничение размера файлов
- **E2EE:** сообщения шифруются на клиенте; сервер хранит только зашифрованный текст и публичные ключи; ключи расшифровки не передаются на сервер. Разблокировка чатов — по WebAuthn или PIN.

## Разработка

Документация и планы — в папке `docs/`.

## Лицензия

Распространяется под лицензией MIT. Подробности — в файле [LICENSE](LICENSE).

## Продакшен

- **Папка `test/`** содержит отладочные скрипты (проверка БД, сессии, API). На продакшене не открывайте её в браузере: скрипты подключают реальный `config/database.php` и могут раскрыть структуру БД или сессии. В `.htaccess` добавлено правило, запрещающее доступ к `test/` (HTTP 403). Если веб-сервер не Apache или правило не срабатывает — закройте доступ к `test/` в конфигурации сервера или не размещайте эту папку на публичном сайте.

## Поддержка

При возникновении проблем проверьте:
1. Настройки базы данных в `config/database.php`
2. Права доступа к папке `uploads/`
3. Логи ошибок PHP и веб-сервера

### Ошибка 403 Forbidden

Если при открытии сайта возвращается 403, веб-сервер не может прочитать файлы. На Synology он обычно работает от пользователя `http`.

**Признак:** в `ls -la` точки входа принадлежат `root` и имеют права `600` (например `index.php`).

**Исправление** (на сервере, из корня проекта):

```bash
# Вариант 1 — скрипт (указать пользователя веб-сервера, по умолчанию http)
sudo sh tools/fix-permissions.sh

# Вариант 2 — вручную только точки входа
sudo chown http:users index.php login.php register.php logout.php call-room.php join-call.php join-conversation.php
sudo chmod 644 index.php login.php register.php logout.php call-room.php join-call.php join-conversation.php
```

После деплоя через `git pull` или копирование от root снова проверяйте владельца и права и при необходимости запускайте `fix-permissions.sh`.

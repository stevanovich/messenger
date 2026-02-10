<?php
session_start();
require_once __DIR__ . '/../includes/functions.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'];
$currentUserUuid = getCurrentUserUuid();
global $pdo;

switch ($method) {
    case 'POST':
        $action = $_GET['action'] ?? '';
        
        if ($action === 'event') {
            // Отправка события
            $data = json_decode(file_get_contents('php://input'), true);
            $eventType = $data['event_type'] ?? '';
            $eventData = $data['event_data'] ?? null;
            $coordinatesX = $data['coordinates_x'] ?? null;
            $coordinatesY = $data['coordinates_y'] ?? null;
            $screenSize = $data['screen_size'] ?? null;
            
            if (empty($eventType)) {
                jsonError('Не указан тип события');
            }
            
            $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? null;
            $eventDataJson = $eventData ? json_encode($eventData, JSON_UNESCAPED_UNICODE) : null;
            
            $stmt = $pdo->prepare("
                INSERT INTO analytics_events 
                (user_uuid, event_type, event_data, coordinates_x, coordinates_y, user_agent, screen_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $currentUserUuid,
                $eventType,
                $eventDataJson,
                $coordinatesX,
                $coordinatesY,
                $userAgent,
                $screenSize
            ]);
            
            jsonSuccess(null, 'Событие записано');
        } elseif ($action === 'click') {
            // Отправка клика для тепловой карты (viewport, zone, координаты в зоне)
            $data = json_decode(file_get_contents('php://input'), true);
            $page = $data['page'] ?? '';
            $x = (int)($data['x'] ?? 0);
            $y = (int)($data['y'] ?? 0);
            $element = $data['element'] ?? null;
            $viewportWidth = isset($data['viewport_width']) ? (int)$data['viewport_width'] : null;
            $viewportHeight = isset($data['viewport_height']) ? (int)$data['viewport_height'] : null;
            $zone = isset($data['zone']) && $data['zone'] !== '' ? (string)$data['zone'] : null;
            $zoneX = isset($data['zone_x']) ? (int)$data['zone_x'] : null;
            $zoneY = isset($data['zone_y']) ? (int)$data['zone_y'] : null;
            $zoneWidth = isset($data['zone_width']) ? (int)$data['zone_width'] : null;
            $zoneHeight = isset($data['zone_height']) ? (int)$data['zone_height'] : null;
            
            if (empty($page)) {
                jsonError('Не указана страница');
            }
            
            try {
                $stmt = $pdo->prepare("
                    INSERT INTO analytics_clicks (user_uuid, page, x, y, element, viewport_width, viewport_height, zone, zone_x, zone_y, zone_width, zone_height)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                $stmt->execute([
                    $currentUserUuid, $page, $x, $y, $element,
                    $viewportWidth, $viewportHeight, $zone, $zoneX, $zoneY, $zoneWidth, $zoneHeight
                ]);
            } catch (PDOException $e) {
                // Таблица без новых колонок (миграция не выполнена) — сохраняем только базовые поля
                if ($e->getCode() == '42S22' || strpos($e->getMessage(), 'viewport_width') !== false) {
                    $stmt = $pdo->prepare("INSERT INTO analytics_clicks (user_uuid, page, x, y, element) VALUES (?, ?, ?, ?, ?)");
                    $stmt->execute([$currentUserUuid, $page, $x, $y, $element]);
                } else {
                    throw $e;
                }
            }
            
            jsonSuccess(null, 'Клик записан');
        } else {
            jsonError('Неизвестное действие');
        }
        break;
        
    default:
        jsonError('Метод не поддерживается', 405);
}

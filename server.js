// server.js - Основной серверный файл
'use strict';
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./Javascripts/config');

// Утилита для throttling
function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return function(...args) {
        if (!lastRan) {
            func.apply(this, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(() => {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(this, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    }
}

// Валидация данных
const validators = {
    team: (value) => value === 1 || value === 2,
    time: (value) => typeof value === 'number' && value >= 0,
    half: (value) => value === 1 || value === 2,
    position: (value) => value && typeof value.x === 'number' && typeof value.y === 'number',
    fontSize: (value) => typeof value === 'number' && value > 0 && value <= 20,
    scale: (value) => typeof value === 'number' && value > 0 && value <= 10
};

// HTTP сервер с улучшенной обработкой ошибок
const server = http.createServer((req, res) => {
    try {
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(__dirname, filePath);

        // Защита от path traversal
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error(`File read error: ${err.message}`);
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const ext = path.extname(filePath);
            const contentType = {
                '.html': 'text/html; charset=utf-8',
                '.css': 'text/css',
                '.js': 'text/javascript',
                '.mp4': 'video/mp4',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.ttf': 'font/ttf',
                '.otf': 'font/otf',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2'
            }[ext] || 'text/plain';

            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': ext.match(/\.(ttf|otf|woff|woff2)$/) ? 'public, max-age=31536000' : 'no-cache'
            });
            res.end(data);
        });
    } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500);
        res.end('Internal server error');
    }
});

const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    maxPayload: 10 * 1024 * 1024 // 10MB max
});

// === Улучшенное состояние ===
let state = {
    team1Score: 0,
    team2Score: 0,
    time: 0,
    timerRunning: false,
    currentHalf: 1,
    autoStop: true,
    isMuted: false,
    background: {
        image: null,
        position: { x: 0, y: 0 },
        scale: 1.0,
        fixed: false
    },
    positions: { ...CONFIG.DEFAULT_POSITIONS },
    fontSettings: { ...CONFIG.DEFAULT_FONT_SETTINGS }
};

const clients = new Set();

// === Обработка WebSocket соединений ===
wss.on('connection', (ws, req) => {
    clients.add(ws);
    console.log(`Подключено: ${clients.size} (IP: ${req.socket.remoteAddress})`);

    // Отправляем полное состояние новому клиенту
    sendToClient(ws, { type: 'full_state', state });
    broadcastFonts();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleCommand(data, ws);
        } catch (e) {
            console.error('Parse error:', e);
            sendToClient(ws, {
                type: 'error', 
                message: 'Некорректный JSON'
            });
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`Отключено. Осталось: ${clients.size}`);
    });

    // Ping-pong для поддержания соединения
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);
});

// === Улучшенная обработка команд с валидацией ===
function handleCommand(data, ws) {
    try {
        if (!data.command) {
            throw new Error('Команда не указана');
        }

        switch (data.command) {
            case 'add_goal':
                if (!validators.team(data.team)) {
                    throw new Error('Некорректная команда');
                }
                if (data.team === 1) state.team1Score++;
                if (data.team === 2) state.team2Score++;
                broadcast({ type: 'score_update', team1: state.team1Score, team2: state.team2Score });
                break;

            case 'undo_goal':
                if (!validators.team(data.team)) {
                    throw new Error('Некорректная команда');
                }
                if (data.team === 1) state.team1Score = Math.max(0, state.team1Score - 1);
                if (data.team === 2) state.team2Score = Math.max(0, state.team2Score - 1);
                broadcast({ type: 'score_update', team1: state.team1Score, team2: state.team2Score });
                break;

            case 'reset':
                if (!validators.half(data.half)) {
                    throw new Error('Некорректный тайм');
                }
                resetGame(data.half);
                break;

            case 'set_custom_time':
                if (!validators.time(data.time) || !validators.half(data.half)) {
                    throw new Error('Некорректное время или тайм');
                }
                state.time = data.time;
                state.currentHalf = data.half;
                state.timerRunning = false;
                broadcast({ type: 'full_state', state });
                break;

            case 'toggle_half':
                if (!validators.half(data.half)) {
                    throw new Error('Некорректный тайм');
                }
                toggleHalf(data.half);
                break;

            case 'toggle_mute':
                state.isMuted = !state.isMuted;
                broadcast({ type: 'mute_state', muted: state.isMuted });
                break;

            case 'toggle_auto_stop':
                state.autoStop = !state.autoStop;
                broadcast({ type: 'auto_stop_update', autoStop: state.autoStop });
                break;

            case 'update_element_position':
                if (!data.element || !validators.position(data.position)) {
                    throw new Error('Некорректные данные позиции');
                }
                updateElementPosition(data.element, data.position);
                break;

            case 'update_font_size':
                if (!data.element || !validators.fontSize(data.size)) {
                    throw new Error('Некорректный размер шрифта');
                }
                updateFontSize(data.element, data.size);
                break;

            case 'update_font_family':
                if (!data.element || !data.fontFamily) {
                    throw new Error('Некорректное семейство шрифтов');
                }
                updateFontFamily(data.element, data.fontFamily);
                break;

            case 'set_background':
                if (!data.image) {
                    throw new Error('Изображение не указано');
                }
                setBackground(data);
                break;

            case 'update_background_position':
                if (!validators.position({x: data.x, y: data.y})) {
                    throw new Error('Некорректная позиция фона');
                }
                updateBackgroundPosition(data.x, data.y);
                break;

            case 'update_background_size':
                if (!validators.scale(data.scale)) {
                    throw new Error('Некорректный масштаб');
                }
                updateBackgroundSize(data.scale);
                break;

            case 'toggle_background_fixed':
                state.background.fixed = !state.background.fixed;
                broadcast({ type: 'background_fixed_update', fixed: state.background.fixed });
                break;

            default:
                throw new Error(`Неизвестная команда: ${data.command}`);
        }

        // Автосохранение после каждой команды
        throttledSave();

    } catch (error) {
        console.error('Command error:', error.message);
        sendToClient(ws, {
            type: 'error',
            message: error.message
        });
    }
}

// === Вспомогательные функции ===
function resetGame(half) {
    state.team1Score = 0;
    state.team2Score = 0;
    state.timerRunning = false;
    state.currentHalf = half;
    
    if (half === 1) {
        state.time = 0;
    } else if (half === 2) {
        state.time = CONFIG.HALF_DURATION;
    }
    
    broadcast({ type: 'full_state', state });
}

function toggleHalf(half) {
    if (state.currentHalf === half) {
        state.timerRunning = !state.timerRunning;
    } else {
        state.currentHalf = half;
        state.timerRunning = true;
        state.time = half === 1 ? 0 : CONFIG.HALF_DURATION;
    }
    broadcast({ type: 'full_state', state });
}

function updateElementPosition(element, position) {
    if (!state.positions[element]) {
        state.positions[element] = { x: 0, y: 0 };
    }
    
    state.positions[element].x = position.x;
    state.positions[element].y = position.y;
    
    broadcast({
        type: 'element_position_update',
        element: element,
        position: position
    });
}

function updateFontSize(element, size) {
    if (!state.fontSettings[element]) {
        state.fontSettings[element] = { fontSize: 4, fontFamily: 'Arial' };
    }
    
    state.fontSettings[element].fontSize = parseFloat(size);
    broadcast({ 
        type: 'font_size_update', 
        element: element, 
        size: size 
    });
}

function updateFontFamily(element, fontFamily) {
    if (!state.fontSettings[element]) {
        state.fontSettings[element] = { fontSize: 4, fontFamily: 'Arial' };
    }
    
    state.fontSettings[element].fontFamily = fontFamily;
    broadcast({ 
        type: 'font_family_update', 
        element: element, 
        fontFamily: fontFamily 
    });
}

function setBackground(data) {
    state.background = {
        image: data.image,
        position: data.position || { x: 0, y: 0 },
        scale: data.scale || 1.0,
        fixed: data.fixed || false
    };
    broadcast({ type: 'background_update', background: state.background });
}

function updateBackgroundPosition(x, y) {
    state.background.position = { x, y };
    broadcast({ type: 'background_position_update', position: { x, y } });
}

function updateBackgroundSize(scale) {
    state.background.scale = scale;
    broadcast({ type: 'background_size_update', scale: scale });
}

// === Улучшенная рассылка ===
function sendToClient(client, message) {
    if (client.readyState === WebSocket.OPEN) {
        try {
            client.send(JSON.stringify(message));
        } catch (error) {
            console.error('Send error:', error);
            clients.delete(client);
        }
    }
}

function broadcast(message) {
    const data = JSON.stringify(message);
    const deadClients = [];
    
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(data);
            } catch (error) {
                console.error('Broadcast error:', error);
                deadClients.push(client);
            }
        } else {
            deadClients.push(client);
        }
    });
    
    // Удаляем мертвые соединения
    deadClients.forEach(client => clients.delete(client));
}

// === Управление шрифтами ===
let availableFonts = [];
const fontCache = new Map();

function loadFonts() {
    try {
        if (!fs.existsSync(CONFIG.FONTS_DIR)) {
            console.log(`Папка ${CONFIG.FONTS_DIR} не найдена. Создайте её для загрузки шрифтов.`);
            availableFonts = [];
            return;
        }

        const files = fs.readdirSync(CONFIG.FONTS_DIR);
        const fontExtPattern = new RegExp(`\\.(${CONFIG.FONT_EXTENSIONS.map(ext => ext.slice(1)).join('|')})$`, 'i');
        
        availableFonts = files
            .filter(file => fontExtPattern.test(file))
            .map(file => {
                const name = path.basename(file, path.extname(file));
                const fontFamily = name
                    .replace(/[^a-zA-Zа-яА-Я0-9]/g, ' ')
                    .split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join('')
                    .trim() || 'CustomFont';

                const fontData = {
                    file: file,
                    fontFamily: fontFamily,
                    path: `/fonts/${file}`
                };
                
                fontCache.set(fontFamily, fontData);
                return fontData;
            });

        console.log(`Загружено шрифтов: ${availableFonts.length}`);
        availableFonts.forEach(f => console.log(`  - ${f.fontFamily} → ${f.path}`));
    } catch (error) {
        console.error('Font loading error:', error);
        availableFonts = [];
    }
}

function broadcastFonts() {
    broadcast({ type: 'available_fonts', fonts: availableFonts });
}

// === Таймер с улучшенной логикой ===
let timerInterval = setInterval(() => {
    if (state.timerRunning) {
        state.time++;

        // Проверка на окончание тайма
        const isFirstHalfEnd = state.currentHalf === 1 && state.time >= CONFIG.HALF_DURATION;
        const isSecondHalfEnd = state.currentHalf === 2 && state.time >= CONFIG.FULL_MATCH_DURATION;
        
        if ((isFirstHalfEnd || isSecondHalfEnd) && state.autoStop) {
            state.timerRunning = false;
            console.log(`${state.currentHalf}-й тайм завершён`);
            broadcast({ type: 'full_state', state });
        } else {
            broadcast({ type: 'time_update', time: state.time });
        }
    }
}, CONFIG.TIMER_INTERVAL);

// === Сохранение состояния ===
function saveState() {
    try {
        const backupData = {
            ...state,
            timestamp: new Date().toISOString(),
            version: '2.0'
        };
        
        fs.writeFileSync(CONFIG.STATE_BACKUP_FILE, JSON.stringify(backupData, null, 2));
        console.log('Состояние сохранено');
        return true;
    } catch (e) {
        console.error('Ошибка сохранения:', e);
        return false;
    }
}

function loadState() {
    try {
        if (fs.existsSync(CONFIG.STATE_BACKUP_FILE)) {
            const backupData = JSON.parse(fs.readFileSync(CONFIG.STATE_BACKUP_FILE));
            
            // Проверка версии и валидация
            if (backupData.version && backupData.team1Score !== undefined) {
                Object.assign(state, {
                    team1Score: backupData.team1Score || 0,
                    team2Score: backupData.team2Score || 0,
                    time: backupData.time || 0,
                    currentHalf: backupData.currentHalf || 1,
                    autoStop: backupData.autoStop !== undefined ? backupData.autoStop : true,
                    isMuted: backupData.isMuted || false,
                    background: backupData.background || state.background,
                    positions: { ...state.positions, ...backupData.positions },
                    fontSettings: { ...state.fontSettings, ...backupData.fontSettings }
                });
                console.log('Состояние загружено');
            }
        }
    } catch (e) {
        console.error('Ошибка загрузки:', e);
    }
}

// Throttled сохранение
const throttledSave = throttle(saveState, CONFIG.SAVE_INTERVAL);

// === Мониторинг соединений ===
const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            console.log('Terminating dead connection');
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// === Инициализация ===
loadFonts();
loadState();

// === Graceful shutdown ===
const shutdown = (signal) => {
    console.log(`Получен сигнал ${signal}. Завершение работы...`);
    
    clearInterval(timerInterval);
    clearInterval(heartbeat);
    
    // Сохраняем состояние
    if (saveState()) {
        console.log('Состояние успешно сохранено');
    }
    
    // Закрываем все соединения
    wss.clients.forEach(ws => {
        ws.close(1001, 'Server shutdown');
    });
    
    server.close(() => {
        console.log('Сервер остановлен');
        process.exit(0);
    });
    
    // Принудительное завершение через 5 секунд
    setTimeout(() => {
        console.log('Принудительное завершение');
        process.exit(1);
    }, 5000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// === Запуск сервера ===
server.listen(CONFIG.DEFAULT_PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${CONFIG.DEFAULT_PORT}`);
    
    // Показываем доступные сетевые интерфейсы
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    Object.keys(interfaces).forEach(name => {
        interfaces[name].forEach(addr => {
            if (addr.family === 'IPv4' && !addr.internal) {
                console.log(`📱 Доступен по адресу: http://${addr.address}:${CONFIG.DEFAULT_PORT}`);
            }
        });
    });
    
    console.log('📁 Для добавления шрифтов создайте папку ./fonts');
    console.log('💾 Автосохранение включено');
});

module.exports = { server, wss, state };
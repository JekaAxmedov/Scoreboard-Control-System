// server.js
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath);
        const contentType = {
            '.html': 'text/html',
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

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

// === Состояние ===
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
    positions: {
        team1Score: { x: 50, y: 50 },
        team2Score: { x: 1100, y: 50 },
        timer: { x: 550, y: 400 }
    },
    fontSettings: {
        teamScore: { fontSize: 4, fontFamily: 'Arial' },
        timer: { fontSize: 6, fontFamily: 'Arial' }
    }
};

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('Подключено:', clients.size);

    // Отправляем полное состояние
    ws.send(JSON.stringify({ type: 'full_state', state }));

    // Отправляем список шрифтов
    broadcastFonts();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleCommand(data, ws);
        } catch (e) {
            console.error('Ошибка парсинга:', e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('Отключено. Осталось:', clients.size);
    });
});

// === Обработка команд ===
function handleCommand(data, ws) {
    switch (data.command) {
        case 'start_half':
            state.currentHalf = data.half;
            state.timerRunning = true;
            broadcast({ type: 'half_changed', half: state.currentHalf });
            broadcast({ type: 'timer_state', running: true });
            break;

        case 'reset':
            state.team1Score = 0;
            state.team2Score = 0;
            state.timerRunning = false;
            state.currentHalf = data.half;
            if (data.half === 1) {
                state.time = 0;
            } else if (data.half === 2) {
                state.time = 45 * 60;
            }
            broadcast({ type: 'score_update', team1: 0, team2: 0 });
            broadcast({ type: 'time_update', time: state.time });
            broadcast({ type: 'full_state', state }); // Чтобы обновить всё
            break;

        case 'set_custom_time':
            if (typeof data.time === 'number' && typeof data.half === 'number') {
                state.time = data.time;
                state.currentHalf = data.half;
                state.timerRunning = false; // Сбрасываем запуск — ждём нажатия "Старт"
                broadcast({ type: 'full_state', state }); // Рассылаем полное состояние, чтобы обновить всё
            } else {
                console.warn('Некорректные данные времени:', data);
            }
            break;
        case 'add_goal':
            if (data.team === 1) state.team1Score++;
            if (data.team === 2) state.team2Score++;
            broadcast({ type: 'score_update', team1: state.team1Score, team2: state.team2Score });
            break;

        case 'undo_goal':
            if (data.team === 1) state.team1Score = Math.max(0, state.team1Score - 1);
            if (data.team === 2) state.team2Score = Math.max(0, state.team2Score - 1);
            broadcast({ type: 'score_update', team1: state.team1Score, team2: state.team2Score });
            break;

        case 'toggle_mute':
            state.isMuted = !state.isMuted;
            broadcast({ type: 'mute_state', muted: state.isMuted });
            break;

        case 'update_element_position':
            // Проверяем, что элемент допустим и данные корректны
            if (data.element && data.position && typeof data.position.x === 'number' && typeof data.position.y === 'number') {
                // Убеждаемся, что объект существует
                if (!state.positions[data.element]) {
                    state.positions[data.element] = { x: 0, y: 0 };
                }
                
                // Обновляем позицию
                state.positions[data.element].x = data.position.x;
                state.positions[data.element].y = data.position.y;
                
                // Отправляем всем клиентам
                broadcast({
                    type: 'element_position_update',
                    element: data.element,
                    position: {
                        x: data.position.x,
                        y: data.position.y
                    }
                });

                // Для отладки
                console.log('Position updated:', data.element, data.position);
            }
            break;

        case 'update_font_size':
            if (state.fontSettings[data.element]) {
                state.fontSettings[data.element].fontSize = parseFloat(data.size);
                broadcast({ type: 'font_size_update', element: data.element, size: data.size });
            }
            break;

        case 'update_font_family':
            if (state.fontSettings[data.element]) {
                state.fontSettings[data.element].fontFamily = data.fontFamily;
                broadcast({ type: 'font_family_update', element: data.element, fontFamily: data.fontFamily });
            }
            break;

        case 'set_background':
            state.background = {
                image: data.image,
                position: data.position || { x: 0, y: 0 },
                scale: data.scale || 1.0,
                fixed: data.fixed || false
            };
            broadcast({ type: 'background_update', background: state.background });
            break;

        case 'update_background_position':
            // Ожидаем, что пришло { x, y }
            if (typeof data.x === 'number' && typeof data.y === 'number') {
                state.background.position = { x: data.x, y: data.y };
                broadcast({ type: 'background_position_update', position: { x: data.x, y: data.y } });
            } else {
                console.warn('Некорректные данные позиции фона:', data);
            }
            break;

        case 'update_background_size':
            state.background.scale = data.scale;
            broadcast({ type: 'background_size_update', scale: data.scale });
            break;

        case 'toggle_background_fixed':
            state.background.fixed = !state.background.fixed;
            broadcast({ type: 'background_fixed_update', fixed: state.background.fixed });
            break;
        
        case 'toggle_half':
            const half = data.half;
            if (state.currentHalf === half) {
                // Переключаем паузу/старт для текущего тайма
                state.timerRunning = !state.timerRunning;
            } else {
                // Меняем тайм → устанавливаем начальное время
                state.currentHalf = half;
                state.timerRunning = true;
                if (half === 1) {
                    state.time = 0; // 00:00
                } else if (half === 2) {
                    state.time = 45 * 60; // 45:00
                }
            }
            broadcast({ type: 'full_state', state });
            break;
            
        case 'toggle_auto_stop':
            state.autoStop = !state.autoStop;
            broadcast({ type: 'auto_stop_update', autoStop: state.autoStop });
            break;
        default:
            console.log('Неизвестная команда:', data.command);
    }
}

// === Рассылка ===
function broadcast(message) {
    const data = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// === Шрифты ===
const FONTS_DIR = path.join(__dirname, 'fonts');
let availableFonts = [];

function loadFonts() {
    if (!fs.existsSync(FONTS_DIR)) {
        console.log('Папка /fonts не найдена. Создайте её для загрузки шрифтов.');
        availableFonts = [];
        return;
    }

    const files = fs.readdirSync(FONTS_DIR);
    const fontExts = /\.(ttf|otf|woff|woff2)$/i;
    console.log('Доступные шрифты:', availableFonts);
    availableFonts = files
        .filter(file => fontExts.test(file))
        .map(file => {
            const name = path.basename(file, path.extname(file));
            const fontFamily = name
                .replace(/[^a-zA-Z0-9]/g, ' ')
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join('')
                .trim() || 'CustomFont';

            return {
                file: file,
                fontFamily: fontFamily,
                path: `/fonts/${file}`
            };
        });

    console.log(`Загружено шрифтов: ${availableFonts.length}`);
    availableFonts.forEach(f => console.log(`  - ${f.fontFamily} → ${f.path}`));
}

function broadcastFonts() {
    broadcast({ type: 'available_fonts', fonts: availableFonts });
}

loadFonts();

// === Таймер ===
setInterval(() => {
    if (state.timerRunning) {
        state.time++;

        // Проверка на окончание 1-го тайма
        if (state.currentHalf === 1 && state.time >= 45 * 60 && state.autoStop) {
            state.timerRunning = false;
            console.log('1-й тайм завершён');
        }

        // Проверка на окончание 2-го тайма
        if (state.currentHalf === 2 && state.time >= 90 * 60 && state.autoStop) {
            state.timerRunning = false;
            console.log('2-й тайм завершён');
        }

        broadcast({ type: 'time_update', time: state.time });
        if (!state.timerRunning) {
            broadcast({ type: 'full_state', state }); // Чтобы обновить кнопки и индикатор
        }
    }
}, 1000);

// === Сохранение ===
function saveState() {
    try {
        fs.writeFileSync('state_backup.json', JSON.stringify(state, null, 2));
        console.log('Состояние сохранено');
    } catch (e) {
        console.error('Ошибка сохранения:', e);
    }
}

function loadState() {
    try {
        if (fs.existsSync('state_backup.json')) {
            Object.assign(state, JSON.parse(fs.readFileSync('state_backup.json')));
            console.log('Состояние загружено');
        }
    } catch (e) {
        console.error('Ошибка загрузки:', e);
    }
}

loadState();

process.on('SIGINT', () => { saveState(); process.exit(0); });
process.on('SIGTERM', () => { saveState(); process.exit(0); });

server.listen(8080, () => {
    console.log('Сервер запущен на http://localhost:8080');
    require('os').networkInterfaces()['Wi-Fi']?.forEach(addr => {
        if (addr.family === 'IPv4') console.log(`  http://${addr.address}:8080`);
    });
});
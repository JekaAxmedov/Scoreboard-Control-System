const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    // Обслуживаем статические файлы
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
            '.gif': 'image/gif'
        }[ext] || 'text/plain';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

// Состояние табло
let state = {
    team1Score: 0,
    team2Score: 0,
    time: 0,
    timerRunning: false,
    currentHalf: 1,
    autoStop: true,
    isMuted: false,
    currentView: 'timer',
    currentPhoto: 0,
    totalPhotos: 0,
    background: {
        image: null,
        position: { x: 0, y: 0 },
        scale: 1.0,
        fixed: false
    }
};

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('Новое подключение. Всего клиентов:', clients.size);
    
    // Отправляем текущее состояние новому клиенту
    ws.send(JSON.stringify({ type: 'full_state', data: state }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleCommand(data, ws);
        } catch (error) {
            console.error('Ошибка разбора сообщения:', error);
        }
    });
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log('Клиент отключился. Осталось:', clients.size);
    });
});

function handleCommand(data, ws) {
    switch (data.command) {
        case 'start_half':
            state.currentHalf = data.half;
            state.timerRunning = true;
            broadcast({ type: 'half_changed', half: state.currentHalf });
            broadcast({ type: 'timer_state', running: state.timerRunning });
            break;
            
        case 'reset':
            state.team1Score = 0;
            state.team2Score = 0;
            state.time = data.half === 1 ? 0 : 2700;
            state.timerRunning = false;
            state.currentHalf = data.half;
            broadcast({ type: 'score_update', team1: state.team1Score, team2: state.team2Score });
            broadcast({ type: 'time_update', time: state.time });
            broadcast({ type: 'timer_state', running: state.timerRunning });
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
            
        case 'set_time':
            state.time = data.minutes * 60 + data.seconds;
            broadcast({ type: 'time_update', time: state.time });
            break;
            
        // Новые команды для работы с фоном
        case 'set_background':
            state.background = {
                image: data.image,
                position: data.position || { x: 0, y: 0 },
                scale: data.scale || 1.0,
                fixed: data.fixed || false
            };
            broadcast({ 
                type: 'background_update', 
                background: state.background 
            });
            break;
            
        case 'update_background_position':
            if (state.background) {
                state.background.position = data.position;
                broadcast({ 
                    type: 'background_position_update', 
                    position: state.background.position 
                });
            }
            break;
            
        case 'update_background_size':
            if (state.background) {
                state.background.scale = data.scale;
                broadcast({ 
                    type: 'background_size_update', 
                    scale: state.background.scale 
                });
            }
            break;
            
        case 'toggle_background_fixed':
            if (state.background) {
                state.background.fixed = !state.background.fixed;
                broadcast({ 
                    type: 'background_fixed_update', 
                    fixed: state.background.fixed 
                });
            }
            break;
            
        default:
            console.log('Неизвестная команда:', data.command);
    }
}

function broadcast(message) {
    const data = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Обновление таймера
setInterval(() => {
    if (state.timerRunning) {
        state.time++;
        broadcast({ type: 'time_update', time: state.time });
        
        // Авто-стоп
        if (state.autoStop) {
            const halfTime = state.currentHalf === 1 ? 2700 : 5400;
            if (state.time >= halfTime) {
                state.timerRunning = false;
                state.time = halfTime;
                broadcast({ type: 'timer_state', running: false });
            }
        }
    }
}, 1000);

// Сохранение состояния при выходе
process.on('SIGINT', () => {
    console.log('Сервер останавливается...');
    saveState();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Сервер останавливается...');
    saveState();
    process.exit(0);
});

function saveState() {
    try {
        fs.writeFileSync('state_backup.json', JSON.stringify(state, null, 2));
        console.log('Состояние сохранено');
    } catch (error) {
        console.error('Ошибка сохранения состояния:', error);
    }
}

// Загрузка состояния при запуске
function loadState() {
    try {
        if (fs.existsSync('state_backup.json')) {
            const data = fs.readFileSync('state_backup.json', 'utf8');
            state = JSON.parse(data);
            console.log('Состояние загружено');
        }
    } catch (error) {
        console.error('Ошибка загрузки состояния:', error);
    }
}

// Загружаем состояние при запуске
loadState();

server.listen(8080, () => {
    console.log('Сервер запущен на http://localhost:8080');
    console.log('IP адреса сервера:');
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    Object.keys(interfaces).forEach((iface) => {
        interfaces[iface].forEach((addr) => {
            if (addr.family === 'IPv4' && !addr.internal) {
                console.log(`  http://${addr.address}:8080`);
            }
        });
    });
});
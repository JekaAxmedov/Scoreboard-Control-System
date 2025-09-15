// === Конфигурация ===
const CONFIG = {
    RECONNECT_INTERVAL: 3000,
    RECONNECT_MAX_ATTEMPTS: 10,
    DRAG_THROTTLE: 16,
    ANIMATION_DURATION: 500
};

// === Состояние ===
let ws;
let state = {};
let reconnectAttempts = 0;
let isConnected = false;
let animationTimeouts = new Map();
let isBackgroundFixed = false;

// === Управление соединением ===
function updateConnectionStatus(status) {
    const indicator = document.getElementById('connectionStatus');
    indicator.className = `connection-status ${status}`;
    
    switch (status) {
        case 'connected':
            indicator.textContent = 'Подключено';
            isConnected = true;
            reconnectAttempts = 0;
            break;
        case 'connecting':
            indicator.textContent = 'Подключение...';
            isConnected = false;
            break;
        case 'disconnected':
            indicator.textContent = 'Отключено';
            isConnected = false;
            break;
    }
}

function connect() {
    try {
        updateConnectionStatus('connecting');
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('Табло подключено');
            updateConnectionStatus('connected');
        };
        
        ws.onmessage = handleMessage;
        
        ws.onclose = (event) => {
            console.log('WebSocket закрыт:', event.code);
            updateConnectionStatus('disconnected');
            
            if (reconnectAttempts < CONFIG.RECONNECT_MAX_ATTEMPTS) {
                reconnectAttempts++;
                setTimeout(connect, CONFIG.RECONNECT_INTERVAL);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket ошибка:', error);
            updateConnectionStatus('disconnected');
        };
        
    } catch (error) {
        console.error('Ошибка подключения:', error);
        updateConnectionStatus('disconnected');
    }
}

// === Утилиты ===
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

function animateElement(elementId, animationClass) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    // Очищаем предыдущую анимацию
    if (animationTimeouts.has(elementId)) {
        clearTimeout(animationTimeouts.get(elementId));
        element.classList.remove('score-animation', 'timer-warning');
    }
    
    element.classList.add(animationClass);
    
    const timeout = setTimeout(() => {
        element.classList.remove(animationClass);
        animationTimeouts.delete(elementId);
    }, CONFIG.ANIMATION_DURATION);
    
    animationTimeouts.set(elementId, timeout);
}

// === Управление шрифтами ===
const loadedFonts = new Set();

function createFontFace(font) {
    if (loadedFonts.has(font.fontFamily)) return;
    loadedFonts.add(font.fontFamily);

    const style = document.createElement('style');
    style.textContent = `
        @font-face {
            font-family: '${font.fontFamily}';
            src: url('${font.path}') format('${getFormat(font.file)}');
            font-display: swap;
        }
    `;
    document.head.appendChild(style);
}

function getFormat(filename) {
    const ext = filename.toLowerCase();
    if (ext.endsWith('.woff2')) return 'woff2';
    if (ext.endsWith('.woff')) return 'woff';
    if (ext.endsWith('.ttf')) return 'truetype';
    if (ext.endsWith('.otf')) return 'opentype';
    return 'truetype';
}

// === Применение стилей ===
function applyPosition(id, x, y) {
    const el = document.getElementById(id);
    if (el) {
        el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, x)) + 'px';
        el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, y)) + 'px';
    }
}

function applyFontSize(id, size) {
    const el = document.getElementById(id);
    if (el) {
        el.style.fontSize = Math.max(0.5, Math.min(20, size)) + 'em';
    }
}

function applyFontFamily(id, family) {
    const el = document.getElementById(id);
    if (el && family) {
        el.style.fontFamily = `'${family}', Arial, sans-serif`;
    }
}

// === Обновление контента ===
function updateTimer(time) {
    const mins = Math.floor(time / 60);
    const secs = time % 60;
    const timerEl = document.getElementById('timerDisplay');
    
    if (timerEl) {
        const timeText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        
        // Анимация при изменении времени
        if (timerEl.textContent !== timeText) {
            timerEl.textContent = timeText;
            
            // Предупреждение в конце тайма
            const isNearEnd = (state.currentHalf === 1 && time >= 44 * 60) || 
                                (state.currentHalf === 2 && time >= 89 * 60);
            
            if (isNearEnd && state.timerRunning) {
                timerEl.classList.add('timer-warning');
            } else {
                timerEl.classList.remove('timer-warning');
            }
        }
    }
}

function updateScore(team, newScore) {
    const elementId = `team${team}Score`;
    const element = document.getElementById(elementId);
    
    if (element) {
        const oldScore = parseInt(element.textContent) || 0;
        element.textContent = newScore;
        
        // Анимация при изменении счёта
        if (newScore !== oldScore) {
            animateElement(elementId, 'score-animation');
        }
    }
}

function updateHalf(half) {
    const element = document.getElementById('halfIndicator');
    if (element) {
        const newText = half === 1 ? '1 тайм' : '2 тайм';
        if (element.textContent !== newText) {
            element.textContent = newText;
            animateElement('halfIndicator', 'glow');
        }
    }
}

// === Обработка сообщений ===
function handleMessage(event) {
    try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'full_state':
                updateUI(data.state);
                break;
                
            case 'score_update':
                updateScore(1, data.team1);
                updateScore(2, data.team2);
                break;
                
            case 'time_update':
                updateTimer(data.time);
                break;
                
            case 'half_changed':
                updateHalf(data.half);
                break;
                
            case 'element_position_update':
                const elementMap = {
                    'timer': 'timerDisplay',
                    'team1Score': 'team1Score',
                    'team2Score': 'team2Score'
                };
                const targetId = elementMap[data.element] || data.element;
                applyPosition(targetId, data.position.x, data.position.y);
                break;
                
            case 'font_size_update':
                if (data.element === 'teamScore') {
                    applyFontSize('team1Score', data.size);
                    applyFontSize('team2Score', data.size);
                } else if (data.element === 'timer') {
                    applyFontSize('timerDisplay', data.size);
                }
                break;

            case 'background_fixed_update':
                isBackgroundFixed = data.fixed || false;
                const bgImage = document.getElementById('backgroundImage');
                if (bgImage) {
                    if (isBackgroundFixed) {
                        bgImage.style.pointerEvents = 'none'; // Блокируем перетаскивание
                    } else {
                        bgImage.style.pointerEvents = 'auto';
                    }
                }
                break;
                
            case 'font_family_update':
                if (data.element === 'teamScore') {
                    applyFontFamily('team1Score', data.fontFamily);
                    applyFontFamily('team2Score', data.fontFamily);
                } else if (data.element === 'timer') {
                    applyFontFamily('timerDisplay', data.fontFamily);
                    applyFontFamily('halfIndicator', data.fontFamily);
                }
                break;
                
            case 'available_fonts':
                if (data.fonts && Array.isArray(data.fonts)) {
                    data.fonts.forEach(font => createFontFace(font));
                }
                break;
                
            case 'background_update':
                updateBackground(data.background);
                break;
            
            case 'auto_stop_update':
                // Табло не использует эту настройку — просто игнорируем
                break;
            case 'mute_state':
                // Табло не использует эту настройку — просто игнорируем
                break;
            case 'background_position_update':
                updateBackgroundPosition(data.position);
                break;
                
            case 'background_size_update':
                updateBackgroundSize(data.scale);
                break;
                
            default:
                console.warn('Неизвестный тип сообщения:', data.type);
        }
    } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
    }
}

// === Обновление UI ===
function updateUI(newState) {
    if (!newState) {
        console.error('Получено пустое состояние');
        return;
    }
    
    state = newState;

    // Безопасное обновление счёта
    updateScore(1, newState.team1Score ?? 0);
    updateScore(2, newState.team2Score ?? 0);
    updateTimer(newState.time ?? 0);
    updateHalf(newState.currentHalf ?? 1);

    // Позиции элементов
    if (newState.positions) {
        Object.entries(newState.positions).forEach(([key, pos]) => {
            const elementMap = {
                'timer': 'timerDisplay',
                'team1Score': 'team1Score',
                'team2Score': 'team2Score'
            };
            const targetId = elementMap[key] || key;
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
                applyPosition(targetId, pos.x, pos.y);
            }
        });
    }

    // Настройки шрифтов
    if (newState.fontSettings) {
        const fs = newState.fontSettings;
        if (fs.teamScore) {
            applyFontSize('team1Score', fs.teamScore.fontSize ?? 4);
            applyFontSize('team2Score', fs.teamScore.fontSize ?? 4);
            applyFontFamily('team1Score', fs.teamScore.fontFamily);
            applyFontFamily('team2Score', fs.teamScore.fontFamily);
        }
        if (fs.timer) {
            applyFontSize('timerDisplay', fs.timer.fontSize ?? 6);
            applyFontFamily('timerDisplay', fs.timer.fontFamily);
            applyFontFamily('halfIndicator', fs.timer.fontFamily);
        }
    }

    // Фон
    if (newState.background?.image) {
        updateBackground(newState.background);
    }
}

// === Управление фоном ===
function updateBackground(background) {
    const bg = document.getElementById('backgroundImage');
    if (!bg || !background.image) return;
    
    bg.src = background.image;
    bg.style.display = 'block';
    
    const scale = background.scale || 1.0;
    const pos = background.position || { x: 0, y: 0 };
    bg.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`;
}

function updateBackgroundPosition(position) {
    if (!position) return;
    
    const bg = document.getElementById('backgroundImage');
    if (bg && bg.style.display !== 'none') {
        const x = position.x || 0;
        const y = position.y || 0;
        let scale = 1.0;
        
        // Извлекаем текущий масштаб
        const transform = bg.style.transform;
        const scaleMatch = transform.match(/scale\(([^)]+)\)/);
        if (scaleMatch) {
            scale = parseFloat(scaleMatch[1]) || 1.0;
        }
        
        bg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    }
}

function updateBackgroundSize(scale) {
    if (typeof scale !== 'number') return;
    
    const bg = document.getElementById('backgroundImage');
    if (bg && bg.style.display !== 'none') {
        let x = 0, y = 0;
        
        // Извлекаем текущую позицию
        const transform = bg.style.transform;
        const translateMatch = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
        if (translateMatch) {
            x = parseFloat(translateMatch[1]) || 0;
            y = parseFloat(translateMatch[2]) || 0;
        }
        
        const newScale = Math.max(0.1, Math.min(5.0, scale));
        bg.style.transform = `translate(${x}px, ${y}px) scale(${newScale})`;
    }
}

// === Перетаскивание ===
let isDragging = false;
let draggedEl = null;
let startX, startY, startLeft, startTop;

function startDrag(e, el) {
    isDragging = true;
    draggedEl = el;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    
    startX = clientX;
    startY = clientY;
    startLeft = parseInt(el.style.left) || 0;
    startTop = parseInt(el.style.top) || 0;
    
    el.style.cursor = 'grabbing';
    el.classList.add('glow');
    e.preventDefault();
}

const throttledDrag = throttle((e) => {
    if (!isDragging || !draggedEl) return;
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    
    const dx = clientX - startX;
    const dy = clientY - startY;
    
    const newX = Math.max(0, Math.min(window.innerWidth - draggedEl.offsetWidth, startLeft + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - draggedEl.offsetHeight, startTop + dy));
    
    draggedEl.style.left = newX + 'px';
    draggedEl.style.top = newY + 'px';
    
    e.preventDefault();
}, CONFIG.DRAG_THROTTLE);

function stopDrag() {
    if (isDragging && draggedEl) {
        const x = parseInt(draggedEl.style.left) || 0;
        const y = parseInt(draggedEl.style.top) || 0;
        
        let element = draggedEl.id;
        // Преобразуем ID в ключи состояния
        const elementMap = {
            'timerDisplay': 'timer',
            'team1Score': 'team1Score',
            'team2Score': 'team2Score'
        };
        element = elementMap[element] || element;

        // Отправляем новую позицию на сервер
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    command: 'update_element_position',
                    element: element,
                    position: { x, y }
                }));
            } catch (error) {
                console.error('Ошибка отправки позиции:', error);
            }
        }

        draggedEl.style.cursor = 'grab';
        draggedEl.classList.remove('glow');
        isDragging = false;
        draggedEl = null;
    }
}

// === Инициализация ===
function initDragAndDrop() {
    document.querySelectorAll('.draggable').forEach(el => {
        el.style.cursor = 'grab';
        
        // Mouse события
        el.addEventListener('mousedown', (e) => startDrag(e, el));
        
        // Touch события для мобильных устройств
        el.addEventListener('touchstart', (e) => startDrag(e, el), { passive: false });
    });

    // Глобальные обработчики
    document.addEventListener('mousemove', throttledDrag);
    document.addEventListener('touchmove', throttledDrag, { passive: false });
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
}

function initDefaultPositions() {
    // Устанавливаем начальные позиции по умолчанию
    applyPosition('team1Score', 50, 50);
    applyPosition('team2Score', window.innerWidth - 170, 50);
    applyPosition('timerDisplay', (window.innerWidth - 200) / 2, 200);
    applyPosition('halfIndicator', (window.innerWidth - 120) / 2, 100);
}

// === Обработка изменения размера окна ===
function handleResize() {
    // Проверяем, что элементы не выходят за границы экрана
    document.querySelectorAll('.draggable').forEach(el => {
        const x = parseInt(el.style.left) || 0;
        const y = parseInt(el.style.top) || 0;
        
        const maxX = window.innerWidth - el.offsetWidth;
        const maxY = window.innerHeight - el.offsetHeight;
        
        if (x > maxX || y > maxY) {
            el.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
            el.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
        }
    });
}

// === Запуск приложения ===
window.addEventListener('load', () => {
    initDefaultPositions();
    initDragAndDrop();
    connect();
    
    window.addEventListener('resize', throttle(handleResize, 250));
    
    // Предотвращаем контекстное меню
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Предотвращаем случайное выделение текста
    document.addEventListener('selectstart', (e) => {
        if (e.target.classList.contains('draggable')) {
            e.preventDefault();
        }
    });
});

// === Обработка ошибок ===
window.addEventListener('error', (e) => {
    console.error('JavaScript error:', e.error);
});

// === Клавиатурные shortcut для презентационного режима ===
document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'F11':
        case 'f':
            // Полноэкранный режим
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(console.error);
            } else {
                document.exitFullscreen().catch(console.error);
            }
            break;
        case 'Escape':
            // Выход из полноэкранного режима
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(console.error);
            }
            break;
    }
});
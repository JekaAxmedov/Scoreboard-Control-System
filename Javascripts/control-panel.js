// === Конфигурация ===
const CONFIG = {
    RECONNECT_INTERVAL: 3000,
    RECONNECT_MAX_ATTEMPTS: 10,
    MESSAGE_TIMEOUT: 3000
};

// === Состояние соединения ===
let ws;
let currentHalf = 1;
let currentScale = 1.0;
let isBackgroundFixed = false;
let state = {};
let reconnectAttempts = 0;
let isConnected = false;

// === Утилиты ===
function showMessage(text, type = 'error') {
    const messageEl = document.getElementById(type + 'Message');
    if (messageEl) {
        messageEl.textContent = text;
        messageEl.style.display = 'block';
        setTimeout(() => {
            messageEl.style.display = 'none';
        }, CONFIG.MESSAGE_TIMEOUT);
    }
}

function showError(text) {
    showMessage(text, 'error');
    console.error(text);
}

function showSuccess(text) {
    showMessage(text, 'success');
    console.log(text);
}

function updateConnectionStatus(status) {
    const indicator = document.getElementById('connectionIndicator');
    const container = document.querySelector('.container');
    
    indicator.className = `connection-indicator ${status}`;
    
    switch (status) {
        case 'connected':
            indicator.textContent = '🟢 Подключено';
            container.classList.remove('disabled');
            isConnected = true;
            reconnectAttempts = 0;
            break;
        case 'connecting':
            indicator.textContent = '🟡 Подключение...';
            container.classList.add('disabled');
            isConnected = false;
            break;
        case 'disconnected':
            indicator.textContent = '🔴 Отключено';
            container.classList.add('disabled');
            isConnected = false;
            break;
    }
}

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

// === WebSocket соединение ===
function connect() {
    try {
        updateConnectionStatus('connecting');
        
        // Определяем URL динамически
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket подключен');
            updateConnectionStatus('connected');
            showSuccess('Соединение установлено');
        };
        
        ws.onmessage = (event) => {
            try {
                handleMessage(event);
            } catch (error) {
                showError(`Ошибка обработки сообщения: ${error.message}`);
            }
        };
        
        ws.onclose = (event) => {
            console.log('WebSocket закрыт:', event.code, event.reason);
            updateConnectionStatus('disconnected');
            
            if (reconnectAttempts < CONFIG.RECONNECT_MAX_ATTEMPTS) {
                reconnectAttempts++;
                showError(`Соединение потеряно. Попытка переподключения ${reconnectAttempts}/${CONFIG.RECONNECT_MAX_ATTEMPTS}...`);
                setTimeout(connect, CONFIG.RECONNECT_INTERVAL);
            } else {
                showError('Превышено максимальное количество попыток переподключения');
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket ошибка:', error);
            updateConnectionStatus('disconnected');
            showError('Ошибка соединения с сервером');
        };
        
    } catch (error) {
        console.error('Ошибка создания WebSocket:', error);
        showError('Не удалось создать соединение');
        updateConnectionStatus('disconnected');
    }
}

// === Обработка сообщений ===
function handleMessage(event) {
    const data = JSON.parse(event.data);
    
    switch (data.type) {
        case 'element_position_update':
            // Опционально: можно сохранить позиции в state для будущего использования
            if (!state.positions) state.positions = {};
            state.positions[data.element] = data.position;
            // Пока не обновляем UI — но ошибка пропадёт
            break;
        case 'full_state':
            updateUI(data.state);
            break;
        case 'score_update':
            document.getElementById('team1Score').textContent = data.team1;
            document.getElementById('team2Score').textContent = data.team2;
            break;
        case 'time_update':
            updateTimer(data.time);
            break;
        case 'mute_state':
            document.getElementById('muteBtn').textContent = data.muted ? 'Unmute' : 'Mute';
            break;
        case 'auto_stop_update':
            const autoStopCb = document.getElementById('autoStop');
            if (autoStopCb) autoStopCb.checked = data.autoStop || false;
            break;
        case 'background_update':
            if (data.background.image) setupBackground(data.background);
            break;
        case 'background_size_update':
            if (data.scale !== undefined) {
                currentScale = data.scale;
                const img = document.getElementById('backgroundImage');
                if (img) img.style.transform = `scale(${currentScale})`;
            }
            break;
        case 'background_fixed_update':
            updateBackgroundFixedState(data.fixed || false);
            break;
        case 'font_size_update':
            // Обновляем значение в UI, чтобы оно синхронизировалось
            if (data.element === 'teamScore') {
                const scoreSizeEl = document.getElementById('scoreSize');
                if (scoreSizeEl) scoreSizeEl.value = data.size;
            } else if (data.element === 'timer') {
                const timerSizeEl = document.getElementById('timerSize');
                if (timerSizeEl) timerSizeEl.value = data.size;
            }
            break;
        case 'background_position_update':
            const img = document.getElementById('backgroundImage');
            if (img && img.style.display !== 'none') {
                const x = data.position?.x || 0;
                const y = data.position?.y || 0;
                img.style.left = x + 'px';
                img.style.top = y + 'px';
            }
            break;
        case 'font_family_update':
            if (data.element === 'teamScore') {
                const scoreFontEl = document.getElementById('scoreFont');
                if (scoreFontEl) scoreFontEl.value = data.fontFamily;
            } else if (data.element === 'timer') {
                const timerFontEl = document.getElementById('timerFont');
                if (timerFontEl) timerFontEl.value = data.fontFamily;
            }
            break;
        case 'available_fonts':
            updateFontSelects(data.fonts);
            break;
        case 'error':
            showError(`Ошибка сервера: ${data.message}`);
            break;
        default:
            console.warn('Неизвестный тип сообщения:', data.type);
    }
}

// === Команды ===
function sendCommand(cmd, params = {}) {
    if (!isConnected) {
        showError('Нет соединения с сервером');
        return false;
    }
    
    try {
        const command = { command: cmd, ...params };
        ws.send(JSON.stringify(command));
        return true;
    } catch (error) {
        showError(`Ошибка отправки команды: ${error.message}`);
        return false;
    }
}

// === Управление временем ===
function setCustomTime() {
    const timeInput = document.getElementById('timeInput');
    const timeStr = timeInput.value.trim();
    
    if (!timeStr) {
        showError('Введите время');
        timeInput.focus();
        return;
    }

    const parts = timeStr.split(':');
    if (parts.length !== 2) {
        showError('Введите время в формате ММ:СС (например, 45:00 или 77:05)');
        timeInput.focus();
        return;
    }

    const mins = parseInt(parts[0], 10);
    const secs = parseInt(parts[1], 10);

    if (isNaN(mins) || isNaN(secs) || mins < 0 || secs < 0 || secs >= 60) {
        showError('Некорректное время. Минуты и секунды должны быть числами, секунды < 60.');
        timeInput.focus();
        return;
    }

    const totalSeconds = mins * 60 + secs;
    const half = totalSeconds > 45 * 60 ? 2 : 1;

    if (sendCommand('set_custom_time', { time: totalSeconds, half })) {
        showSuccess(`Время установлено: ${timeStr}`);
        timeInput.value = '';
    }
}

function toggleHalf(half) {
    if (sendCommand('toggle_half', { half })) {
        currentHalf = half;
    }
}

// === Обновление UI ===
function updateUI(newState) {
    if (!newState) {
        showError('Получено пустое состояние');
        return;
    }
    
    state = newState;
    currentHalf = newState.currentHalf;

    // Обновляем счёт и таймер
    document.getElementById('team1Score').textContent = newState.team1Score || 0;
    document.getElementById('team2Score').textContent = newState.team2Score || 0;
    updateTimer(newState.time || 0);
    
    // Обновляем элементы управления
    const btn1 = document.getElementById('startHalf1');
    const btn2 = document.getElementById('startHalf2');
    const halfIndicator = document.getElementById('halfIndicator');
    const autoStopCb = document.getElementById('autoStop');
    const muteBtn = document.getElementById('muteBtn');

    if (autoStopCb) autoStopCb.checked = newState.autoStop;
    if (muteBtn) muteBtn.textContent = newState.isMuted ? 'Unmute' : 'Mute';
    
    // Обновляем индикатор тайма
    const halfText = currentHalf + (newState.timerRunning ? ' тайм (активен)' : ' тайм');
    if (halfIndicator) halfIndicator.textContent = halfText;

    // Обновляем кнопки
    if (btn1) {
        btn1.textContent = (currentHalf === 1 && newState.timerRunning) ? 'Пауза 1 тайм' : 'Старт 1 тайм';
        btn1.setAttribute('aria-label', btn1.textContent);
    }
    
    if (btn2) {
        btn2.textContent = (currentHalf === 2 && newState.timerRunning) ? 'Пауза 2 тайм' : 'Старт 2 тайм';
        btn2.setAttribute('aria-label', btn2.textContent);
    }

    // Обновляем фон
    if (newState.background?.image) {
        setupBackground(newState.background);
    }
    
    // Обновляем настройки шрифтов
    if (newState.fontSettings) {
        const fs = newState.fontSettings;
        const scoreSizeEl = document.getElementById('scoreSize');
        const timerSizeEl = document.getElementById('timerSize');
        const scoreFontEl = document.getElementById('scoreFont');
        const timerFontEl = document.getElementById('timerFont');
        
        if (scoreSizeEl && fs.teamScore) scoreSizeEl.value = fs.teamScore.fontSize;
        if (timerSizeEl && fs.timer) timerSizeEl.value = fs.timer.fontSize;
        if (scoreFontEl && fs.teamScore?.fontFamily) scoreFontEl.value = fs.teamScore.fontFamily;
        if (timerFontEl && fs.timer?.fontFamily) timerFontEl.value = fs.timer.fontFamily;
    }
}

function updateTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timerEl = document.getElementById('timerDisplay');
    if (timerEl) {
        timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

// === Управление фоном ===
function setupBackground(bg) {
    const img = document.getElementById('backgroundImage');
    if (!img) return;
    
    img.src = bg.image;
    img.style.display = 'block';
    currentScale = bg.scale || 1.0;
    img.style.transform = `scale(${currentScale})`;
    updateBackgroundPosition(bg.position.x || 0, bg.position.y || 0);
    updateBackgroundFixedState(bg.fixed || false);
}

function updateBackgroundPosition(x, y) {
    const img = document.getElementById('backgroundImage');
    if (img) {
        img.style.left = x + 'px';
        img.style.top = y + 'px';
        img.style.position = 'absolute';
    }
}

function moveBackground(dx, dy) {
    const step = parseInt(document.getElementById('bgStep').value) || 10;
    const img = document.getElementById('backgroundImage');
    if (!img || img.style.display === 'none') return;

    let x = parseInt(img.style.left) || 0;
    let y = parseInt(img.style.top) || 0;

    x += dx * step;
    y += dy * step;

    img.style.left = x + 'px';
    img.style.top = y + 'px';
    sendCommand('update_background_position', { x, y });
}

function resetBackgroundPosition() {
    const img = document.getElementById('backgroundImage');
    if (!img) return;
    img.style.left = '0px';
    img.style.top = '0px';
    sendCommand('update_background_position', { x: 0, y: 0 });
}

function applyBackgroundPosition() {
    const x = parseInt(document.getElementById('bgX').value) || 0;
    const y = parseInt(document.getElementById('bgY').value) || 0;
    const img = document.getElementById('backgroundImage');
    if (!img || img.style.display === 'none') return;

    img.style.left = x + 'px';
    img.style.top = y + 'px';
    sendCommand('update_background_position', { x, y });
}

function updateBackgroundFixedState(fixed) {
    isBackgroundFixed = fixed;
    const img = document.getElementById('backgroundImage');
    const btn = document.getElementById('fixBackgroundBtn');
    
    if (img && btn) {
        if (fixed) {
            img.classList.add('fixed');
            btn.textContent = 'Разблокировать фон';
        } else {
            img.classList.remove('fixed');
            btn.textContent = 'Зафиксировать фон';
        }
    }
}

function toggleBackgroundFixed() {
    sendCommand('toggle_background_fixed');
}

function scaleBackground(factor) {
    const img = document.getElementById('backgroundImage');
    if (img && img.style.display !== 'none') {
        currentScale *= factor;
        currentScale = Math.max(0.1, Math.min(5.0, currentScale)); // Ограничиваем масштаб
        img.style.transform = `scale(${currentScale})`;
        sendCommand('update_background_size', { scale: currentScale });
    }
}

// === Управление шрифтами ===
function updateFontSize(element, inputId) {
    const sizeEl = document.getElementById(inputId);
    if (!sizeEl) return;
    
    const size = parseFloat(sizeEl.value);
    if (isNaN(size) || size <= 0) {
        showError('Некорректный размер шрифта');
        return;
    }
    
    if (sendCommand('update_font_size', { element, size })) {
        showSuccess(`Размер шрифта обновлён: ${size}em`);
    }
}

function updateFontFamily(element, selectId) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    
    const fontFamily = selectEl.value;
    if (!fontFamily) {
        showError('Выберите шрифт');
        return;
    }
    
    if (sendCommand('update_font_family', { element, fontFamily })) {
        showSuccess(`Шрифт обновлён: ${fontFamily}`);
    }
}

function updateFontSelects(fonts) {
    ['scoreFont', 'timerFont'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        
        const currentValue = select.value;
        select.innerHTML = '<option value="">Выберите шрифт</option>';
        
        fonts.forEach(font => {
            const opt = document.createElement('option');
            opt.value = font.fontFamily;
            opt.textContent = font.fontFamily;
            select.appendChild(opt);
        });
        
        // Восстанавливаем выбранное значение
        if (currentValue && fonts.find(f => f.fontFamily === currentValue)) {
            select.value = currentValue;
        }
    });

    // Устанавливаем текущие значения из состояния
    if (state.fontSettings) {
        const scoreFontEl = document.getElementById('scoreFont');
        const timerFontEl = document.getElementById('timerFont');
        
        if (scoreFontEl && state.fontSettings.teamScore?.fontFamily) {
            scoreFontEl.value = state.fontSettings.teamScore.fontFamily;
        }
        if (timerFontEl && state.fontSettings.timer?.fontFamily) {
            timerFontEl.value = state.fontSettings.timer.fontFamily;
        }
    }
}

// === Перетаскивание фона ===
let isDragging = false;
let dragStartX, dragStartY;
let startLeft, startTop;
let bgImage;
let hitLayer;

function initDrag() {
    bgImage = document.getElementById('backgroundImage');
    hitLayer = document.getElementById('backgroundHitLayer'); // ← Новый слой
    if (!bgImage || !hitLayer) return;
    
    // Слушаем mousedown на документе
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    
    document.addEventListener('mousemove', throttledDrag);
    document.addEventListener('touchmove', throttledDrag, { passive: false });
    
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
}

function handleMouseDown(e) {
    if (isBackgroundFixed) return; // ← Только фиксация
    // Проверка e.target УДАЛЕНА — клик в любом месте экрана начнёт drag!
    // ❌ Игнорируем клики на интерактивных элементах
    const interactiveElements = [
        'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL',
        'A', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME'
    ];

    // ❌ Игнорируем элементы с определёнными классами (если нужно)
    const interactiveClasses = [
        '.font-controls', '.background-controls', '.controls',
        '.score-display', '.connection-indicator', '.error-message',
        '.success-message', '.timer', '.team'
    ];

    let target = e.target;

    // Проверяем тег
    if (interactiveElements.includes(target.tagName)) {
        return;
    }

    // Проверяем классы
    for (let cls of interactiveClasses) {
        if (target.closest(cls)) {
            return;
        }
    }

    // ❌ Проверка 3: data-interactive (новое!)
    if (target.closest('[data-interactive]')) {
        return;
    }
//Если дошли сюда — начинаем drag
    startDrag(e);
}
// touch версия
function handleTouchStart(e) {
    if (!e.touches?.[0] || isBackgroundFixed) return;
    // Проверка e.touches[0].target УДАЛЕНА — клик в любом месте экрана начнёт drag!
    // Получаем цель события
    const target = e.touches[0].target;
    // ❌ Игнорируем клики на интерактивных элементах
    const interactiveElements = [
        'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL',
        'A', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME'
    ];
    // ❌ Игнорируем элементы с определёнными классами (если нужно)
    // (копипаста из mouse)
    const interactiveClasses = [
        '.font-controls', '.background-controls', '.controls',
        '.score-display', '.connection-indicator', '.error-message',
        '.success-message', '.timer', '.team'
    ];
    // Проверяем тег
    if (interactiveElements.includes(target.tagName)) {
        return;
    }
    // Проверяем классы
    for (let cls of interactiveClasses) {
        if (target.closest(cls)) {
            return;
        }
    }

    // ❌ Проверка data-interactive
    if (target.closest('[data-interactive]')) {
        return;
    }
//Если дошли сюда — начинаем drag xD x2 Javohir?
    startDrag(e);
}
// Начало перетаскивания
function startDrag(e) {
    e.preventDefault();
    isDragging = true;
    
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;
    if (!clientX || !clientY) return;
    
    dragStartX = clientX;
    dragStartY = clientY;
    startLeft = parseInt(bgImage.style.left) || 0;
    startTop = parseInt(bgImage.style.top) || 0;
    
    bgImage.style.cursor = 'grabbing';
    bgImage.style.pointerEvents = 'none';
    
    // 👇 Активируем хит-слой
    if (hitLayer) {
        hitLayer.style.display = 'block';
        hitLayer.classList.add('dragging');
    }
}
// Окончание перетаскивания
function stopDrag() {
    if (isDragging) {
        isDragging = false;
        
        if (bgImage) {
            bgImage.style.cursor = 'grab';
            bgImage.style.pointerEvents = 'auto';
            
            const x = parseInt(bgImage.style.left) || 0;
            const y = parseInt(bgImage.style.top) || 0;
            sendCommand('update_background_position', { x, y });
        }
        
        // 👇 Деактивируем хит-слой
        if (hitLayer) {
            hitLayer.classList.remove('dragging');
            hitLayer.style.display = 'none';
        }
    }
}
// Throttle для drag
const throttledDrag = throttle((e) => {
    if (!isDragging || isBackgroundFixed) return; // 👈 Главный флаг!
    
    e.preventDefault();
    
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;
    if (!clientX || !clientY) return;
    
    const dx = clientX - dragStartX;
    const dy = clientY - dragStartY;
    
    let x = startLeft + dx;
    let y = startTop + dy;
    
    // Ограничиваем, чтобы не улетало слишком далеко
    x = Math.max(-window.innerWidth * 2, Math.min(window.innerWidth * 3, x));
    y = Math.max(-window.innerHeight * 2, Math.min(window.innerHeight * 3, y));
    
    bgImage.style.left = x + 'px';
    bgImage.style.top = y + 'px';
}, 16);

// === Обработка файлов ===
function initFileUpload() {
    const uploadEl = document.getElementById('backgroundUpload');
    if (!uploadEl) return;
    
    uploadEl.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Проверка типа файла
        if (!file.type.startsWith('image/')) {
            showError('Выберите файл изображения');
            return;
        }
        
        // Проверка размера файла (макс 10MB)
        if (file.size > 10 * 1024 * 1024) {
            showError('Файл слишком большой (максимум 10MB)');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = e => {
            if (sendCommand('set_background', {
                image: e.target.result,
                position: { x: 0, y: 0 },
                scale: 1.0,
                fixed: false
            })) {
                showSuccess('Фон загружен');
            }
        };
        reader.onerror = () => showError('Ошибка чтения файла');
        reader.readAsDataURL(file);
    });
}

// === Инициализация ===
window.addEventListener('load', () => {
    connect();
    initDrag();
    initFileUpload();
    
    // Обработчик для Enter в поле времени
    const timeInput = document.getElementById('timeInput');
    if (timeInput) {
        timeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                setCustomTime();
            }
        });
    }
    
    // Предотвращение случайного закрытия страницы
    window.addEventListener('beforeunload', (e) => {
        if (isConnected) {
            e.preventDefault();
            e.returnValue = 'Вы уверены, что хотите покинуть панель управления?';
        }
    });
});

// === Обработка ошибок ===
window.addEventListener('error', (e) => {
    console.error('JavaScript error:', e.error);
    showError(`Ошибка приложения: ${e.message}`);
});

// === Клавиатурные shortcuts ===
document.addEventListener('keydown', (e) => {
    if (!isConnected) return;
    
    // Только если не в поле ввода
    if (e.target.tagName === 'INPUT') return;
    
    switch (e.key) {
        case '1':
            if (e.ctrlKey) {
                e.preventDefault();
                sendCommand('add_goal', {team: 1});
            }
            break;
        case '2':
            if (e.ctrlKey) {
                e.preventDefault();
                sendCommand('add_goal', {team: 2});
            }
            break;
        case ' ':
            e.preventDefault();
            toggleHalf(currentHalf);
            break;
        case 'r':
            if (e.ctrlKey) {
                e.preventDefault();
                sendCommand('reset', {half: currentHalf});
            }
            break;
    }
});
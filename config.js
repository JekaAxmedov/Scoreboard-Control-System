// config.js - Конфигурация приложения
const CONFIG = {
    // Временные параметры
    HALF_DURATION: 45 * 60, // 45 минут в секундах
    FULL_MATCH_DURATION: 90 * 60, // 90 минут в секундах
    TIMER_INTERVAL: 1000, // Интервал обновления таймера (мс)
    
    // Сетевые параметры
    DEFAULT_PORT: 8080,
    RECONNECT_INTERVAL: 3000, // Интервал переподключения (мс)
    RECONNECT_MAX_ATTEMPTS: 10,
    
    // UI параметры
    DRAG_THROTTLE: 16, // ~60fps для плавного перетаскивания
    SAVE_INTERVAL: 30000, // Автосохранение каждые 30 сек
    
    // Файлы и пути
    STATE_BACKUP_FILE: 'state_backup.json',
    FONTS_DIR: './fonts',
    
    // Поддерживаемые форматы шрифтов
    FONT_EXTENSIONS: ['.ttf', '.otf', '.woff', '.woff2'],
    
    // Настройки по умолчанию
    DEFAULT_POSITIONS: {
        team1Score: { x: 50, y: 50 },
        team2Score: { x: 1100, y: 50 },
        timer: { x: 550, y: 400 }
    },
    
    DEFAULT_FONT_SETTINGS: {
        teamScore: { fontSize: 4, fontFamily: 'Arial' },
        timer: { fontSize: 6, fontFamily: 'Arial' }
    }
};

module.exports = CONFIG;
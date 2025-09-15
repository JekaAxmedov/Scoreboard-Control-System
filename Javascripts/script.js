const video = document.getElementById('introVideo');
const btn = document.getElementById('continueBtn');
const splash = document.getElementById('splash');
const loadingOverlay = document.getElementById('loadingOverlay');
const fallbackContent = document.querySelector('.fallback-content');
const videoContainer = document.getElementById('videoContainer');
const volumeSlider = document.getElementById('volumeSlider');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const ambilightGlow = document.getElementById('ambilightGlow');
const bassIndicator = document.getElementById('bassIndicator');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const videoIndicator = document.getElementById('videoIndicator');
const rootStyle = document.documentElement.style;

const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

const videoSources = [
  "video/intro1.mp4",
  "video/intro2.mp4",
  "video/intro3.mp4",
  "video/intro4.mp4"
];

let currentVideoIndex = Math.floor(Math.random() * videoSources.length);
let videoLoaded = false;
let isAmbilightRunning = false;
let isTransitioning = false;
let audioContext = null;
let analyser = null;
let dataArray = null;
let source = null;

// Мобильная оптимизация: детекция устройства
const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                  window.innerWidth <= 768;

const isLowEndDevice = () => {
  return navigator.hardwareConcurrency <= 4 || 
         navigator.deviceMemory <= 4 || 
         /Android.*[45]\./i.test(navigator.userAgent);
};

// Адаптивные настройки FPS в зависимости от устройства
let AMBILIGHT_FPS, AUDIO_FPS, CANVAS_SIZE;

if (isMobile) {
  if (isLowEndDevice()) {
    AMBILIGHT_FPS = 6;  // Очень низкий FPS для слабых устройств
    AUDIO_FPS = 10;
    CANVAS_SIZE = 6;    // Минимальный размер canvas
  } else {
    AMBILIGHT_FPS = 8;  // Средний FPS для обычных мобильных
    AUDIO_FPS = 15;
    CANVAS_SIZE = 8;
  }
} else {
  AMBILIGHT_FPS = 12; // Высокий FPS для десктопа
  AUDIO_FPS = 20;
  CANVAS_SIZE = 10;
}

let lastAmbilightUpdate = 0;
let lastAudioUpdate = 0;
let lastBassPeak = 0;

// Кэш для цветов амбилайта
let colorCache = null;
let cacheTime = 0;
const CACHE_DURATION = isMobile ? 200 : 100; // Дольше кэшируем на мобильных

// Throttled функции для мобильных устройств
const throttle = (func, limit) => {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
};

function initVideoIndicators() {
  videoSources.forEach((_, index) => {
    const dot = document.createElement('div');
    dot.className = 'indicator-dot';
    dot.addEventListener('click', () => switchToVideo(index));
    videoIndicator.appendChild(dot);
  });
  updateVideoIndicator();
}

function updateVideoIndicator() {
  const dots = videoIndicator.querySelectorAll('.indicator-dot');
  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index === currentVideoIndex);
  });
}

function showNavigation() {
  setTimeout(() => {
    prevBtn.classList.add('show');
    nextBtn.classList.add('show');
    videoIndicator.classList.add('show');
  }, 1000);
}

function switchToVideo(index) {
  if (isTransitioning || index === currentVideoIndex) return;

  isTransitioning = true;
  const wasPlaying = !video.paused;
  const currentVolume = video.volume;

  video.classList.add('video-fade-out');

  setTimeout(() => {
    currentVideoIndex = index;
    video.src = videoSources[currentVideoIndex];
    updateVideoIndicator();

    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.opacity = '1';

    const handleNewVideoLoad = () => {
      video.classList.remove('video-fade-out');
      loadingOverlay.style.opacity = '0';
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 500);

      video.volume = currentVolume;
      if (wasPlaying) {
        video.play().catch(console.warn);
      }

      isTransitioning = false;
      video.removeEventListener('loadeddata', handleNewVideoLoad);
      
      // Сброс кэша цветов при переключении видео
      colorCache = null;
    };

    video.addEventListener('loadeddata', handleNewVideoLoad);
  }, 300);
}

function previousVideo() {
  const prevIndex = (currentVideoIndex - 1 + videoSources.length) % videoSources.length;
  switchToVideo(prevIndex);
}

function nextVideo() {
  const nextIndex = (currentVideoIndex + 1) % videoSources.length;
  switchToVideo(nextIndex);
}

prevBtn.addEventListener('click', previousVideo);
nextBtn.addEventListener('click', nextVideo);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') previousVideo();
  else if (e.key === 'ArrowRight') nextVideo();
});

function showContinueButton() {
  setTimeout(() => {
    btn.classList.add('show');
    showNavigation();
  }, 3000);
}

initVideoIndicators();
video.src = videoSources[currentVideoIndex];
video.volume = 0.1;

// Throttled обработчик для мобильных
const handleVolumeChange = isMobile ? 
  throttle(() => { video.volume = volumeSlider.value; }, 50) :
  () => { video.volume = volumeSlider.value; };

volumeSlider.addEventListener('input', handleVolumeChange);

function initAudioAnalysis() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    source = audioContext.createMediaElementSource(video);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    
    // Меньше данных для анализа на мобильных
    analyser.fftSize = isMobile ? 128 : 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    // Скрываем индикатор басов на слабых устройствах
    if (!isLowEndDevice()) {
      bassIndicator.style.display = 'block';
    }
  } catch (error) {
    console.warn('Web Audio API недоступен:', error);
  }
}

function analyzeBass() {
  // Отключаем анализ басов на очень слабых устройствах
  if (isLowEndDevice() || !analyser || video.paused || video.ended) return;

  analyser.getByteFrequencyData(dataArray);
  let bassSum = 0;
  const bassRange = Math.floor(dataArray.length * 0.1); // Меньший диапазон для анализа
  
  for (let i = 0; i < bassRange; i++) {
    bassSum += dataArray[i];
  }

  const bassLevel = (bassSum / bassRange) / 255;
  const isBassPeak = bassLevel > 0.45; // Повышен порог для меньшего количества срабатываний

  const now = Date.now();
  const minInterval = isMobile ? 200 : 150; // Больший интервал для мобильных

  if (isBassPeak && (now - lastBassPeak > minInterval)) {
    ambilightGlow.classList.add('bass-pulse');
    lastBassPeak = now;
    
    // Автоматически убираем класс через время на мобильных
    if (isMobile) {
      setTimeout(() => {
        ambilightGlow.classList.remove('bass-pulse');
      }, 150);
    }
  } else if (!isBassPeak && !isMobile && ambilightGlow.classList.contains('bass-pulse')) {
    ambilightGlow.classList.remove('bass-pulse');
  }

  if (!isLowEndDevice()) {
    bassIndicator.classList.toggle('bass-active', isBassPeak);
    bassIndicator.textContent = `🎵 Bass: ${Math.round(bassLevel * 100)}%`;
  }
}

// Оптимизированная функция получения цветов
function getVideoColors() {
  if (!video.videoWidth || !video.videoHeight) return null;

  const now = Date.now();
  
  // Используем кэш для мобильных устройств
  if (colorCache && (now - cacheTime) < CACHE_DURATION) {
    return colorCache;
  }

  // Динамический размер canvas в зависимости от устройства
  hiddenCanvas.width = CANVAS_SIZE;
  hiddenCanvas.height = CANVAS_SIZE;
  
  // Отключаем сглаживание для улучшения производительности
  ctx.imageSmoothingEnabled = false;
  
  try {
    ctx.drawImage(video, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const data = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;

    const centerPoint = Math.floor(CANVAS_SIZE / 2);
    const maxPoint = CANVAS_SIZE - 1;
    
    const getPixelColor = (x, y) => {
      const safeX = Math.min(Math.max(0, Math.floor(x)), maxPoint);
      const safeY = Math.min(Math.max(0, Math.floor(y)), maxPoint);
      const index = (safeY * CANVAS_SIZE + safeX) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    const colors = {
      top: getPixelColor(centerPoint, 0),
      bottom: getPixelColor(centerPoint, maxPoint),
      left: getPixelColor(0, centerPoint),
      right: getPixelColor(maxPoint, centerPoint),
      center: getPixelColor(centerPoint, centerPoint)
    };
    
    // Кэшируем результат
    colorCache = colors;
    cacheTime = now;
    
    return colors;
  } catch (error) {
    console.warn('Ошибка при получении цветов видео:', error);
    return colorCache; // Возвращаем кэшированные данные при ошибке
  }
}

// Более эффективная функция обновления амбилайта
function updateAmbilight() {
  const colors = getVideoColors();
  if (!colors) return;

  // Уменьшенная насыщенность для мобильных устройств для экономии GPU
  const saturationMultiplier = isMobile ? 1.4 : 1.8;
  const brightnessMultiplier = isMobile ? 1.1 : 1.2;

  const enhanceColor = (color) => {
    return [
      Math.min(255, Math.round(color[0] * saturationMultiplier * brightnessMultiplier)),
      Math.min(255, Math.round(color[1] * saturationMultiplier * brightnessMultiplier)),
      Math.min(255, Math.round(color[2] * saturationMultiplier * brightnessMultiplier))
    ];
  };

  // Используем requestAnimationFrame для плавного обновления CSS переменных
  const updateCSSVariables = () => {
    const enhancedColors = {};
    Object.entries(colors).forEach(([key, value]) => {
      enhancedColors[key] = enhanceColor(value);
    });
    
    // Уменьшенная прозрачность на мобильных для экономии ресурсов
    const opacity = isMobile ? 0.5 : 0.7;
    const centerOpacity = isMobile ? 0.7 : 0.9;
    
    rootStyle.setProperty('--ambilight-top-color', `rgba(${enhancedColors.top.join(', ')}, ${opacity})`);
    rootStyle.setProperty('--ambilight-bottom-color', `rgba(${enhancedColors.bottom.join(', ')}, ${opacity})`);
    rootStyle.setProperty('--ambilight-left-color', `rgba(${enhancedColors.left.join(', ')}, ${opacity})`);
    rootStyle.setProperty('--ambilight-right-color', `rgba(${enhancedColors.right.join(', ')}, ${opacity})`);
    rootStyle.setProperty('--ambilight-center-color', `rgba(${enhancedColors.center.join(', ')}, ${centerOpacity})`);
  };

  if (isMobile) {
    // На мобильных обновляем сразу без дополнительного RAF
    updateCSSVariables();
  } else {
    // На десктопе используем RAF для плавности
    requestAnimationFrame(updateCSSVariables);
  }
}

// Оптимизированная функция анимации
function animate(timestamp) {
  if (!video.paused && !video.ended && videoLoaded) {
    const ambilightInterval = 1000 / AMBILIGHT_FPS;
    const audioInterval = 1000 / AUDIO_FPS;
    
    if (timestamp - lastAmbilightUpdate > ambilightInterval) {
      lastAmbilightUpdate = timestamp;
      updateAmbilight();
    }
    
    if (timestamp - lastAudioUpdate > audioInterval) {
      lastAudioUpdate = timestamp;
      analyzeBass();
    }
  }
  
  // Используем более эффективный способ для следующего кадра
  if (isAmbilightRunning) {
    requestAnimationFrame(animate);
  }
}

function startAmbilightAndAudio() {
  if (isAmbilightRunning) return;
  isAmbilightRunning = true;
  
  if (!audioContext && !isLowEndDevice()) {
    initAudioAnalysis();
  }
  
  requestAnimationFrame(animate);
}

function stopAmbilight() {
  isAmbilightRunning = false;
  colorCache = null; // Очищаем кэш при остановке
}

// Обработчики событий видео
video.addEventListener('loadeddata', () => {
  videoLoaded = true;
  loadingOverlay.style.opacity = '0';
  setTimeout(() => {
    loadingOverlay.style.display = 'none';
  }, 500);

  video.play().then(() => {
    startAmbilightAndAudio();
    showContinueButton();
  }).catch(() => {
    showVideoControls();
  });
});

video.addEventListener('pause', () => {
  if (isMobile) {
    stopAmbilight(); // Останавливаем амбилайт при паузе на мобильных
  }
});

video.addEventListener('play', () => {
  if (isMobile && videoLoaded) {
    startAmbilightAndAudio(); // Возобновляем при воспроизведении
  }
});

video.addEventListener('error', (e) => {
  console.error('Ошибка загрузки видео:', e);
  showFallback();
});

// Обработка видимости страницы для экономии ресурсов
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (isMobile) {
      stopAmbilight();
    }
  } else {
    if (isMobile && videoLoaded && !video.paused) {
      startAmbilightAndAudio();
    }
  }
});

setTimeout(() => {
  if (!videoLoaded) showFallback();
}, 10000);

function showFallback() {
  videoContainer.style.display = 'none';
  fallbackContent.style.display = 'block';
  showContinueButton();
}

function showVideoControls() {
  const playButton = document.createElement('button');
  playButton.textContent = '▶ Воспроизвести со звуком';
  playButton.style.cssText = `
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    padding: 15px 30px; font-size: 18px; background: rgba(0,0,0,0.8);
    color: white; border: 2px solid white; border-radius: 25px; cursor: pointer; z-index: 5;
    backdrop-filter: blur(10px);
  `;
  playButton.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(console.warn);
    }
    video.play().then(() => {
      playButton.remove();
      startAmbilightAndAudio();
      showContinueButton();
    }).catch(() => {
      alert('Не удалось воспроизвести видео. Проверьте настройки автовоспроизведения.');
    });
  });
  videoContainer.appendChild(playButton);
}

btn.addEventListener('click', () => {
  stopAmbilight(); // Останавливаем амбилайт перед переходом
  splash.classList.add('fade-out');
  setTimeout(() => {
    window.location.href = 'control-panel.html';
  }, 1000);
});

// Оптимизированный обработчик кликов
document.addEventListener('click', async function(e) {
  // Throttle для мобильных устройств
  if (isMobile && e.target.tagName !== 'BUTTON') {
    return;
  }
  
  if (audioContext && audioContext.state === 'suspended') {
    await audioContext.resume().catch(console.warn);
  }
  if (videoLoaded && video.paused) {
    video.play().catch(console.warn);
  }
});

// Дополнительная оптимизация для мобильных: отключение контекстного меню
if (isMobile) {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  
  // Предотвращение случайного масштабирования
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });
  
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, false);
}

// Финальная оптимизация: освобождение ресурсов при закрытии страницы
window.addEventListener('beforeunload', () => {
  stopAmbilight();
  if (audioContext) {
    audioContext.close().catch(console.warn);
  }
});
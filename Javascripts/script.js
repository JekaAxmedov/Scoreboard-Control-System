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

const AMBILIGHT_FPS = 10;
const AUDIO_FPS = 20;
let lastAmbilightUpdate = 0;
let lastAudioUpdate = 0;
let lastBassPeak = 0;

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

volumeSlider.addEventListener('input', () => {
  video.volume = volumeSlider.value;
});

function initAudioAnalysis() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    source = audioContext.createMediaElementSource(video);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    bassIndicator.style.display = 'block';
  } catch (error) {
    console.warn('Web Audio API недоступен:', error);
  }
}

function analyzeBass() {
  if (!analyser || video.paused || video.ended) return;

  analyser.getByteFrequencyData(dataArray);
  let bassSum = 0;
  const bassRange = Math.floor(dataArray.length * 0.15);
  for (let i = 0; i < bassRange; i++) {
    bassSum += dataArray[i];
  }

  const bassLevel = (bassSum / bassRange) / 255;
  const isBassPeak = bassLevel > 0.4;

  if (isBassPeak && (Date.now() - lastBassPeak > 150)) {
    ambilightGlow.classList.add('bass-pulse');
    lastBassPeak = Date.now();
  } else if (!isBassPeak && ambilightGlow.classList.contains('bass-pulse')) {
    ambilightGlow.classList.remove('bass-pulse');
  }

  bassIndicator.classList.toggle('bass-active', isBassPeak);
  bassIndicator.textContent = `🎵 Bass: ${Math.round(bassLevel * 100)}%`;
}

function getVideoColors() {
    if (!video.videoWidth || !video.videoHeight) return null;

    // Установите размер холста на минимальный, например, 10x10 пикселей.
    // Это ускорит операцию getImageData.
    hiddenCanvas.width = 10;
    hiddenCanvas.height = 10;
    ctx.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

    // Получаем данные пикселей
    const data = ctx.getImageData(0, 0, hiddenCanvas.width, hiddenCanvas.height).data;

    const getPixelColor = (x, y) => {
        const index = (Math.floor(y) * hiddenCanvas.width + Math.floor(x)) * 4;
        return [data[index], data[index + 1], data[index + 2]];
    };

    // Собираем цвета с ключевых точек:
    const colors = {
        top: getPixelColor(4, 0),       // Сверху
        bottom: getPixelColor(4, 9),    // Снизу
        left: getPixelColor(0, 4),      // Слева
        right: getPixelColor(9, 4),     // Справа
        center: getPixelColor(4, 4)     // В центре
    };
    
    return colors;
}

function updateAmbilight() {
  const colors = getVideoColors();
  if (!colors) return;

  const enhanceColor = (color) => {
    const saturation = 1.8;
    const brightness = 1.2;
    return [
      Math.min(255, Math.round(color[0] * saturation * brightness)),
      Math.min(255, Math.round(color[1] * saturation * brightness)),
      Math.min(255, Math.round(color[2] * saturation * brightness))
    ];
  };

  const enhancedColors = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, enhanceColor(value)])
  );
  
  rootStyle.setProperty('--ambilight-top-color', `rgba(${enhancedColors.top.join(', ')}, 0.7)`);
  rootStyle.setProperty('--ambilight-bottom-color', `rgba(${enhancedColors.bottom.join(', ')}, 0.7)`);
  rootStyle.setProperty('--ambilight-left-color', `rgba(${enhancedColors.left.join(', ')}, 0.7)`);
  rootStyle.setProperty('--ambilight-right-color', `rgba(${enhancedColors.right.join(', ')}, 0.7)`);
  rootStyle.setProperty('--ambilight-center-color', `rgba(${enhancedColors.center.join(', ')}, 0.9)`);
}

function animate(timestamp) {
  if (!video.paused && !video.ended && videoLoaded) {
    if (timestamp - lastAmbilightUpdate > (1000 / AMBILIGHT_FPS)) {
      lastAmbilightUpdate = timestamp;
      updateAmbilight();
    }
    if (timestamp - lastAudioUpdate > (1000 / AUDIO_FPS)) {
      lastAudioUpdate = timestamp;
      analyzeBass();
    }
  }
  requestAnimationFrame(animate);
}

function startAmbilightAndAudio() {
  if (isAmbilightRunning) return;
  isAmbilightRunning = true;
  if (!audioContext) initAudioAnalysis();
  requestAnimationFrame(animate);
}

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

video.addEventListener('error', (e) => {
  console.error('Ошибка загрузки видео:', e);
  showFallback();
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
  splash.classList.add('fade-out');
  setTimeout(() => {
    window.location.href = 'main.html';
  }, 1000);
});

document.addEventListener('click', async function() {
  if (audioContext && audioContext.state === 'suspended') {
    await audioContext.resume().catch(console.warn);
  }
  if (videoLoaded && video.paused) {
    video.play().catch(console.warn);
  }
});
const state = {
  combo: 0,
  score: 0,
  templeHealth: 100,
  enemyHealth: 100,
  currentGesture: 'Open Palm',
  currentNote: null,
  lastDetectedGesture: null,
  lastKnownGestureTime: 0,
  hitWindowMs: 180,
  nextNoteDelayMs: 700,
  lastFrame: 0,
  wave: 1,
  isPaused: false,
  gameOver: false,
  hasStarted: false,
  dragState: null,
  nextNotePending: false,
  feedbackTimeout: null,
};

const lane = typeof document !== 'undefined' ? document.getElementById('noteLane') : null;
const laneWrap = typeof document !== 'undefined' ? document.querySelector('.lane-wrap') : null;
const timingCue = typeof document !== 'undefined' ? document.getElementById('timingCue') : null;
const promptEl = typeof document !== 'undefined' ? document.getElementById('gesturePrompt') : null;
const comboEl = typeof document !== 'undefined' ? document.getElementById('comboValue') : null;
const scoreEl = typeof document !== 'undefined' ? document.getElementById('scoreValue') : null;
const templeHealthEl = typeof document !== 'undefined' ? document.getElementById('templeHealth') : null;
const enemyHealthEl = typeof document !== 'undefined' ? document.getElementById('enemyHealth') : null;
const cameraFeed = typeof document !== 'undefined' ? document.getElementById('cameraFeed') : null;
const currentGestureLabel = typeof document !== 'undefined' ? document.getElementById('currentGestureLabel') : null;
const attackBurst = typeof document !== 'undefined' ? document.getElementById('attackBurst') : null;
const pauseButton = typeof document !== 'undefined' ? document.getElementById('pauseGameButton') : null;
const cameraPanel = typeof document !== 'undefined' ? document.querySelector('.camera-panel') : null;
const cameraHeader = typeof document !== 'undefined' ? document.querySelector('.camera-header') : null;
const combatFeedback = typeof document !== 'undefined' ? document.getElementById('combatFeedback') : null;
const gameOverScreen = typeof document !== 'undefined' ? document.getElementById('gameOverScreen') : null;
const finalScore = typeof document !== 'undefined' ? document.getElementById('finalScore') : null;
const restartButton = typeof document !== 'undefined' ? document.getElementById('restartGameButton') : null;
const gameOverTitle = typeof document !== 'undefined' ? document.getElementById('gameOverTitle') : null;
const gameOverEyebrow = typeof document !== 'undefined' ? document.getElementById('gameOverEyebrow') : null;
const gestureCanvas = typeof document !== 'undefined' ? document.getElementById('gestureCanvas') : null;
const gestureCtx = gestureCanvas ? gestureCanvas.getContext('2d') : null;
const startScreen = typeof document !== 'undefined' ? document.getElementById('startScreen') : null;
const startButton = typeof document !== 'undefined' ? document.getElementById('startGameButton') : null;
const trackingStatus = typeof document !== 'undefined' ? document.getElementById('trackingStatus') : null;
let mediaPipeAttached = false;
let cameraStarted = false;

const gestures = ['Open Palm', 'Fist', 'Victory', 'Pointing', 'Thumbs Up'];
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pointDistance(first, second) {
  if (!first || !second) return 0;
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const dz = (first.z ?? 0) - (second.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function jointAngle(first, middle, last) {
  if (!first || !middle || !last) return 0;

  const firstVector = [first.x - middle.x, first.y - middle.y, (first.z ?? 0) - (middle.z ?? 0)];
  const lastVector = [last.x - middle.x, last.y - middle.y, (last.z ?? 0) - (middle.z ?? 0)];

  const firstLength = Math.hypot(...firstVector);
  const lastLength = Math.hypot(...lastVector);
  if (!firstLength || !lastLength) return 0;

  const dotProduct = firstVector.reduce((sum, value, index) => sum + value * lastVector[index], 0);
  const cosine = Math.max(-1, Math.min(1, dotProduct / (firstLength * lastLength)));
  return Math.acos(cosine) * (180 / Math.PI);
}

function setPaused(nextPaused) {
  state.isPaused = nextPaused;
  if (pauseButton) {
    pauseButton.textContent = nextPaused ? 'Resume' : 'Pause';
  }
}

function togglePause() {
  if (state.gameOver || !state.hasStarted) return;
  setPaused(!state.isPaused);
}

function setTimingCue(isReady) {
  if (timingCue) {
    timingCue.textContent = isReady ? 'GESTURE NOW' : 'WAIT FOR CENTER';
    timingCue.classList.toggle('ready', isReady);
  }
  laneWrap?.classList.toggle('timing-ready', isReady);
}

function ensureCanvasSize() {
  if (!cameraFeed || !gestureCanvas) return;

  gestureCanvas.width = cameraFeed.videoWidth || 320;
  gestureCanvas.height = cameraFeed.videoHeight || 240;
}

function updateHud() {
  if (comboEl) comboEl.textContent = `${state.combo}x`;
  if (scoreEl) scoreEl.textContent = String(state.score);
  if (templeHealthEl) templeHealthEl.style.width = `${state.templeHealth}%`;
  if (enemyHealthEl) enemyHealthEl.style.width = `${state.enemyHealth}%`;
}

function setPrompt(gesture) {
  state.currentGesture = gesture;
  if (promptEl) promptEl.textContent = gesture;
  if (currentGestureLabel) currentGestureLabel.textContent = gesture;
}

function spawnNote() {
  if (!lane || state.gameOver || !state.hasStarted) return;

  const note = document.createElement('div');
  const gesture = gestures[Math.floor(Math.random() * gestures.length)];
  note.className = 'note';
  note.textContent = gesture;
  lane.appendChild(note);

  const createdAt = performance.now();
  const dueAt = createdAt + 1500;

  state.currentNote = {
    gesture,
    createdAt,
    dueAt,
    element: note,
  };

  setTimingCue(false);
  setPrompt(gesture);
}

function removeCurrentNote() {
  if (!state.currentNote) return;
  state.currentNote.element.remove();
  state.currentNote = null;
  setTimingCue(false);
}

function scheduleNextNote() {
  setTimeout(() => {
    if (state.gameOver || !state.hasStarted) return;
    if (!state.currentNote && !state.isPaused) {
      spawnNote();
    } else if (!state.currentNote) {
      state.nextNotePending = true;
    }
  }, state.nextNoteDelayMs);
}

function showCombatFeedback(message, result) {
  if (!combatFeedback) return;

  combatFeedback.textContent = message;
  combatFeedback.className = `combat-feedback ${result} visible`;

  if (state.feedbackTimeout) {
    clearTimeout(state.feedbackTimeout);
  }
  state.feedbackTimeout = setTimeout(() => {
    combatFeedback.classList.remove('visible');
  }, 760);
}

function triggerAttackVisual() {
  if (!attackBurst) return;

  attackBurst.classList.remove('hidden');
  attackBurst.classList.add('show');

  document.querySelectorAll('.monster').forEach((monster) => {
    monster.classList.remove('monster-hit');
    void monster.offsetWidth;
    monster.classList.add('monster-hit');
  });

  const gameShell = document.querySelector('.game-shell');
  gameShell?.classList.remove('hit-flash');
  void gameShell?.offsetWidth;
  gameShell?.classList.add('hit-flash');

  setTimeout(() => {
    attackBurst.classList.remove('show');
    attackBurst.classList.add('hidden');
    document.querySelectorAll('.monster').forEach((monster) => monster.classList.remove('monster-hit'));
    gameShell?.classList.remove('hit-flash');
  }, 500);
}

function hitSuccess(diff) {
  state.combo += 1;
  state.score += 100 + state.combo * 10;
  state.enemyHealth = Math.max(0, state.enemyHealth - 12 - state.combo * 0.8);
  const quality = diff <= 65 ? 'PERFECT' : 'GOOD';
  showCombatFeedback(`${quality}  +${100 + state.combo * 10}`, 'success');
  triggerAttackVisual();

  if (state.enemyHealth === 0) {
    state.wave += 1;
    state.score += 500;
    if (state.wave > 3) {
      updateHud();
      finishGame(true);
      return;
    }
    state.enemyHealth = 100;
  }

  updateHud();
}

function failHit(message = 'MISS') {
  state.combo = 0;
  state.templeHealth = Math.max(0, state.templeHealth - 8);
  showCombatFeedback(message, 'miss');
  const temple = document.querySelector('.temple');
  if (temple) {
    temple.classList.remove('temple-hit');
    void temple.offsetWidth;
    temple.classList.add('temple-hit');
  }
  const gameShell = document.querySelector('.game-shell');
  gameShell?.classList.remove('miss-flash');
  void gameShell?.offsetWidth;
  gameShell?.classList.add('miss-flash');
  lane?.classList.remove('lane-missed');
  void lane?.offsetWidth;
  lane?.classList.add('lane-missed');
  setTimeout(() => {
    gameShell?.classList.remove('miss-flash');
    lane?.classList.remove('lane-missed');
  }, 420);
  updateHud();
  if (state.templeHealth === 0) {
    finishGame();
  }
}

function finishGame(isVictory = false) {
  state.gameOver = true;
  state.isPaused = true;
  state.nextNotePending = false;
  removeCurrentNote();
  setTimingCue(false);
  if (pauseButton) pauseButton.disabled = true;
  if (finalScore) finalScore.textContent = String(state.score);
  if (gameOverEyebrow) gameOverEyebrow.textContent = isVictory ? 'Temple protected' : 'Temple fallen';
  if (gameOverTitle) gameOverTitle.textContent = isVictory ? 'Victory!' : 'Run ended';
  gameOverScreen?.classList.remove('hidden');
}

function restartGame() {
  state.combo = 0;
  state.score = 0;
  state.templeHealth = 100;
  state.enemyHealth = 100;
  state.wave = 1;
  state.lastKnownGestureTime = 0;
  state.nextNotePending = false;
  state.gameOver = false;
  state.isPaused = false;
  state.hasStarted = true;
  if (pauseButton) {
    pauseButton.disabled = false;
    pauseButton.textContent = 'Pause';
  }
  gameOverScreen?.classList.add('hidden');
  removeCurrentNote();
  updateHud();
  spawnNote();
  requestAnimationFrame(gameLoop);
}

function handleGestureInput(gesture) {
  if (!gesture) return;
  if (!state.hasStarted || state.isPaused) return;
  const now = performance.now();

  if (!state.currentNote) {
    return;
  }

  const diff = Math.abs(now - state.currentNote.dueAt);
  if (gesture !== state.currentNote.gesture) {
    if (diff <= state.hitWindowMs) {
      failHit(`Wrong gesture - show ${state.currentNote.gesture}`);
    }
    return;
  }

  if (diff <= state.hitWindowMs) {
    removeCurrentNote();
    hitSuccess(diff);
    scheduleNextNote();
    return;
  }
}

function updateNotePosition(now) {
  if (state.isPaused || !state.currentNote) return;

  const { createdAt, dueAt, element } = state.currentNote;
  const total = dueAt - createdAt;
  const elapsed = now - createdAt;
  const progress = clamp(elapsed / total, 0, 1);
  const targetY = lane.clientHeight / 2 - element.offsetHeight / 2;
  const y = -element.offsetHeight + progress * (targetY + element.offsetHeight);
  const isReady = Math.abs(now - dueAt) <= state.hitWindowMs;

  element.style.top = `${y}px`;
  element.classList.toggle('note-ready', isReady);
  setTimingCue(isReady);

  if (now > dueAt + state.hitWindowMs) {
    element.remove();
    state.currentNote = null;
    setTimingCue(false);
    failHit(`Too late - prepare ${state.currentGesture} earlier`);
    scheduleNextNote();
  }
}

function gameLoop(now) {
  if (state.gameOver || !state.hasStarted) return;
  if (!state.isPaused) {
    if (state.nextNotePending && !state.currentNote) {
      state.nextNotePending = false;
      spawnNote();
    }
    updateNotePosition(now);
  }
  requestAnimationFrame(gameLoop);
}

function fingerExtended(landmarks, tipIndex, pipIndex, mcpIndex) {
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];
  const mcp = landmarks[mcpIndex];

  if (!tip || !pip || !mcp) return false;
  return jointAngle(mcp, pip, tip) >= 150;
}

function thumbExtended(landmarks) {
  const tip = landmarks[4];
  const joint = landmarks[3];
  const wristLandmark = landmarks[2];

  if (!tip || !joint || !wristLandmark) return false;

  const thumbAngle = jointAngle(wristLandmark, joint, tip);
  const extensionRatio = pointDistance(tip, landmarks[5]) / Math.max(pointDistance(wristLandmark, landmarks[5]), 1e-6);
  return thumbAngle >= 135 && extensionRatio >= 1.12;
}

function classifyHand(landmarks) {
  const fingerAngles = {
    index: jointAngle(landmarks[5], landmarks[6], landmarks[8]),
    middle: jointAngle(landmarks[9], landmarks[10], landmarks[12]),
    ring: jointAngle(landmarks[13], landmarks[14], landmarks[16]),
    pinky: jointAngle(landmarks[17], landmarks[18], landmarks[20]),
  };

  const indexExtended = fingerAngles.index >= 150;
  const middleExtended = fingerAngles.middle >= 150;
  const ringExtended = fingerAngles.ring >= 150;
  const pinkyExtended = fingerAngles.pinky >= 150;
  const thumbIsExtended = thumbExtended(landmarks);
  const allFingersCurled = Object.values(fingerAngles).every((angle) => angle <= 135);
  const handScale = pointDistance(landmarks[0], landmarks[9]);
  const thumbPointsUp = landmarks[4].y < landmarks[0].y - handScale * 0.12;
  const allFingersExtended = Object.values(fingerAngles).every((angle) => angle >= 145);
  const middleCurled = fingerAngles.middle <= 135;
  const ringCurled = fingerAngles.ring <= 135;
  const pinkyCurled = fingerAngles.pinky <= 135;

  if (thumbIsExtended && thumbPointsUp && allFingersCurled) {
    return 'Thumbs Up';
  }

  if (allFingersCurled) {
    return 'Fist';
  }

  if (allFingersExtended) {
    return 'Open Palm';
  }

  if (indexExtended && middleCurled && ringCurled && pinkyCurled && !thumbIsExtended) {
    return 'Pointing';
  }

  if (thumbIsExtended && thumbPointsUp && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Thumbs Up';
  }

  if (indexExtended && middleExtended && ringCurled && pinkyCurled) {
    return 'Victory';
  }

  return null;
}

function drawLandmarks(landmarks) {
  if (!gestureCtx || !gestureCanvas) return;

  const width = gestureCanvas.width;
  const height = gestureCanvas.height;

  gestureCtx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  gestureCtx.strokeStyle = '#7bf1b3';
  gestureCtx.lineWidth = 2;
  gestureCtx.fillStyle = '#ffffff';

  for (const [start, end] of HAND_CONNECTIONS) {
    const startPoint = landmarks[start];
    const endPoint = landmarks[end];

    if (startPoint && endPoint) {
      gestureCtx.beginPath();
      gestureCtx.moveTo(startPoint.x * width, startPoint.y * height);
      gestureCtx.lineTo(endPoint.x * width, endPoint.y * height);
      gestureCtx.stroke();
    }
  }

  for (const landmark of landmarks) {
    const x = landmark.x * width;
    const y = landmark.y * height;
    gestureCtx.beginPath();
    gestureCtx.arc(x, y, 3, 0, Math.PI * 2);
    gestureCtx.fill();
  }
}

function onHandResults(results) {
  if (!gestureCtx || !gestureCanvas) return;

  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    gestureCtx.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    if (trackingStatus) trackingStatus.textContent = 'No hand detected';
    return;
  }
  if (gameOverEyebrow) gameOverEyebrow.textContent = 'Temple fallen';
  if (gameOverTitle) gameOverTitle.textContent = 'Run ended';

  const imageLandmarks = results.multiHandLandmarks[0];
  const poseLandmarks = results.multiHandWorldLandmarks?.[0] ?? imageLandmarks;
  const detectedGesture = classifyHand(poseLandmarks);
  drawLandmarks(imageLandmarks);
  if (trackingStatus) trackingStatus.textContent = detectedGesture ? 'Hand detected' : 'Adjust your hand';

  if (detectedGesture) {
    state.lastDetectedGesture = detectedGesture;
    if (currentGestureLabel) currentGestureLabel.textContent = detectedGesture;
    const now = performance.now();
    if (now - state.lastKnownGestureTime > 200) {
      handleGestureInput(detectedGesture);
      state.lastKnownGestureTime = now;
    }
  } else if (currentGestureLabel) {
    currentGestureLabel.textContent = 'Open your palm or make a clear fist';
  }
}

function attachMediaPipe() {
  if (mediaPipeAttached) return;
  const video = cameraFeed;
  const { Hands } = window;
  const { Camera } = window;

  if (!Hands || !Camera) {
    console.warn('MediaPipe libraries are not ready yet.');
    return;
  }

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });

  hands.onResults(onHandResults);
  mediaPipeAttached = true;

  const camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 640,
    height: 480,
  });

  camera.start();
}

async function startCamera() {
  if (!cameraFeed || cameraStarted) return;
  cameraStarted = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    cameraFeed.srcObject = stream;

    cameraFeed.onloadedmetadata = () => {
      ensureCanvasSize();
      attachMediaPipe();
    };
  } catch (error) {
    cameraStarted = false;
    console.warn('Camera access denied or unavailable; demo mode remains active.', error);
    if (currentGestureLabel) currentGestureLabel.textContent = 'Keyboard demo mode';
    if (trackingStatus) trackingStatus.textContent = 'Camera unavailable';
  }
}

function startGame() {
  if (state.hasStarted) return;
  state.hasStarted = true;
  state.isPaused = false;
  startScreen?.classList.add('hidden');
  updateHud();
  setPrompt(gestures[0]);
  spawnNote();
  requestAnimationFrame(gameLoop);
  startCamera();
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
      return;
    }

    const keyMap = {
      KeyA: 'Open Palm',
      KeyS: 'Fist',
      KeyD: 'Victory',
      KeyF: 'Pointing',
      KeyG: 'Thumbs Up',
    };

    const mappedGesture = keyMap[event.code];
    if (!mappedGesture) return;

    handleGestureInput(mappedGesture);
  });
}

if (pauseButton) {
  pauseButton.addEventListener('click', togglePause);
}

if (restartButton) {
  restartButton.addEventListener('click', restartGame);
}

if (startButton) {
  startButton.addEventListener('click', startGame);
}

function bootGame() {
  if (!lane || !promptEl || !comboEl || !scoreEl || !templeHealthEl || !enemyHealthEl || !cameraFeed || !currentGestureLabel || !attackBurst || !gestureCanvas) return;

  updateHud();
  setPrompt(gestures[0]);
}

if (typeof document !== 'undefined') {
  bootGame();
}

export { classifyHand, pointDistance, jointAngle };

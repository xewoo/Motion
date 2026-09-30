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
  noteTravelMs: 1500,
  mistakeDamage: 8,
  scoreMultiplier: 1,
  difficulty: 'medium',
  gameMode: 'solo',
  isTraining: false,
  tutorialComplete: false,
  trainingStep: 0,
  trainingAdvancing: false,
  handTracking: {
    left: { gesture: null, frames: 0 },
    right: { gesture: null, frames: 0 },
  },
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
const screenCrack = typeof document !== 'undefined' ? document.getElementById('screenCrack') : null;
const backgroundMusic = typeof document !== 'undefined' ? document.getElementById('backgroundMusic') : null;
const musicToggleButton = typeof document !== 'undefined' ? document.getElementById('musicToggleButton') : null;
const musicVolume = typeof document !== 'undefined' ? document.getElementById('musicVolume') : null;
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
const difficultyButtons = typeof document !== 'undefined' ? document.querySelectorAll('[data-difficulty]') : [];
const modeButtons = typeof document !== 'undefined' ? document.querySelectorAll('[data-mode]') : [];
const levelSelection = typeof document !== 'undefined' ? document.querySelectorAll('.level-selection') : [];
const startTitle = typeof document !== 'undefined' ? document.getElementById('startTitle') : null;
const startDescription = typeof document !== 'undefined' ? document.getElementById('startDescription') : null;
const startHint = typeof document !== 'undefined' ? document.getElementById('startHint') : null;
const tutorialScreen = typeof document !== 'undefined' ? document.getElementById('tutorialScreen') : null;
const tutorialPanel = typeof document !== 'undefined' ? document.getElementById('tutorialPanel') : null;
const tutorialProgress = typeof document !== 'undefined' ? document.getElementById('tutorialProgress') : null;
const tutorialTitle = typeof document !== 'undefined' ? document.getElementById('tutorialTitle') : null;
const tutorialInstruction = typeof document !== 'undefined' ? document.getElementById('tutorialInstruction') : null;
const tutorialSteps = typeof document !== 'undefined' ? document.querySelectorAll('.tutorial-steps span') : [];
const bestScore = typeof document !== 'undefined' ? document.getElementById('bestScore') : null;
const recordsList = typeof document !== 'undefined' ? document.getElementById('recordsList') : null;
const gameOverRecords = typeof document !== 'undefined' ? document.getElementById('gameOverRecords') : null;
let mediaPipeAttached = false;
let cameraStarted = false;

const gestures = ['Open Palm', 'Fist', 'Victory', 'Pointing', 'Thumbs Up'];
const trainingGestures = [...gestures];
const RECORDS_KEY = 'temple-guardian-records-v1';
const MUSIC_VOLUME_KEY = 'temple-guardian-music-volume-v1';
const difficultyConfig = {
  easy: { hitWindowMs: 280, nextNoteDelayMs: 900, noteTravelMs: 2200, mistakeDamage: 5, scoreMultiplier: 0.8 },
  medium: { hitWindowMs: 180, nextNoteDelayMs: 700, noteTravelMs: 1500, mistakeDamage: 8, scoreMultiplier: 1 },
  hard: { hitWindowMs: 105, nextNoteDelayMs: 440, noteTravelMs: 1050, mistakeDamage: 13, scoreMultiplier: 1.35 },
};
const modeConfig = {
  solo: { scoreMultiplier: 1 },
  dual: { scoreMultiplier: 1.35 },
  split: { scoreMultiplier: 1.6 },
};

function loadRecords() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const savedRecords = JSON.parse(window.localStorage.getItem(RECORDS_KEY) ?? '[]');
    return Array.isArray(savedRecords)
      ? savedRecords.filter((record) => Number.isFinite(record.score)).sort((first, second) => second.score - first.score).slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function renderRecordList(list, records) {
  if (!list) return;
  list.replaceChildren();
  if (!records.length) {
    const item = document.createElement('li');
    item.textContent = 'No completed runs yet.';
    list.appendChild(item);
    return;
  }
  records.forEach((record, index) => {
    const item = document.createElement('li');
    item.textContent = `#${index + 1} ${record.score} - ${record.difficulty} / ${record.mode}`;
    list.appendChild(item);
  });
}

function renderRecords(records = loadRecords()) {
  if (bestScore) bestScore.textContent = String(records[0]?.score ?? 0);
  renderRecordList(recordsList, records);
  renderRecordList(gameOverRecords, records);
}

function saveCompletedRun() {
  const records = loadRecords();
  const updatedRecords = [
    ...records,
    { score: state.score, difficulty: state.difficulty, mode: state.gameMode },
  ].sort((first, second) => second.score - first.score).slice(0, 5);
  try {
    window.localStorage.setItem(RECORDS_KEY, JSON.stringify(updatedRecords));
  } catch {
    // A private browser mode may block storage; the current run still works.
  }
  renderRecords(updatedRecords);
}
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

function updateMusicButton(isPlaying) {
  if (!musicToggleButton) return;
  musicToggleButton.textContent = `Music: ${isPlaying ? 'On' : 'Off'}`;
  musicToggleButton.setAttribute('aria-pressed', String(isPlaying));
  musicToggleButton.setAttribute('aria-label', `Turn music ${isPlaying ? 'off' : 'on'}`);
}

function setMusicVolume(value, save = true) {
  const normalizedVolume = clamp(Number(value) / 100, 0, 1);
  if (backgroundMusic) backgroundMusic.volume = normalizedVolume;
  if (musicVolume) {
    musicVolume.value = String(Math.round(normalizedVolume * 100));
    musicVolume.setAttribute('aria-valuetext', `${Math.round(normalizedVolume * 100)} percent`);
  }
  if (!save || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUSIC_VOLUME_KEY, String(normalizedVolume));
  } catch {
    // Volume still works when browser storage is unavailable.
  }
}

function restoreMusicVolume() {
  if (typeof window === 'undefined') return;
  let savedVolume = 0.45;
  try {
    const storedValue = Number(window.localStorage.getItem(MUSIC_VOLUME_KEY));
    if (Number.isFinite(storedValue)) savedVolume = storedValue;
  } catch {
    // Use the default volume when browser storage is unavailable.
  }
  setMusicVolume(savedVolume * 100, false);
}

async function toggleMusic() {
  if (!backgroundMusic) return;

  if (!backgroundMusic.paused) {
    backgroundMusic.pause();
    updateMusicButton(false);
    return;
  }

  try {
    await backgroundMusic.play();
    updateMusicButton(true);
  } catch (error) {
    updateMusicButton(false);
    console.warn('Background music could not be played.', error);
  }
}

async function startBackgroundMusic() {
  if (!backgroundMusic || !backgroundMusic.paused) return;
  try {
    await backgroundMusic.play();
  } catch (error) {
    console.warn('Background music needs a user interaction to play.', error);
  }
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
  if (cameraPanel && cameraFeed.videoWidth && cameraFeed.videoHeight) {
    cameraPanel.style.setProperty('--camera-ratio', `${cameraFeed.videoWidth} / ${cameraFeed.videoHeight}`);
  }
}

function enableCameraDragging() {
  if (!cameraPanel || !cameraHeader) return;

  cameraHeader.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input, label')) return;

    const panelRect = cameraPanel.getBoundingClientRect();
    state.dragState = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
    };
    event.preventDefault();
  });

  window.addEventListener('pointermove', (event) => {
    if (!state.dragState) return;

    const panelRect = cameraPanel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - panelRect.width);
    const maxTop = Math.max(0, window.innerHeight - panelRect.height);
    const left = clamp(event.clientX - state.dragState.offsetX, 0, maxLeft);
    const top = clamp(event.clientY - state.dragState.offsetY, 0, maxTop);

    cameraPanel.style.left = `${left}px`;
    cameraPanel.style.top = `${top}px`;
    cameraPanel.style.right = 'auto';
    cameraPanel.style.bottom = 'auto';
  });

  const stopDragging = () => {
    state.dragState = null;
  };
  window.addEventListener('pointerup', stopDragging);
  window.addEventListener('pointercancel', stopDragging);
}

function applyDifficulty(difficulty) {
  const settings = difficultyConfig[difficulty];
  if (!settings) return;

  state.difficulty = difficulty;
  Object.assign(state, settings);
  difficultyButtons.forEach((button) => {
    const isSelected = button.dataset.difficulty === difficulty;
    button.classList.toggle('selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

function applyGameMode(mode) {
  if (!modeConfig[mode]) return;
  state.gameMode = mode;
  modeButtons.forEach((button) => {
    const isSelected = button.dataset.mode === mode;
    button.classList.toggle('selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

function updateHud() {
  if (comboEl) comboEl.textContent = `${state.combo}x`;
  if (scoreEl) scoreEl.textContent = String(state.score);
  if (templeHealthEl) templeHealthEl.style.width = `${state.templeHealth}%`;
  if (enemyHealthEl) enemyHealthEl.style.width = `${state.enemyHealth}%`;
}

function setPrompt(prompt) {
  state.currentGesture = prompt;
  if (promptEl) promptEl.textContent = prompt;
  if (currentGestureLabel) currentGestureLabel.textContent = prompt;
}

function updateTrainingUi() {
  const gesture = trainingGestures[state.trainingStep];
  if (!gesture) return;
  if (tutorialProgress) tutorialProgress.textContent = `Training ${state.trainingStep + 1} / ${trainingGestures.length}`;
  if (tutorialTitle) tutorialTitle.textContent = `Show: ${gesture}`;
  if (tutorialInstruction) tutorialInstruction.textContent = 'No timer - hold the gesture clearly in front of the camera.';
  tutorialSteps.forEach((step, index) => step.classList.toggle('active', index === state.trainingStep));
  setPrompt(`Training: ${gesture}`);
}

function startTraining() {
  state.hasStarted = true;
  state.isPaused = false;
  state.isTraining = true;
  state.trainingStep = 0;
  state.trainingAdvancing = false;
  document.querySelector('.game-shell')?.classList.add('training');
  startScreen?.classList.add('hidden');
  tutorialScreen?.classList.remove('hidden');
  if (pauseButton) pauseButton.disabled = true;
  requestGameFullscreen();
  startBackgroundMusic();
  updateTrainingUi();
  startCamera();
}

function completeTrainingStep() {
  if (state.trainingAdvancing) return;
  state.trainingAdvancing = true;
  tutorialPanel?.classList.add('correct');
  showCombatFeedback('GREAT! Gesture recognized', 'success');
  triggerAttackVisual();

  setTimeout(() => {
    tutorialPanel?.classList.remove('correct');
    state.trainingStep += 1;
    state.trainingAdvancing = false;
    if (state.trainingStep < trainingGestures.length) {
      updateTrainingUi();
      return;
    }
    finishTraining();
  }, 720);
}

function finishTraining() {
  state.isTraining = false;
  state.hasStarted = false;
  state.tutorialComplete = true;
  document.querySelector('.game-shell')?.classList.remove('training');
  tutorialScreen?.classList.add('hidden');
  startScreen?.classList.remove('hidden');
  levelSelection.forEach((element) => element.classList.remove('hidden'));
  if (startTitle) startTitle.textContent = 'Training complete!';
  if (startDescription) startDescription.textContent = 'Choose a difficulty and hand mode, then defend the Temple.';
  if (startButton) startButton.textContent = 'Start level';
  if (startHint) startHint.textContent = 'Match gestures when notes reach the center line.';
  renderRecords();
}

function randomGesture(except = null) {
  const choices = except ? gestures.filter((gesture) => gesture !== except) : gestures;
  return choices[Math.floor(Math.random() * choices.length)];
}

function formatExpectedGesture(note) {
  if (note.mode === 'split') return `L: ${note.leftGesture} | R: ${note.rightGesture}`;
  if (note.mode === 'dual') return `Both: ${note.gesture}`;
  return note.gesture;
}

function spawnNote() {
  if (!lane || state.gameOver || !state.hasStarted) return;

  const note = document.createElement('div');
  const gesture = randomGesture();
  const mode = state.gameMode;
  const leftGesture = mode === 'split' ? gesture : null;
  const rightGesture = mode === 'split' ? randomGesture(gesture) : null;
  note.className = 'note';
  note.classList.toggle('two-hand-note', mode !== 'solo');
  note.textContent = formatExpectedGesture({ mode, gesture, leftGesture, rightGesture });
  lane.appendChild(note);

  const createdAt = performance.now();
  const dueAt = createdAt + state.noteTravelMs;

  state.currentNote = {
    gesture,
    mode,
    leftGesture,
    rightGesture,
    createdAt,
    dueAt,
    element: note,
    wasJudged: false,
  };

  setTimingCue(false);
  setPrompt(formatExpectedGesture(state.currentNote));
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
  const points = Math.round((100 + state.combo * 10) * state.scoreMultiplier * modeConfig[state.gameMode].scoreMultiplier);
  state.score += points;
  state.enemyHealth = Math.max(0, state.enemyHealth - 12 - state.combo * 0.8);
  const quality = diff <= 65 ? 'PERFECT' : 'GOOD';
  showCombatFeedback(`${quality}  +${points}`, 'success');
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
  state.templeHealth = Math.max(0, state.templeHealth - state.mistakeDamage);
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
  triggerScreenCrack();
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

function triggerScreenCrack() {
  if (!screenCrack) return;
  screenCrack.classList.remove('show');
  void screenCrack.offsetWidth;
  screenCrack.classList.add('show');
  setTimeout(() => screenCrack.classList.remove('show'), 720);
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
  saveCompletedRun();
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
  if (gameOverEyebrow) gameOverEyebrow.textContent = 'Temple fallen';
  if (gameOverTitle) gameOverTitle.textContent = 'Run ended';
  gameOverScreen?.classList.add('hidden');
  removeCurrentNote();
  updateHud();
  spawnNote();
  requestAnimationFrame(gameLoop);
}

function matchesCurrentNote(input) {
  if (!state.currentNote) return false;
  const { mode, gesture, leftGesture, rightGesture } = state.currentNote;
  if (mode === 'solo') {
    return typeof input === 'string' ? input === gesture : Object.values(input).includes(gesture);
  }
  if (typeof input === 'string') return false;
  if (mode === 'dual') return input.left === gesture && input.right === gesture;
  return input.left === leftGesture && input.right === rightGesture;
}

function handleGestureInput(input) {
  if (!input) return;
  if (state.isTraining) {
    const expectedGesture = trainingGestures[state.trainingStep];
    const detectedGestures = typeof input === 'string' ? [input] : Object.values(input);
    if (detectedGestures.includes(expectedGesture)) completeTrainingStep();
    return;
  }
  if (!state.hasStarted || state.isPaused) return;
  const now = performance.now();

  if (!state.currentNote) {
    return;
  }

  const diff = Math.abs(now - state.currentNote.dueAt);
  if (!matchesCurrentNote(input)) {
    if (diff <= state.hitWindowMs && !state.currentNote.wasJudged) {
      state.currentNote.wasJudged = true;
      failHit(`Wrong gestures - show ${formatExpectedGesture(state.currentNote)}`);
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
    const missedNote = state.currentNote;
    element.remove();
    state.currentNote = null;
    setTimingCue(false);
    if (!missedNote.wasJudged) failHit(`Too late - prepare ${state.currentGesture} earlier`);
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

function getMirroredHandSide(handednessLabel) {
  if (handednessLabel === 'Right') return 'left';
  if (handednessLabel === 'Left') return 'right';
  return null;
}

function resolveHandSide(handednessLabel, landmarks, occupiedSides = new Set()) {
  const preferredSide = getMirroredHandSide(handednessLabel);
  if (preferredSide && !occupiedSides.has(preferredSide)) return preferredSide;

  const wrist = landmarks?.[0];
  const screenSide = wrist && wrist.x > 0.5 ? 'left' : 'right';
  if (!occupiedSides.has(screenSide)) return screenSide;
  return screenSide === 'left' ? 'right' : 'left';
}

function stabilizeHandGesture(side, gesture) {
  const tracking = state.handTracking[side];
  if (!gesture) {
    tracking.gesture = null;
    tracking.frames = 0;
    return null;
  }

  if (tracking.gesture === gesture) {
    tracking.frames += 1;
  } else {
    tracking.gesture = gesture;
    tracking.frames = 1;
  }
  return tracking.frames >= 2 ? gesture : null;
}

function drawLandmarks(landmarks, shouldClear = true) {
  if (!gestureCtx || !gestureCanvas) return;

  const width = gestureCanvas.width;
  const height = gestureCanvas.height;

  if (shouldClear) gestureCtx.clearRect(0, 0, width, height);
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
  const detectedHands = {};
  const visibleHands = new Set();
  gestureCtx.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);

  results.multiHandLandmarks.forEach((imageLandmarks, index) => {
    const poseLandmarks = results.multiHandWorldLandmarks?.[index] ?? imageLandmarks;
    const handedness = results.multiHandedness?.[index];
    const label = handedness?.label ?? handedness?.[0]?.label ?? (index === 0 ? 'Left' : 'Right');
    const side = resolveHandSide(label, imageLandmarks, visibleHands);
    visibleHands.add(side);
    detectedHands[side] = stabilizeHandGesture(side, classifyHand(poseLandmarks));
    drawLandmarks(imageLandmarks, false);
  });

  ['left', 'right'].forEach((side) => {
    if (!visibleHands.has(side)) stabilizeHandGesture(side, null);
  });

  const needsBothHands = state.gameMode !== 'solo';
  const hasBothHands = visibleHands.has('left') && visibleHands.has('right');
  const recognized = Object.values(detectedHands).filter(Boolean);
  if (trackingStatus) {
    trackingStatus.textContent = needsBothHands && !hasBothHands
      ? 'Show both hands'
      : needsBothHands && recognized.length < 2 ? 'Hold both gestures steady'
      : recognized.length ? 'Hands detected' : 'Adjust your hands';
  }
  if (currentGestureLabel) {
    const left = detectedHands.left ?? '--';
    const right = detectedHands.right ?? '--';
    currentGestureLabel.textContent = needsBothHands ? `L: ${left} | R: ${right}` : recognized[0] ?? 'Open your palm or make a clear fist';
  }

  const readyForInput = needsBothHands ? recognized.length === 2 : recognized.length > 0;
  const now = performance.now();
  if (readyForInput && now - state.lastKnownGestureTime > 160) {
    state.lastDetectedGesture = needsBothHands ? detectedHands : recognized[0];
    handleGestureInput(needsBothHands ? detectedHands : recognized[0]);
    state.lastKnownGestureTime = now;
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
    maxNumHands: 2,
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
    width: video.videoWidth || 640,
    height: video.videoHeight || 480,
  });

  camera.start();
}

async function startCamera() {
  if (!cameraFeed || cameraStarted) return;
  cameraStarted = true;

  try {
    cameraFeed.addEventListener('resize', ensureCanvasSize);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
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
  if (!state.tutorialComplete) {
    startTraining();
    return;
  }
  if (state.hasStarted) return;
  state.hasStarted = true;
  state.isPaused = false;
  document.querySelector('.game-shell')?.classList.remove('training');
  startScreen?.classList.add('hidden');
  if (pauseButton) pauseButton.disabled = false;
  updateHud();
  setPrompt(gestures[0]);
  spawnNote();
  requestAnimationFrame(gameLoop);
  startCamera();
}

function requestGameFullscreen() {
  const fullscreenTarget = document.documentElement;
  if (!fullscreenTarget?.requestFullscreen || document.fullscreenElement) return;
  fullscreenTarget.requestFullscreen().catch(() => {
    // Some mobile browsers keep the game in viewport mode; the responsive layout still fills it.
  });
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

if (backgroundMusic) {
  backgroundMusic.addEventListener('play', () => updateMusicButton(true));
  backgroundMusic.addEventListener('pause', () => updateMusicButton(false));
}

if (musicToggleButton) {
  musicToggleButton.addEventListener('click', toggleMusic);
  updateMusicButton(backgroundMusic ? !backgroundMusic.paused : false);
}

if (musicVolume) {
  musicVolume.addEventListener('input', () => setMusicVolume(musicVolume.value));
}

if (restartButton) {
  restartButton.addEventListener('click', restartGame);
}

if (startButton) {
  startButton.addEventListener('click', startGame);
}

difficultyButtons.forEach((button) => {
  button.addEventListener('click', () => applyDifficulty(button.dataset.difficulty));
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => applyGameMode(button.dataset.mode));
});

function bootGame() {
  if (!lane || !promptEl || !comboEl || !scoreEl || !templeHealthEl || !enemyHealthEl || !cameraFeed || !currentGestureLabel || !attackBurst || !gestureCanvas) return;

  updateHud();
  setPrompt(gestures[0]);
  applyDifficulty('medium');
  applyGameMode('solo');
  renderRecords();
  restoreMusicVolume();
  enableCameraDragging();
}

if (typeof document !== 'undefined') {
  bootGame();
}

export { classifyHand, getMirroredHandSide, resolveHandSide, pointDistance, jointAngle };

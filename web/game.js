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
};

const lane = document.getElementById('noteLane');
const promptEl = document.getElementById('gesturePrompt');
const comboEl = document.getElementById('comboValue');
const scoreEl = document.getElementById('scoreValue');
const templeHealthEl = document.getElementById('templeHealth');
const enemyHealthEl = document.getElementById('enemyHealth');
const cameraFeed = document.getElementById('cameraFeed');
const currentGestureLabel = document.getElementById('currentGestureLabel');
const attackBurst = document.getElementById('attackBurst');
const gestureCanvas = document.getElementById('gestureCanvas');
const gestureCtx = gestureCanvas.getContext('2d');

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

function updateHud() {
  comboEl.textContent = `${state.combo}x`;
  scoreEl.textContent = String(state.score);
  templeHealthEl.style.width = `${state.templeHealth}%`;
  enemyHealthEl.style.width = `${state.enemyHealth}%`;
}

function setPrompt(gesture) {
  state.currentGesture = gesture;
  promptEl.textContent = gesture;
  currentGestureLabel.textContent = gesture;
}

function spawnNote() {
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

  setPrompt(gesture);
}

function removeCurrentNote() {
  if (!state.currentNote) return;
  state.currentNote.element.remove();
  state.currentNote = null;
}

function scheduleNextNote() {
  setTimeout(() => {
    if (!state.currentNote) {
      spawnNote();
    }
  }, state.nextNoteDelayMs);
}

function triggerAttackVisual() {
  attackBurst.classList.remove('hidden');
  attackBurst.classList.add('show');

  document.querySelectorAll('.monster').forEach((monster) => {
    monster.classList.remove('monster-hit');
    void monster.offsetWidth;
    monster.classList.add('monster-hit');
  });

  const temple = document.querySelector('.temple');
  if (temple) {
    temple.classList.remove('temple-hit');
    void temple.offsetWidth;
    temple.classList.add('temple-hit');
  }

  setTimeout(() => {
    attackBurst.classList.remove('show');
    attackBurst.classList.add('hidden');
    document.querySelectorAll('.monster').forEach((monster) => monster.classList.remove('monster-hit'));
    if (temple) temple.classList.remove('temple-hit');
  }, 500);
}

function hitSuccess() {
  state.combo += 1;
  state.score += 100 + state.combo * 10;
  state.enemyHealth = Math.max(0, state.enemyHealth - 12 - state.combo * 0.8);
  triggerAttackVisual();

  if (state.enemyHealth === 0) {
    state.wave += 1;
    state.enemyHealth = 100;
    state.score += 500;
  }

  updateHud();
}

function failHit() {
  state.combo = 0;
  state.templeHealth = Math.max(0, state.templeHealth - 8);
  const temple = document.querySelector('.temple');
  if (temple) {
    temple.classList.remove('temple-hit');
    void temple.offsetWidth;
    temple.classList.add('temple-hit');
  }
  updateHud();
}

function handleGestureInput(gesture) {
  if (!gesture) return;
  const now = performance.now();

  if (!state.currentNote) {
    return;
  }

  const diff = Math.abs(now - state.currentNote.dueAt);
  if (gesture !== state.currentNote.gesture) {
    if (diff <= state.hitWindowMs) {
      failHit();
    }
    return;
  }

  if (diff <= state.hitWindowMs) {
    removeCurrentNote();
    hitSuccess();
    scheduleNextNote();
    return;
  }
}

function updateNotePosition(now) {
  if (!state.currentNote) return;

  const { createdAt, dueAt, element } = state.currentNote;
  const total = dueAt - createdAt;
  const elapsed = now - createdAt;
  const progress = clamp(elapsed / total, 0, 1.2);
  const y = 20 + progress * 170;

  element.style.top = `${y}px`;

  if (now > dueAt + state.hitWindowMs) {
    element.remove();
    state.currentNote = null;
    failHit();
    scheduleNextNote();
  }
}

function gameLoop(now) {
  updateNotePosition(now);
  requestAnimationFrame(gameLoop);
}

function fingerExtended(landmarks, tipIndex, pipIndex, mcpIndex) {
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];
  const mcp = landmarks[mcpIndex];

  return tip.y < pip.y && pip.y < mcp.y;
}

function thumbExtended(landmarks) {
  const tip = landmarks[4];
  const joint = landmarks[3];
  const wrist = landmarks[2];

  return tip.y < joint.y && joint.y < wrist.y;
}

function classifyHand(landmarks) {
  const indexExtended = fingerExtended(landmarks, 8, 6, 5);
  const middleExtended = fingerExtended(landmarks, 12, 10, 9);
  const ringExtended = fingerExtended(landmarks, 16, 14, 13);
  const pinkyExtended = fingerExtended(landmarks, 20, 18, 17);
  const thumbIsExtended = thumbExtended(landmarks);

  if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
    return 'Victory';
  }

  if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Pointing';
  }

  if (thumbIsExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Thumbs Up';
  }

  if (indexExtended && middleExtended && ringExtended && pinkyExtended && thumbIsExtended) {
    return 'Open Palm';
  }

  if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'Fist';
  }

  return null;
}

function drawLandmarks(landmarks) {
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
  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    gestureCtx.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const detectedGesture = classifyHand(landmarks);
  drawLandmarks(landmarks);

  if (detectedGesture) {
    state.lastDetectedGesture = detectedGesture;
    currentGestureLabel.textContent = detectedGesture;
    const now = performance.now();
    if (now - state.lastKnownGestureTime > 200) {
      handleGestureInput(detectedGesture);
      state.lastKnownGestureTime = now;
    }
  }
}

function attachMediaPipe() {
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
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(onHandResults);

  const camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 320,
    height: 240,
  });

  camera.start();
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    cameraFeed.srcObject = stream;

    cameraFeed.onloadedmetadata = () => {
      gestureCanvas.width = cameraFeed.videoWidth || 320;
      gestureCanvas.height = cameraFeed.videoHeight || 240;
      attachMediaPipe();
    };
  } catch (error) {
    console.warn('Camera access denied or unavailable; demo mode remains active.', error);
    currentGestureLabel.textContent = 'Demo mode';
  }
}

window.addEventListener('keydown', (event) => {
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

function bootGame() {
  updateHud();
  setPrompt(gestures[0]);
  spawnNote();
  requestAnimationFrame(gameLoop);
  startCamera();
}

bootGame();

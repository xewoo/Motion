import {
  createRecognitionState,
  detectGrabbing,
  detectSixSeven,
  facialExpression,
  gestureLabel,
  HAND_CONNECTIONS,
  stabilizeExpression,
  stabilizeGesture,
} from "./recognition.js";

let FaceLandmarker;
let FilesetResolver;
let GestureRecognizer;
let ObjectDetector;
const MODEL_URLS = {
  gesture: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
  object: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const OBJECT_DETECTION_INTERVAL = 3;
const FACE_DETECTION_INTERVAL = 2;
const GESTURE_LABELS_RU = {
  "Open palm": "Открытая ладонь",
  Fist: "Кулак",
  "Pointing up": "Указание",
  "Thumbs down": "Палец вниз",
  "Thumbs up": "Палец вверх",
  Victory: "Победа",
  "I Love You": "Я тебя люблю",
  "Middle finger": "Средний палец",
  Grabbing: "Захват",
  "Six-seven (67)": "Six-seven (67)",
  "Unknown gesture": "Жест не распознан",
  "No known gesture": "Неизвестный жест",
};
const EXPRESSION_LABELS_RU = {
  Happy: "Радость",
  Surprised: "Удивление",
  Sad: "Грусть",
  Angry: "Злость",
  Neutral: "Нейтральное",
};
const DATASET_GESTURES = ["open_palm", "fist", "peace", "pointing", "thumbs_up"];
const CSV_COLUMNS = [
  "timestamp_utc", "gesture", "hand_index", "handedness", "handedness_score",
  ...Array.from({ length: 21 }, (_, index) => [`x${index}`, `y${index}`, `z${index}`]).flat(),
];

const elements = {
  camera: document.querySelector("#camera"),
  overlay: document.querySelector("#overlay"),
  cameraFrame: document.querySelector("#cameraFrame"),
  placeholder: document.querySelector("#placeholder"),
  statusMessage: document.querySelector("#statusMessage"),
  systemStatus: document.querySelector("#systemStatus"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  captureButton: document.querySelector("#captureButton"),
  downloadButton: document.querySelector("#downloadButton"),
  sampleLabel: document.querySelector("#sampleLabel"),
  sampleCount: document.querySelector("#sampleCount"),
  objectsToggle: document.querySelector("#objectsToggle"),
  facesToggle: document.querySelector("#facesToggle"),
  meshToggle: document.querySelector("#meshToggle"),
  gestureValue: document.querySelector("#gestureValue"),
  gestureDetail: document.querySelector("#gestureDetail"),
  handsValue: document.querySelector("#handsValue"),
  objectsValue: document.querySelector("#objectsValue"),
  facesValue: document.querySelector("#facesValue"),
  fpsValue: document.querySelector("#fpsValue"),
};

const context = elements.overlay.getContext("2d");
const recognitionState = createRecognitionState();
const datasetRows = [];
let cameraStream = null;
let gestureRecognizer = null;
let objectDetector = null;
let faceLandmarker = null;
let animationFrame = null;
let lastVideoTime = -1;
let lastTimestamp = -1;
let frameCount = 0;
let currentResult = null;
let objectDetections = [];
let faceResult = null;
let intervalStarted = performance.now();
let processedFrames = 0;
let fps = 0;
let stopping = false;

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("is-error", isError);
}

function setRunning(running) {
  elements.startButton.disabled = running;
  elements.stopButton.disabled = !running;
  elements.captureButton.disabled = !running;
  elements.systemStatus.textContent = running ? "В РАБОТЕ" : "ОЖИДАНИЕ";
  elements.systemStatus.classList.toggle("is-live", running);
  elements.cameraFrame.classList.toggle("is-live", running);
}

function closeVisionTasks() {
  for (const [name, task] of [
    ["Gesture Recognizer", gestureRecognizer],
    ["Object Detector", objectDetector],
    ["Face Landmarker", faceLandmarker],
  ]) {
    if (task) {
      try {
        task.close();
      } catch (error) {
        console.error(`Could not close ${name}:`, error);
      }
    }
  }
  gestureRecognizer = null;
  objectDetector = null;
  faceLandmarker = null;
}

async function createVisionTasks() {
  setStatus("Загружаем модели распознавания…");
  ({ FaceLandmarker, FilesetResolver, GestureRecognizer, ObjectDetector } = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs"
  ));
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URLS.gesture },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    cannedGesturesClassifierOptions: { maxResults: 8, scoreThreshold: 0.15 },
  });
  objectDetector = await ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URLS.object },
    runningMode: "VIDEO",
    maxResults: 5,
    scoreThreshold: 0.45,
  });
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URLS.face },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
  });
}

async function startCamera() {
  elements.startButton.disabled = true;
  setStatus("Запрашиваем доступ к камере…");
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    elements.camera.srcObject = cameraStream;
    await elements.camera.play();
    await createVisionTasks();
    lastVideoTime = -1;
    lastTimestamp = -1;
    frameCount = 0;
    intervalStarted = performance.now();
    processedFrames = 0;
    setRunning(true);
    setStatus("Камера активна. Покажите жест в кадре.");
    animationFrame = requestAnimationFrame(processFrame);
    for (const track of cameraStream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (!stopping && cameraStream) {
          stopCamera("Камера была отключена.");
        }
      }, { once: true });
    }
  } catch (error) {
    stopCamera();
    const reason = error instanceof Error ? error.message : String(error);
    setStatus(`Не удалось запустить камеру или модели: ${reason}`, true);
    setRunning(false);
  }
}

function stopCamera(message = "Камера выключена.") {
  stopping = true;
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  elements.camera.srcObject = null;
  closeVisionTasks();
  context.clearRect(0, 0, elements.overlay.width, elements.overlay.height);
  currentResult = null;
  objectDetections = [];
  faceResult = null;
  updateSummary(null);
  setRunning(false);
  setStatus(message);
  stopping = false;
}

function processFrame(now) {
  try {
    if (!cameraStream || !gestureRecognizer || elements.camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrame = requestAnimationFrame(processFrame);
      return;
    }
    if (elements.camera.currentTime !== lastVideoTime) {
      lastVideoTime = elements.camera.currentTime;
      const timestamp = Math.max(Math.floor(now), lastTimestamp + 1);
      lastTimestamp = timestamp;
      currentResult = gestureRecognizer.recognizeForVideo(elements.camera, timestamp);
      if (elements.objectsToggle.checked && frameCount % OBJECT_DETECTION_INTERVAL === 0) {
        objectDetections = objectDetector.detectForVideo(elements.camera, timestamp).detections;
      } else if (!elements.objectsToggle.checked) {
        objectDetections = [];
      }
      if (elements.facesToggle.checked && frameCount % FACE_DETECTION_INTERVAL === 0) {
        faceResult = faceLandmarker.detectForVideo(elements.camera, timestamp);
      } else if (!elements.facesToggle.checked) {
        faceResult = null;
      }
      const sixSevenScore = detectSixSeven(currentResult.landmarks, recognitionState, now / 1000);
      const grabbingScores = detectGrabbing(currentResult.worldLandmarks, currentResult.landmarks, recognitionState);
      drawFrame(currentResult, sixSevenScore, grabbingScores);
      updateSummary(currentResult, sixSevenScore, grabbingScores);
      frameCount += 1;
      processedFrames += 1;
      if (now - intervalStarted >= 1000) {
        fps = Math.round(processedFrames * 1000 / (now - intervalStarted));
        processedFrames = 0;
        intervalStarted = now;
        elements.fpsValue.textContent = String(fps);
      }
    }
    animationFrame = requestAnimationFrame(processFrame);
  } catch (error) {
    console.error("Live recognition failed:", error);
    stopCamera();
    const reason = error instanceof Error ? error.message : String(error);
    setStatus(`Ошибка распознавания: ${reason}`, true);
  }
}

function displayGesture(rawLabel) {
  return GESTURE_LABELS_RU[rawLabel] ?? rawLabel;
}

function drawFrame(result, sixSevenScore, grabbingScores) {
  const width = elements.camera.videoWidth;
  const height = elements.camera.videoHeight;
  if (!width || !height) return;
  if (elements.overlay.width !== width || elements.overlay.height !== height) {
    elements.overlay.width = width;
    elements.overlay.height = height;
  }
  context.clearRect(0, 0, width, height);
  const scale = Math.max(1, width / 640);
  context.lineWidth = 2 * scale;
  context.lineCap = "round";
  context.lineJoin = "round";

  result.landmarks.forEach((landmarks, handIndex) => {
    const points = landmarks.map(point => [point.x * width, point.y * height]);
    context.strokeStyle = "#50dc78";
    for (const [start, end] of HAND_CONNECTIONS) {
      context.beginPath();
      context.moveTo(...points[start]);
      context.lineTo(...points[end]);
      context.stroke();
    }
    context.fillStyle = "#2850ff";
    for (const [x, y] of points) {
      context.beginPath();
      context.arc(x, y, 3.5 * scale, 0, Math.PI * 2);
      context.fill();
    }

    let [label, score] = gestureLabel(result, handIndex);
    if (sixSevenScore !== null) {
      label = "Six-seven (67)";
      score = sixSevenScore;
    } else if (grabbingScores[handIndex] !== null && grabbingScores[handIndex] !== undefined) {
      label = "Grabbing";
      score = grabbingScores[handIndex];
    } else {
      [label, score] = stabilizeGesture(label, score, recognitionState.gestureHistory[handIndex]);
    }
    const handedness = result.handedness?.[handIndex]?.[0]?.categoryName ?? "Hand";
    const labelText = `${displayGesture(label)} · ${handedness} ${Math.round(score * 100)}%`;
    const left = Math.min(...points.map(([x]) => x));
    const top = Math.min(...points.map(([, y]) => y));
    drawCanvasLabel(labelText, left, top - 8 * scale, "#267642", scale, width, height);
  });

  if (elements.objectsToggle.checked) drawObjects(objectDetections, width, height, scale);
  if (elements.facesToggle.checked && faceResult) drawFaces(faceResult, scale, width, height);
}

function drawCanvasLabel(text, x, baselineY, background, scale, width, height) {
  const fontSize = Math.max(13, Math.min(19, width / 58));
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  const paddingX = 7 * scale;
  const boxHeight = fontSize + 10 * scale;
  const boxWidth = context.measureText(text).width + paddingX * 2;
  const left = Math.max(0, Math.min(x, width - boxWidth));
  const top = Math.max(0, Math.min(baselineY - boxHeight, height - boxHeight));
  context.fillStyle = background;
  context.beginPath();
  context.roundRect(left, top, boxWidth, boxHeight, 5 * scale);
  context.fill();
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  context.fillText(text, left + paddingX, top + boxHeight / 2);
}

function drawObjects(detections, width, height, scale) {
  context.lineWidth = 2 * scale;
  for (const detection of detections) {
    const box = detection.boundingBox;
    const left = Math.max(0, box.originX);
    const top = Math.max(0, box.originY);
    const right = Math.min(width, left + box.width);
    const bottom = Math.min(height, top + box.height);
    context.strokeStyle = "#f5be60";
    context.strokeRect(left, top, right - left, bottom - top);
    const category = detection.categories?.[0];
    const name = category?.displayName || category?.categoryName || "Объект";
    drawCanvasLabel(
      `${name} ${Math.round((category?.score ?? 0) * 100)}%`,
      left,
      top - 5 * scale,
      "#aa5f14",
      scale,
      width,
      height,
    );
  }
}

function drawFaces(result, scale, width, height) {
  const fullMesh = elements.meshToggle.checked;
  const edgeSets = fullMesh
    ? [FaceLandmarker.FACE_LANDMARKS_TESSELATION]
    : [
      FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
      FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
      FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
      FaceLandmarker.FACE_LANDMARKS_LIPS,
    ];
  result.faceLandmarks.forEach((landmarks, faceIndex) => {
    const blendshapes = result.faceBlendshapes?.[faceIndex] ?? [];
    let [expression, score] = facialExpression(blendshapes);
    const history = recognitionState.faceExpressionHistory[faceIndex] ?? [];
    recognitionState.faceExpressionHistory[faceIndex] = history;
    [expression, score] = stabilizeExpression(expression, score, history);
    context.strokeStyle = fullMesh ? "rgba(235, 241, 255, .42)" : "#64e1cd";
    context.lineWidth = (fullMesh ? 0.55 : 1.2) * scale;
    for (const edgeSet of edgeSets) {
      for (const edge of edgeSet) {
        const first = landmarks[edge.start];
        const last = landmarks[edge.end];
        if (!first || !last) continue;
        context.beginPath();
        context.moveTo(first.x * width, first.y * height);
        context.lineTo(last.x * width, last.y * height);
        context.stroke();
      }
    }
    const left = Math.min(...landmarks.map(point => point.x * width));
    const top = Math.min(...landmarks.map(point => point.y * height));
    const expressionRu = EXPRESSION_LABELS_RU[expression] ?? expression;
    drawCanvasLabel(
      `Мимика: ${expressionRu} ${Math.round(score * 100)}%`,
      left,
      top - 7 * scale,
      "#735019",
      scale,
      width,
      height,
    );
  });
}

function updateSummary(result, sixSevenScore = null, grabbingScores = []) {
  const hands = result?.landmarks ?? [];
  elements.handsValue.textContent = String(hands.length);
  elements.objectsValue.textContent = String(elements.objectsToggle.checked ? objectDetections.length : 0);
  elements.facesValue.textContent = String(elements.facesToggle.checked ? faceResult?.faceLandmarks?.length ?? 0 : 0);
  if (!hands.length) {
    elements.gestureValue.textContent = "—";
    elements.gestureDetail.textContent = "Покажите руку камере";
    return;
  }
  let [label, score] = gestureLabel(result, 0);
  if (sixSevenScore !== null) {
    label = "Six-seven (67)";
    score = sixSevenScore;
  } else if (grabbingScores[0] !== null && grabbingScores[0] !== undefined) {
    label = "Grabbing";
    score = grabbingScores[0];
  }
  elements.gestureValue.textContent = displayGesture(label);
  elements.gestureDetail.textContent = `Уверенность ${Math.round(score * 100)}%`;
}

function captureSamples() {
  const hands = currentResult?.landmarks ?? [];
  if (!hands.length) {
    setStatus("Рука не обнаружена: пример не сохранён.", true);
    return;
  }
  const label = elements.sampleLabel.value;
  const timestamp = new Date().toISOString();
  for (const [handIndex, landmarks] of hands.entries()) {
    const handedness = currentResult.handedness?.[handIndex]?.[0];
    const row = [
      timestamp,
      label,
      handIndex,
      handedness?.categoryName ?? "Unknown",
      handedness?.score ?? "",
    ];
    for (const point of landmarks) row.push(point.x, point.y, point.z);
    datasetRows.push(row);
  }
  updateDatasetControls();
  setStatus(`Сохранено рук: ${hands.length}; метка «${label}».`);
}

function csvEscape(value) {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadDataset() {
  if (!datasetRows.length) return;
  const csv = [CSV_COLUMNS, ...datasetRows].map(row => row.map(csvEscape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "landmarks.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Файл landmarks.csv скачан.");
}

function updateDatasetControls() {
  const handsSaved = datasetRows.length;
  elements.sampleCount.textContent = `${handsSaved} ${handsSaved === 1 ? "рука" : "рук"} сохранено`;
  elements.downloadButton.disabled = handsSaved === 0;
}

elements.startButton.addEventListener("click", startCamera);
elements.stopButton.addEventListener("click", () => stopCamera());
elements.captureButton.addEventListener("click", captureSamples);
elements.downloadButton.addEventListener("click", downloadDataset);
elements.objectsToggle.addEventListener("change", () => {
  if (!elements.objectsToggle.checked) objectDetections = [];
  updateSummary(currentResult);
});
elements.facesToggle.addEventListener("change", () => {
  if (!elements.facesToggle.checked) faceResult = null;
  updateSummary(currentResult);
});
document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
  const label = DATASET_GESTURES[Number(event.key) - 1];
  if (!label) return;
  elements.sampleLabel.value = label;
  captureSamples();
});
window.addEventListener("beforeunload", () => {
  if (cameraStream) for (const track of cameraStream.getTracks()) track.stop();
  closeVisionTasks();
});

if (!navigator.mediaDevices?.getUserMedia) {
  elements.startButton.disabled = true;
  setStatus("Браузер не поддерживает доступ к камере. Откройте страницу через localhost или HTTPS.", true);
}

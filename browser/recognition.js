export const GESTURE_NAMES = {
  Closed_Fist: "Fist",
  Open_Palm: "Open palm",
  Pointing_Up: "Pointing up",
  Thumb_Down: "Thumbs down",
  Thumb_Up: "Thumbs up",
  Victory: "Victory",
  ILoveYou: "I love you",
};

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 17], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
];

export const GESTURE_SCORE_THRESHOLD = 0.55;

export function pointDistance(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const dz = first.z - second.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function physicalHandedness(reportedHandedness) {
  // MediaPipe assumes mirrored input, while the camera frame is passed unmirrored.
  if (reportedHandedness === "Left") return "Right";
  if (reportedHandedness === "Right") return "Left";
  return reportedHandedness;
}

export function detectZoomPinch(result) {
  if (result.landmarks?.length !== 1) return null;
  const reportedHandedness = result.handedness?.[0]?.[0]?.categoryName;
  if (physicalHandedness(reportedHandedness) !== "Right") return null;

  const landmarks = result.worldLandmarks?.[0] ?? result.landmarks[0];
  if (!landmarks || landmarks.length < 21) return null;
  const curled = [[9, 10, 12], [13, 14, 16], [17, 18, 20]].every(([mcp, pip, tip]) => (
    jointAngle(landmarks[mcp], landmarks[pip], landmarks[tip]) <= 135
  ));
  if (!curled) return null;

  const palmWidth = pointDistance(landmarks[5], landmarks[17]);
  if (palmWidth < 1e-6) return null;
  return pointDistance(landmarks[4], landmarks[8]) / palmWidth;
}

export function pinchZoomTarget(anchorScale, anchorPinch, pinchDistance) {
  const delta = pinchDistance - anchorPinch;
  const effectiveDelta = Math.sign(delta) * Math.max(0, Math.abs(delta) - 0.06);
  return Math.max(1, Math.min(2.5, anchorScale + effectiveDelta * 8));
}

export function smoothZoom(current, target, elapsedMs) {
  const smoothing = 1 - Math.exp(-Math.max(0, elapsedMs) / 120);
  return current + (target - current) * smoothing;
}

export function jointAngle(first, middle, last) {
  const firstVector = [first.x - middle.x, first.y - middle.y, first.z - middle.z];
  const lastVector = [last.x - middle.x, last.y - middle.y, last.z - middle.z];
  const firstLength = Math.hypot(...firstVector);
  const lastLength = Math.hypot(...lastVector);
  if (!firstLength || !lastLength) return 0;
  const dot = firstVector.reduce((sum, value, index) => sum + value * lastVector[index], 0);
  const cosine = Math.max(-1, Math.min(1, dot / (firstLength * lastLength)));
  return Math.acos(cosine) * (180 / Math.PI);
}

export function isLoveYouPosture(landmarks) {
  const indexAngle = jointAngle(landmarks[5], landmarks[6], landmarks[8]);
  const middleAngle = jointAngle(landmarks[9], landmarks[10], landmarks[12]);
  const ringAngle = jointAngle(landmarks[13], landmarks[14], landmarks[16]);
  const pinkyAngle = jointAngle(landmarks[17], landmarks[18], landmarks[20]);
  const thumbAngle = jointAngle(landmarks[2], landmarks[3], landmarks[4]);
  const thumbExtension = pointDistance(landmarks[4], landmarks[5])
    / Math.max(pointDistance(landmarks[2], landmarks[5]), 1e-6);

  const matches = indexAngle >= 150
    && middleAngle <= 140
    && ringAngle <= 140
    && pinkyAngle >= 150
    && thumbAngle >= 135
    && thumbExtension >= 1.12;
  const margins = [
    (indexAngle - 140) / 40,
    (140 - middleAngle) / 40,
    (140 - ringAngle) / 40,
    (pinkyAngle - 140) / 40,
    (thumbAngle - 125) / 55,
    (thumbExtension - 1.0) / 0.5,
  ];
  const confidence = 0.65 + 0.35 * Math.max(0, Math.min(1, ...margins));
  return { matches, confidence };
}

export function isOpenPalm(landmarks) {
  const fingerJoints = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
  return fingerJoints.every(([mcp, pip, tip]) => (
    jointAngle(landmarks[mcp], landmarks[pip], landmarks[tip]) >= 145
  ));
}

export function classifyHandPose(landmarks) {
  const fingerAngles = {
    index: jointAngle(landmarks[5], landmarks[6], landmarks[8]),
    middle: jointAngle(landmarks[9], landmarks[10], landmarks[12]),
    ring: jointAngle(landmarks[13], landmarks[14], landmarks[16]),
    pinky: jointAngle(landmarks[17], landmarks[18], landmarks[20]),
  };
  const extended = Object.fromEntries(
    Object.entries(fingerAngles).map(([finger, angle]) => [finger, angle >= 150]),
  );
  const curled = Object.fromEntries(
    Object.entries(fingerAngles).map(([finger, angle]) => [finger, angle <= 135]),
  );
  const thumbAngle = jointAngle(landmarks[2], landmarks[3], landmarks[4]);
  const thumbExtension = pointDistance(landmarks[4], landmarks[5])
    / Math.max(pointDistance(landmarks[2], landmarks[5]), 1e-6);
  const thumbExtended = thumbAngle >= 135 && thumbExtension >= 1.12;
  let pose;

  if (extended.middle && curled.index && curled.ring && curled.pinky) {
    pose = [
      "Middle finger",
      (fingerAngles.middle + 405 - fingerAngles.index - fingerAngles.ring - fingerAngles.pinky) / 540,
    ];
  } else if (extended.index && extended.middle && curled.ring && curled.pinky) {
    pose = [
      "Victory",
      (fingerAngles.index + fingerAngles.middle + 270 - fingerAngles.ring - fingerAngles.pinky) / 540,
    ];
  } else if (extended.index && curled.middle && curled.ring && curled.pinky) {
    pose = [
      "Pointing up",
      (fingerAngles.index + 405 - fingerAngles.middle - fingerAngles.ring - fingerAngles.pinky) / 540,
    ];
  } else if (Object.values(extended).every(Boolean) && thumbExtended) {
    pose = ["Open palm", Math.min(1, Object.values(fingerAngles).reduce((sum, value) => sum + value, 0) / 720)];
  } else if (
    thumbExtended
    && Object.values(curled).every(Boolean)
    && Math.abs(landmarks[4].y - landmarks[0].y) > 0.04
  ) {
    const vertical = landmarks[4].y - landmarks[0].y;
    pose = [vertical < 0 ? "Thumbs up" : "Thumbs down", Math.min(0.95, 0.7 + Math.abs(vertical))];
  } else if (Object.values(curled).every(Boolean)) {
    const sum = Object.values(fingerAngles).reduce((total, value) => total + value, 0);
    pose = ["Fist", Math.min(1, (540 - sum) / 540 + 0.65)];
  }

  if (!pose) return null;
  return [pose[0], Math.max(0.55, Math.min(0.99, pose[1]))];
}

export function gestureLabel(result, handIndex) {
  const worldLandmarks = result.worldLandmarks?.[handIndex];
  if (worldLandmarks) {
    const loveYou = isLoveYouPosture(worldLandmarks);
    if (loveYou.matches) return ["I Love You", loveYou.confidence];
    const pose = classifyHandPose(worldLandmarks);
    if (pose) return pose;
  }

  const categories = result.gestures?.[handIndex] ?? [];
  for (const category of categories) {
    if (category.categoryName === "None" || category.categoryName === "ILoveYou") continue;
    if (category.score < GESTURE_SCORE_THRESHOLD) continue;
    return [GESTURE_NAMES[category.categoryName] ?? category.categoryName, category.score];
  }
  return categories.length ? ["No known gesture", 0] : ["Unknown gesture", 0];
}

export function createRecognitionState() {
  return {
    gestureHistory: [[], []],
    sixSevenHistory: [],
    grabbingStates: [],
    faceExpressionHistory: [[]],
  };
}

export function stabilizeGesture(label, score, history) {
  history.push([label, score]);
  if (history.length > 5) history.shift();
  const counts = new Map();
  for (const [candidate, confidence] of history) {
    if (confidence >= GESTURE_SCORE_THRESHOLD && candidate !== "Unknown gesture" && candidate !== "No known gesture") {
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
  }
  const [stableLabel, count] = [...counts.entries()].sort((first, second) => second[1] - first[1])[0] ?? [];
  if (count < 2) return [label, score];
  const matchingScores = history.filter(([candidate]) => candidate === stableLabel).map(([, value]) => value);
  return [stableLabel, matchingScores.reduce((sum, value) => sum + value, 0) / matchingScores.length];
}

export function detectGrabbing(worldLandmarks, imageLandmarks, state) {
  const hands = worldLandmarks?.length ? worldLandmarks : imageLandmarks;
  while (state.grabbingStates.length < hands.length) {
    state.grabbingStates.push({ open: false, active: false });
  }
  if (!hands.length) {
    for (const handState of state.grabbingStates) {
      handState.open = false;
      handState.active = false;
    }
    return [];
  }

  return hands.map((landmarks, index) => {
    const handState = state.grabbingStates[index];
    const pose = classifyHandPose(landmarks);
    if (pose?.[0] === "Open palm") {
      handState.open = true;
      handState.active = false;
      return null;
    }
    if (pose?.[0] === "Fist") {
      if (handState.open) {
        handState.active = true;
        handState.open = false;
      }
      return handState.active ? Math.min(0.99, 0.72 + (pose[1] - 0.55) * 0.5) : null;
    }
    handState.open = false;
    handState.active = false;
    return null;
  });
}

export function detectSixSeven(hands, state, timestamp) {
  if (hands.length !== 2 || !hands.every(isOpenPalm)) {
    state.sixSevenHistory.length = 0;
    return null;
  }
  const sorted = [...hands].sort((first, second) => first[0].x - second[0].x);
  const verticalDifference = sorted[0][0].y - sorted[1][0].y;
  state.sixSevenHistory.push([timestamp, verticalDifference]);
  while (state.sixSevenHistory.length && timestamp - state.sixSevenHistory[0][0] > 1.2) {
    state.sixSevenHistory.shift();
  }
  const history = state.sixSevenHistory;
  if (history.length < 8 || history.at(-1)[0] - history[0][0] < 0.3) return null;

  const values = history.map(([, difference]) => difference);
  const signs = values.map(value => value > 0.055 ? 1 : value < -0.055 ? -1 : 0).filter(Boolean);
  let reversals = 0;
  for (let index = 1; index < signs.length; index += 1) {
    if (signs[index] !== signs[index - 1]) reversals += 1;
  }
  const amplitude = Math.max(...values) - Math.min(...values);
  if (reversals < 2 || amplitude < 0.12) return null;
  return Math.min(0.99, 0.62 + 0.06 * reversals + Math.min(0.18, amplitude));
}

export function facialExpression(blendshapeResult) {
  const categories = Array.isArray(blendshapeResult)
    ? blendshapeResult
    : Array.isArray(blendshapeResult?.categories) ? blendshapeResult.categories : [];
  const scores = Object.fromEntries(categories.map(category => [category.categoryName, category.score]));
  const average = (first, second) => ((scores[first] ?? 0) + (scores[second] ?? 0)) / 2;
  const expressions = {
    Happy: average("mouthSmileLeft", "mouthSmileRight"),
    Surprised: 0.35 * (scores.browInnerUp ?? 0)
      + 0.30 * average("eyeWideLeft", "eyeWideRight")
      + 0.35 * (scores.jawOpen ?? 0),
    Sad: 0.55 * average("mouthFrownLeft", "mouthFrownRight")
      + 0.45 * (scores.browInnerUp ?? 0),
    Angry: 0.55 * average("browDownLeft", "browDownRight")
      + 0.45 * average("mouthPressLeft", "mouthPressRight"),
  };
  const [label, confidence] = Object.entries(expressions).sort((first, second) => second[1] - first[1])[0];
  return confidence < 0.34 ? ["Neutral", 1 - confidence] : [label, confidence];
}

export function stabilizeExpression(label, score, history) {
  history.push([label, score]);
  if (history.length > 3) history.shift();
  const counts = new Map();
  for (const [candidate] of history) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  const [stableLabel, count] = [...counts.entries()].sort((first, second) => second[1] - first[1])[0];
  if (count < 2) return [label, score];
  const matchingScores = history.filter(([candidate]) => candidate === stableLabel).map(([, value]) => value);
  return [stableLabel, matchingScores.reduce((sum, value) => sum + value, 0) / matchingScores.length];
}

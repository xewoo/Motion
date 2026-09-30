import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyHandPose,
  createRecognitionState,
  detectZoomPinch,
  detectGrabbing,
  detectSixSeven,
  facialExpression,
  gestureLabel,
  isLoveYouPosture,
  pinchZoomTarget,
  physicalHandedness,
  smoothZoom,
  stabilizeGesture,
} from "./recognition.js";

const point = (x, y, z = 0) => ({ x, y, z });

function makePose(extendedFingers) {
  const landmarks = Array.from({ length: 21 }, () => point(0, 0, 0));
  const coordinates = {
    2: [-0.12, -0.02], 3: [-0.18, -0.1], 4: [-0.24, -0.18],
    5: [-0.08, -0.08], 6: [-0.08, -0.18],
    9: [-0.025, -0.08], 10: [-0.025, -0.2],
    13: [0.03, -0.08], 14: [0.03, -0.18],
    17: [0.08, -0.08], 18: [0.08, -0.16],
  };
  if (!extendedFingers.size) {
    Object.assign(coordinates, { 2: [-0.2, -0.1], 3: [-0.12, -0.12], 4: [-0.1, -0.06] });
  }
  const fingers = {
    index: [5, 6, 8, -0.08, -0.4],
    middle: [9, 10, 12, -0.025, -0.44],
    ring: [13, 14, 16, 0.03, -0.4],
    pinky: [17, 18, 20, 0.08, -0.34],
  };
  for (const [index, [x, y]] of Object.entries(coordinates)) {
    landmarks[index] = point(x, y);
  }
  for (const [name, [mcp, pip, tip, x, extendedY]] of Object.entries(fingers)) {
    landmarks[mcp] = point(x, -0.08);
    landmarks[pip] = point(x, name === "middle" ? -0.2 : -0.18);
    landmarks[tip] = extendedFingers.has(name) ? point(x, extendedY) : point(x + 0.09, -0.12);
  }
  return landmarks;
}

function openHand(wristX, wristY) {
  const landmarks = Array.from({ length: 21 }, () => point(wristX, wristY));
  const fingers = [[5, 6, 8, -0.06], [9, 10, 12, -0.02], [13, 14, 16, 0.02], [17, 18, 20, 0.06]];
  for (const [mcp, pip, tip, offset] of fingers) {
    landmarks[mcp] = point(wristX + offset, wristY - 0.04);
    landmarks[pip] = point(wristX + offset, wristY - 0.12);
    landmarks[tip] = point(wristX + offset, wristY - 0.28);
  }
  return landmarks;
}

function loveYouHand() {
  const landmarks = Array.from({ length: 21 }, () => point(0.5, 0.5));
  const coordinates = {
    0: [0.5, 0.5], 2: [0.4, 0.48], 3: [0.33, 0.42], 4: [0.27, 0.35],
    5: [0.45, 0.4], 6: [0.45, 0.3], 8: [0.45, 0.1],
    9: [0.55, 0.4], 10: [0.55, 0.3], 12: [0.6, 0.33],
    13: [0.65, 0.4], 14: [0.65, 0.3], 16: [0.7, 0.33],
    17: [0.75, 0.4], 18: [0.75, 0.3], 20: [0.75, 0.1],
  };
  for (const [index, [x, y]] of Object.entries(coordinates)) landmarks[index] = point(x, y);
  return landmarks;
}

test("3D pose rules recognize common poses and middle finger", () => {
  const cases = [
    [new Set(["index", "middle"]), "Victory"],
    [new Set(["index"]), "Pointing up"],
    [new Set(["middle"]), "Middle finger"],
    [new Set(["index", "middle", "ring", "pinky"]), "Open palm"],
    [new Set(), "Fist"],
  ];
  for (const [fingers, expected] of cases) {
    assert.equal(classifyHandPose(makePose(fingers))?.[0], expected);
  }
});

test("love-you posture takes priority over model's generic ILoveYou category", () => {
  const hand = loveYouHand();
  assert.equal(isLoveYouPosture(hand).matches, true);
  assert.equal(gestureLabel({
    worldLandmarks: [hand],
    gestures: [[{ categoryName: "ILoveYou", score: 0.99 }]],
  }, 0)[0], "I Love You");
  hand[16] = point(0.65, 0.1);
  assert.equal(isLoveYouPosture(hand).matches, false);
});

test("grabbing requires an open hand before a fist", () => {
  const state = createRecognitionState();
  const open = makePose(new Set(["index", "middle", "ring", "pinky"]));
  const fist = makePose(new Set());
  assert.equal(detectGrabbing([open], [open], state)[0], null);
  assert.ok(detectGrabbing([fist], [fist], state)[0] > 0);
  assert.equal(detectGrabbing([open], [open], state)[0], null);
  assert.equal(detectGrabbing([fist], [fist], createRecognitionState())[0], null);
});

test("zoom pinch requires a curled-finger physical right hand with no second hand", () => {
  const curledHand = makePose(new Set());
  const result = {
    landmarks: [curledHand],
    worldLandmarks: [curledHand],
    handedness: [[{ categoryName: "Left" }]],
  };
  const pinchDistance = detectZoomPinch(result);
  assert.ok(pinchDistance > 0);
  assert.equal(physicalHandedness("Left"), "Right");
  assert.equal(physicalHandedness("Right"), "Left");
  assert.equal(detectZoomPinch({ ...result, handedness: [[{ categoryName: "Right" }]] }), null);
  assert.equal(detectZoomPinch({ ...result, landmarks: [curledHand, curledHand] }), null);

  const openMiddleFinger = makePose(new Set(["middle"]));
  assert.equal(detectZoomPinch({
    ...result,
    landmarks: [openMiddleFinger],
    worldLandmarks: [openMiddleFinger],
  }), null);
  assert.equal(pinchZoomTarget(1.5, 0.3, 0.34), 1.5);
  assert.ok(pinchZoomTarget(1.5, 0.3, 0.5) > 1.5);
  assert.equal(pinchZoomTarget(2.4, 0.3, 0.8), 2.5);
  const smoothed = smoothZoom(1, 2, 60);
  assert.ok(smoothed > 1 && smoothed < 2);
});

test("six-seven requires alternating vertical positions of two open hands", () => {
  const staticState = createRecognitionState();
  for (let frame = 0; frame < 12; frame += 1) {
    assert.equal(
      detectSixSeven([openHand(0.3, 0.5), openHand(0.7, 0.4)], staticState, frame * 0.05),
      null,
    );
  }
  const movingState = createRecognitionState();
  const differences = [-0.1, -0.11, -0.09, 0.11, 0.1, 0.12, -0.11, -0.12, -0.1, 0.11, 0.12];
  const scores = differences.map((difference, index) => detectSixSeven([
    openHand(0.3, 0.45 + difference / 2),
    openHand(0.7, 0.45 - difference / 2),
  ], movingState, index * 0.05));
  assert.ok(scores.some(score => score !== null));
});

test("expression cues and gesture history are smoothed", () => {
  const categories = [
    { categoryName: "mouthSmileLeft", score: 0.9 },
    { categoryName: "mouthSmileRight", score: 0.8 },
  ];
  assert.deepEqual(facialExpression(categories)[0], "Happy");
  assert.deepEqual(facialExpression({ categories })[0], "Happy");
  assert.equal(facialExpression([])[0], "Neutral");
  const history = [];
  assert.equal(stabilizeGesture("Victory", 0.9, history)[0], "Victory");
  assert.equal(stabilizeGesture("Unknown gesture", 0, history)[0], "Unknown gesture");
  assert.equal(stabilizeGesture("Victory", 0.8, history)[0], "Victory");
});

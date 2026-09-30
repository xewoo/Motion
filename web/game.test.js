import assert from "node:assert/strict";
import test from "node:test";

import { classifyHand, getMirroredHandSide } from "./game.js";

const point = (x, y, z = 0) => ({ x, y, z });

function makeGestureHand({ offsetX = 0, offsetY = 0, pose = "fist" } = {}) {
  const landmarks = Array.from({ length: 21 }, () => point(0.5 + offsetX, 0.5 + offsetY, 0));

  const coordinates = {
    2: [-0.12, -0.02],
    3: [-0.18, -0.1],
    4: [-0.24, -0.18],
    5: [-0.08, -0.08],
    6: [-0.08, -0.18],
    9: [-0.025, -0.08],
    10: [-0.025, -0.2],
    13: [0.03, -0.08],
    14: [0.03, -0.18],
    17: [0.08, -0.08],
    18: [0.08, -0.16],
  };

  if (pose !== "fist") {
    Object.assign(coordinates, { 2: [-0.2, -0.1], 3: [-0.12, -0.12], 4: [-0.1, -0.06] });
  } else {
    Object.assign(coordinates, { 2: [-0.12, -0.02], 3: [-0.07, -0.07], 4: [-0.04, -0.06] });
  }

  const fingers = {
    index: [5, 6, 8, -0.08, -0.4],
    middle: [9, 10, 12, -0.025, -0.44],
    ring: [13, 14, 16, 0.03, -0.4],
    pinky: [17, 18, 20, 0.08, -0.34],
  };

  for (const [index, [x, y]] of Object.entries(coordinates)) {
    landmarks[Number(index)] = point(x + offsetX + 0.5, y + offsetY + 0.5, 0);
  }

  for (const [name, [mcp, pip, tip, x, extendedY]] of Object.entries(fingers)) {
    landmarks[mcp] = point(x + offsetX + 0.5, -0.08 + offsetY + 0.5, 0);
    landmarks[pip] = point(x + offsetX + 0.5, name === "middle" ? -0.2 : -0.18 + offsetY + 0.5, 0);
    landmarks[tip] = pose === "fist"
      ? point(x + offsetX + 0.5 + 0.09, -0.12 + offsetY + 0.5, 0)
      : point(x + offsetX + 0.5, extendedY + offsetY + 0.5, 0);
  }

  return landmarks;
}

function makePoseFromAngles(fingerAngles) {
  const landmarks = Array.from({ length: 21 }, () => point(0, 0, 0));
  const fingers = [
    [5, 6, 8, -0.3, fingerAngles[0]],
    [9, 10, 12, -0.1, fingerAngles[1]],
    [13, 14, 16, 0.1, fingerAngles[2]],
    [17, 18, 20, 0.3, fingerAngles[3]],
  ];

  for (const [mcpIndex, pipIndex, tipIndex, horizontalOffset, angleDegrees] of fingers) {
    const radians = angleDegrees * Math.PI / 180;
    landmarks[mcpIndex] = point(horizontalOffset, 0, 0);
    landmarks[pipIndex] = point(horizontalOffset, 1, 0);
    landmarks[tipIndex] = point(
      horizontalOffset + Math.sin(radians),
      1 - Math.cos(radians),
      0,
    );
  }

  return landmarks;
}

function rotateLandmarks(landmarks, angleX, angleY, angleZ) {
  const cosineX = Math.cos(angleX);
  const sineX = Math.sin(angleX);
  const cosineY = Math.cos(angleY);
  const sineY = Math.sin(angleY);
  const cosineZ = Math.cos(angleZ);
  const sineZ = Math.sin(angleZ);

  return landmarks.map((landmark) => {
    const rotatedX = {
      x: landmark.x,
      y: landmark.y * cosineX - landmark.z * sineX,
      z: landmark.y * sineX + landmark.z * cosineX,
    };
    const rotatedY = {
      x: rotatedX.x * cosineY + rotatedX.z * sineY,
      y: rotatedX.y,
      z: -rotatedX.x * sineY + rotatedX.z * cosineY,
    };
    return {
      x: rotatedY.x * cosineZ - rotatedY.y * sineZ,
      y: rotatedY.x * sineZ + rotatedY.y * cosineZ,
      z: rotatedY.z,
    };
  });
}

test("handedness follows the mirrored camera preview", () => {
  assert.equal(getMirroredHandSide("Left"), "right");
  assert.equal(getMirroredHandSide("Right"), "left");
});

test("fist recognition stays valid across the frame and matches gesture prompts", () => {
  const center = makeGestureHand({ offsetX: 0, offsetY: 0, pose: "fist" });
  const corner = makeGestureHand({ offsetX: 0.75, offsetY: 0.6, pose: "fist" });

  assert.equal(classifyHand(center), "Fist");
  assert.equal(classifyHand(corner), "Fist");
});

test("thumbs up is not swallowed by the curled-finger fist rule", () => {
  const hand = makeGestureHand({ pose: "fist" });
  hand[2] = point(0.44, 0.48);
  hand[3] = point(0.40, 0.43);
  hand[4] = point(0.36, 0.38);

  assert.equal(classifyHand(hand), "Thumbs Up");
});

test("partly bent open palm is not mistaken for victory after camera rotation", () => {
  const openPalm = makePoseFromAngles([175, 172, 148, 146]);
  const victory = makePoseFromAngles([175, 172, 115, 112]);
  const cameraAngles = [Math.PI / 3, Math.PI / 4, Math.PI / 2];

  assert.equal(classifyHand(openPalm), "Open Palm");
  assert.equal(classifyHand(victory), "Victory");
  assert.equal(classifyHand(rotateLandmarks(openPalm, ...cameraAngles)), "Open Palm");
  assert.equal(classifyHand(rotateLandmarks(victory, ...cameraAngles)), "Victory");
});

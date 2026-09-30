import assert from "node:assert/strict";
import test from "node:test";

import { classifyHand } from "./game.js";

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

test("fist recognition stays valid across the frame and matches gesture prompts", () => {
  const center = makeGestureHand({ offsetX: 0, offsetY: 0, pose: "fist" });
  const corner = makeGestureHand({ offsetX: 0.75, offsetY: 0.6, pose: "fist" });

  assert.equal(classifyHand(center), "Fist");
  assert.equal(classifyHand(corner), "Fist");
});

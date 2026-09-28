import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import app


def point(x: float, y: float, z: float = 0.0):
    return SimpleNamespace(x=x, y=y, z=z)


def love_you_hand():
    landmarks = [point(0.5, 0.5) for _ in range(21)]
    coordinates = {
        0: (0.50, 0.50),
        2: (0.40, 0.48), 3: (0.33, 0.42), 4: (0.27, 0.35),
        5: (0.45, 0.40), 6: (0.45, 0.30), 8: (0.45, 0.10),
        9: (0.55, 0.40), 10: (0.55, 0.30), 12: (0.60, 0.33),
        13: (0.65, 0.40), 14: (0.65, 0.30), 16: (0.70, 0.33),
        17: (0.75, 0.40), 18: (0.75, 0.30), 20: (0.75, 0.10),
    }
    for index, (x, y) in coordinates.items():
        landmarks[index] = point(x, y)
    return landmarks


def open_hand(wrist_x: float, wrist_y: float):
    landmarks = [point(wrist_x, wrist_y) for _ in range(21)]
    fingers = ((5, 6, 8, -0.06), (9, 10, 12, -0.02), (13, 14, 16, 0.02), (17, 18, 20, 0.06))
    for mcp, pip, tip, offset in fingers:
        landmarks[mcp] = point(wrist_x + offset, wrist_y - 0.04)
        landmarks[pip] = point(wrist_x + offset, wrist_y - 0.12)
        landmarks[tip] = point(wrist_x + offset, wrist_y - 0.28)
    return landmarks


def make_pose(extended_fingers):
    landmarks = [point(0.0, 0.0, 0.0) for _ in range(21)]
    coordinates = {
        2: (-0.12, -0.02), 3: (-0.18, -0.10), 4: (-0.24, -0.18),
        5: (-0.08, -0.08), 6: (-0.08, -0.18),
        9: (-0.025, -0.08), 10: (-0.025, -0.20),
        13: (0.03, -0.08), 14: (0.03, -0.18),
        17: (0.08, -0.08), 18: (0.08, -0.16),
    }
    if not extended_fingers:
        coordinates.update({2: (-0.20, -0.10), 3: (-0.12, -0.12), 4: (-0.10, -0.06)})
    fingers = {
        "index": (5, 6, 8, -0.08, -0.40),
        "middle": (9, 10, 12, -0.025, -0.44),
        "ring": (13, 14, 16, 0.03, -0.40),
        "pinky": (17, 18, 20, 0.08, -0.34),
    }
    for index, (x, y) in coordinates.items():
        landmarks[index] = point(x, y)
    for name, (mcp, pip, tip, x, extended_y) in fingers.items():
        landmarks[mcp] = point(x, -0.08)
        landmarks[pip] = point(x, -0.18 if name != "middle" else -0.20)
        if name in extended_fingers:
            landmarks[tip] = point(x, extended_y)
        else:
            landmarks[tip] = point(x + 0.09, -0.12)
    return landmarks


def rotate_hand(landmarks, angle_x: float, angle_y: float, angle_z: float):
    cosine_x, sine_x = math.cos(angle_x), math.sin(angle_x)
    cosine_y, sine_y = math.cos(angle_y), math.sin(angle_y)
    cosine_z, sine_z = math.cos(angle_z), math.sin(angle_z)
    rotated = []
    for landmark in landmarks:
        x, y, z = landmark.x, landmark.y, landmark.z
        y, z = y * cosine_x - z * sine_x, y * sine_x + z * cosine_x
        x, z = x * cosine_y + z * sine_y, -x * sine_y + z * cosine_y
        x, y = x * cosine_z - y * sine_z, x * sine_z + y * cosine_z
        rotated.append(point(x, y, z))
    return rotated


class RecognitionTests(unittest.TestCase):
    def test_love_you_requires_three_extended_and_two_curled_fingers(self):
        matches, confidence = app.is_love_you_posture(love_you_hand())
        self.assertTrue(matches)
        self.assertGreaterEqual(confidence, 0.65)
        model_result = SimpleNamespace(
            hand_world_landmarks=[love_you_hand()],
            gestures=[[SimpleNamespace(category_name="ILoveYou", score=0.99)]],
        )
        self.assertEqual(app.gesture_label(model_result, 0)[0], "I Love You")

        wrong_pose = love_you_hand()
        wrong_pose[16] = point(0.65, 0.10)
        self.assertFalse(app.is_love_you_posture(wrong_pose)[0])
        false_positive = SimpleNamespace(
            hand_world_landmarks=[wrong_pose],
            gestures=[[
                SimpleNamespace(category_name="ILoveYou", score=0.99),
                SimpleNamespace(category_name="Closed_Fist", score=0.8),
            ]],
        )
        self.assertEqual(app.gesture_label(false_positive, 0)[0], "Fist")

    def test_face_blendshapes_map_to_expression_cues(self):
        expression_cases = (
            ("Happy", {"mouthSmileLeft": 0.9, "mouthSmileRight": 0.8}),
            ("Surprised", {"browInnerUp": 0.8, "eyeWideLeft": 0.9, "eyeWideRight": 0.9, "jawOpen": 0.9}),
            ("Sad", {"mouthFrownLeft": 0.8, "mouthFrownRight": 0.8, "browInnerUp": 0.6}),
            ("Angry", {"browDownLeft": 0.8, "browDownRight": 0.8, "mouthPressLeft": 0.7, "mouthPressRight": 0.7}),
        )
        for expected, values in expression_cases:
            with self.subTest(expression=expected):
                blendshapes = [
                    SimpleNamespace(category_name=name, score=score)
                    for name, score in values.items()
                ]
                self.assertEqual(app.facial_expression(blendshapes)[0], expected)
        self.assertEqual(app.facial_expression([])[0], "Neutral")

    def test_face_mesh_uses_lines_without_round_markers(self):
        landmarks = [point(0.5 + (index % 20) * 0.005, 0.2 + (index % 30) * 0.01) for index in range(478)]
        result = SimpleNamespace(face_landmarks=[landmarks], face_blendshapes=[[]])
        frame = __import__("numpy").zeros((480, 640, 3), dtype="uint8")
        state = app.make_recognition_state()
        self.assertTrue(state["full_face_mesh"])
        with patch.object(app.cv2, "circle", side_effect=AssertionError("face marker drawn")):
            with patch.object(app.cv2, "line", wraps=app.cv2.line) as draw_line:
                app.draw_faces(frame, result, state)
                self.assertEqual(draw_line.call_count, 2556)
                state["full_face_mesh"] = False
                draw_line.reset_mock()
                app.draw_faces(frame, result, state)
                self.assertLess(draw_line.call_count, 200)

    def test_ctrl_1_toggles_full_face_mesh_without_conflicting_with_sample_key(self):
        self.assertTrue(app.should_toggle_full_face_mesh(ord("1"), True))
        self.assertFalse(app.should_toggle_full_face_mesh(ord("1"), False))
        self.assertFalse(app.should_toggle_full_face_mesh(ord("2"), True))

    def test_six_seven_requires_alternating_open_hands(self):
        static_state = app.make_recognition_state()
        static_result = SimpleNamespace(
            hand_landmarks=[open_hand(0.3, 0.50), open_hand(0.7, 0.40)]
        )
        for frame_index in range(12):
            score = app.detect_six_seven(static_result, static_state, frame_index * 0.05)
        self.assertIsNone(score)

        moving_state = app.make_recognition_state()
        differences = (-0.10, -0.11, -0.09, 0.11, 0.10, 0.12, -0.11, -0.12, -0.10, 0.11, 0.12)
        scores = []
        for frame_index, difference in enumerate(differences):
            result = SimpleNamespace(
                hand_landmarks=[
                    open_hand(0.3, 0.45 + difference / 2),
                    open_hand(0.7, 0.45 - difference / 2),
                ]
            )
            scores.append(app.detect_six_seven(result, moving_state, frame_index * 0.05))
        self.assertTrue(any(score is not None for score in scores))

    def test_3d_pose_classifier_is_rotation_invariant(self):
        pose_cases = (
            ({"index", "middle"}, "Victory"),
            ({"index"}, "Pointing up"),
            ({"index", "middle", "ring", "pinky"}, "Open palm"),
            (set(), "Fist"),
        )
        rotations = ((0.0, 0.0, 0.0), (1.1, 0.0, 0.0), (0.0, 1.2, 0.0), (0.7, -0.9, 1.4))
        for extended_fingers, expected in pose_cases:
            original = make_pose(extended_fingers)
            for rotation in rotations:
                with self.subTest(gesture=expected, rotation=rotation):
                    rotated = rotate_hand(original, *rotation)
                    self.assertEqual(app.classify_hand_pose(rotated)[0], expected)
                    result = SimpleNamespace(
                        hand_world_landmarks=[rotated],
                        gestures=[[SimpleNamespace(category_name="None", score=0.0)]],
                    )
                    self.assertEqual(app.gesture_label(result, 0)[0], expected)


if __name__ == "__main__":
    unittest.main()
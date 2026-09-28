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
        with patch.object(app.cv2, "circle", side_effect=AssertionError("face marker drawn")):
            app.draw_faces(frame, result, app.make_recognition_state())

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


if __name__ == "__main__":
    unittest.main()
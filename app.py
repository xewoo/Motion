import argparse
import ctypes
import csv
import math
import sys
import time
import urllib.request
from collections import Counter, deque
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw, ImageFont


MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
    "gesture_recognizer/float16/1/gesture_recognizer.task"
)
OBJECT_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/object_detector/"
    "efficientdet_lite0/float32/1/efficientdet_lite0.tflite"
)
FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
GESTURE_NAMES = {
    "Closed_Fist": "Fist",
    "Open_Palm": "Open palm",
    "Pointing_Up": "Pointing up",
    "Thumb_Down": "Thumbs down",
    "Thumb_Up": "Thumbs up",
    "Victory": "Victory",
    "ILoveYou": "I love you",
}
GESTURES = {
    ord("1"): "open_palm",
    ord("2"): "fist",
    ord("3"): "peace",
    ord("4"): "pointing",
    ord("5"): "thumbs_up",
}
OBJECT_DETECTION_INTERVAL = 3
FACE_DETECTION_INTERVAL = 2
GESTURE_SCORE_THRESHOLD = 0.55
CAMERA_WINDOW = "Gesture Detector"
HAND_CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20), (0, 17),
)


def ensure_model(model_path: Path, model_url: str, model_name: str) -> None:
    if model_path.exists():
        return

    model_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = model_path.with_suffix(model_path.suffix + ".part")
    print(f"Downloading {model_name} model to {model_path}...")
    try:
        urllib.request.urlretrieve(model_url, temporary_path)
        temporary_path.replace(model_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def csv_columns() -> list[str]:
    columns = ["timestamp_utc", "gesture", "hand_index", "handedness", "handedness_score"]
    for landmark_index in range(21):
        columns.extend((f"x{landmark_index}", f"y{landmark_index}", f"z{landmark_index}"))
    return columns


def save_samples(output_path: Path, gesture: str, result) -> int:
    if not result.hand_landmarks:
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    needs_header = not output_path.exists() or output_path.stat().st_size == 0
    saved = 0
    with output_path.open("a", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        if needs_header:
            writer.writerow(csv_columns())

        timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        for hand_index, landmarks in enumerate(result.hand_landmarks):
            handedness = "Unknown"
            score = ""
            if hand_index < len(result.handedness) and result.handedness[hand_index]:
                category = result.handedness[hand_index][0]
                handedness = category.category_name
                score = category.score

            row = [timestamp, gesture, hand_index, handedness, score]
            for landmark in landmarks:
                row.extend((landmark.x, landmark.y, landmark.z))
            writer.writerow(row)
            saved += 1
    return saved


@lru_cache(maxsize=16)
def load_ui_font(size: int):
    for font_path in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(font_path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_text(frame, text: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    font_size = max(16, min(24, frame.shape[1] // 56))
    font = load_ui_font(font_size)
    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    ImageDraw.Draw(image).text((x, y), text, font=font, fill=tuple(reversed(color)))
    frame[:] = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def draw_label(frame, text: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    font_size = max(16, min(22, frame.shape[1] // 58))
    font = load_ui_font(font_size)
    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    painter = ImageDraw.Draw(image)
    bounds = painter.textbbox((0, 0), text, font=font)
    text_width = bounds[2] - bounds[0]
    text_height = bounds[3] - bounds[1]
    x = max(0, min(x, frame.shape[1] - text_width - 12))
    y = max(text_height + 8, y)
    top = y - text_height - 8
    painter.rounded_rectangle(
        (x, top, x + text_width + 12, y + 2),
        radius=4,
        fill=tuple(reversed(color)),
    )
    painter.text(
        (x + 6, top + 3 - bounds[1]),
        text,
        font=font,
        fill=(255, 255, 255),
    )
    frame[:] = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def point_distance(first, second) -> float:
    delta = (first.x - second.x, first.y - second.y, first.z - second.z)
    return math.sqrt(sum(component * component for component in delta))


def joint_angle(first, middle, last) -> float:
    first_vector = (first.x - middle.x, first.y - middle.y, first.z - middle.z)
    last_vector = (last.x - middle.x, last.y - middle.y, last.z - middle.z)
    first_length = math.sqrt(sum(component * component for component in first_vector))
    last_length = math.sqrt(sum(component * component for component in last_vector))
    if first_length == 0 or last_length == 0:
        return 0.0
    cosine = sum(a * b for a, b in zip(first_vector, last_vector)) / (first_length * last_length)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def is_love_you_posture(landmarks) -> tuple[bool, float]:
    index_angle = joint_angle(landmarks[5], landmarks[6], landmarks[8])
    middle_angle = joint_angle(landmarks[9], landmarks[10], landmarks[12])
    ring_angle = joint_angle(landmarks[13], landmarks[14], landmarks[16])
    pinky_angle = joint_angle(landmarks[17], landmarks[18], landmarks[20])
    thumb_angle = joint_angle(landmarks[2], landmarks[3], landmarks[4])
    thumb_extension = point_distance(landmarks[4], landmarks[5]) / max(
        point_distance(landmarks[2], landmarks[5]), 1e-6
    )

    matches = (
        index_angle >= 150
        and middle_angle <= 140
        and ring_angle <= 140
        and pinky_angle >= 150
        and thumb_angle >= 135
        and thumb_extension >= 1.12
    )
    margins = (
        (index_angle - 140) / 40,
        (140 - middle_angle) / 40,
        (140 - ring_angle) / 40,
        (pinky_angle - 140) / 40,
        (thumb_angle - 125) / 55,
        (thumb_extension - 1.0) / 0.5,
    )
    confidence = 0.65 + 0.35 * max(0.0, min(1.0, min(margins)))
    return matches, confidence


def is_open_palm(landmarks) -> bool:
    finger_joints = ((5, 6, 8), (9, 10, 12), (13, 14, 16), (17, 18, 20))
    return all(joint_angle(landmarks[mcp], landmarks[pip], landmarks[tip]) >= 145
               for mcp, pip, tip in finger_joints)


def classify_hand_pose(landmarks) -> tuple[str, float] | None:
    finger_angles = {
        "index": joint_angle(landmarks[5], landmarks[6], landmarks[8]),
        "middle": joint_angle(landmarks[9], landmarks[10], landmarks[12]),
        "ring": joint_angle(landmarks[13], landmarks[14], landmarks[16]),
        "pinky": joint_angle(landmarks[17], landmarks[18], landmarks[20]),
    }
    extended = {finger: angle >= 150 for finger, angle in finger_angles.items()}
    curled = {finger: angle <= 135 for finger, angle in finger_angles.items()}
    thumb_angle = joint_angle(landmarks[2], landmarks[3], landmarks[4])
    thumb_extension = point_distance(landmarks[4], landmarks[5]) / max(
        point_distance(landmarks[2], landmarks[5]), 1e-6
    )
    thumb_extended = thumb_angle >= 135 and thumb_extension >= 1.12

    pose = None
    if extended["index"] and extended["middle"] and curled["ring"] and curled["pinky"]:
        pose = "Victory", (finger_angles["index"] + finger_angles["middle"] + 270 - finger_angles["ring"] - finger_angles["pinky"]) / 540
    elif extended["index"] and curled["middle"] and curled["ring"] and curled["pinky"]:
        pose = "Pointing up", (finger_angles["index"] + 405 - finger_angles["middle"] - finger_angles["ring"] - finger_angles["pinky"]) / 540
    elif all(extended.values()) and thumb_extended:
        pose = "Open palm", min(1.0, sum(finger_angles.values()) / 720)
    elif thumb_extended and all(curled.values()) and abs(landmarks[4].y - landmarks[0].y) > 0.04:
        vertical = landmarks[4].y - landmarks[0].y
        if vertical < -0.04:
            pose = "Thumbs up", min(0.95, 0.7 + abs(vertical))
        elif vertical > 0.04:
            pose = "Thumbs down", min(0.95, 0.7 + abs(vertical))
    elif all(curled.values()):
        pose = "Fist", min(1.0, (540 - sum(finger_angles.values())) / 540 + 0.65)

    if pose is None:
        return None
    return pose[0], max(0.55, min(0.99, pose[1]))


def detect_six_seven(result, ui_state: dict, timestamp: float) -> float | None:
    hands = result.hand_landmarks
    history = ui_state["six_seven_history"]
    if len(hands) != 2 or not all(is_open_palm(hand) for hand in hands):
        history.clear()
        return None

    left_hand, right_hand = sorted(hands, key=lambda hand: hand[0].x)
    vertical_difference = left_hand[0].y - right_hand[0].y
    history.append((timestamp, vertical_difference))
    while history and timestamp - history[0][0] > 1.2:
        history.popleft()
    if len(history) < 8 or history[-1][0] - history[0][0] < 0.3:
        return None

    values = [difference for _, difference in history]
    signs = [1 if value > 0.055 else -1 if value < -0.055 else 0 for value in values]
    strong_signs = [sign for sign in signs if sign]
    reversals = sum(first != second for first, second in zip(strong_signs, strong_signs[1:]))
    amplitude = max(values) - min(values)
    if reversals < 2 or amplitude < 0.12:
        return None
    return min(0.99, 0.62 + 0.06 * reversals + min(0.18, amplitude))


def gesture_label(result, hand_index: int) -> tuple[str, float]:
    if hand_index < len(result.hand_world_landmarks):
        landmarks = result.hand_world_landmarks[hand_index]
        is_love_you, confidence = is_love_you_posture(landmarks)
        if is_love_you:
            return "I Love You", confidence
        pose = classify_hand_pose(landmarks)
        if pose is not None:
            return pose

    if hand_index >= len(result.gestures) or not result.gestures[hand_index]:
        return "Unknown gesture", 0.0

    for category in result.gestures[hand_index]:
        if category.category_name in ("None", "ILoveYou"):
            continue
        if category.score < GESTURE_SCORE_THRESHOLD:
            continue
        label = GESTURE_NAMES.get(category.category_name, category.category_name)
        return label, category.score
    return "No known gesture", 0.0


def draw_hands(frame, result, ui_state: dict, six_seven_score: float | None = None) -> None:
    height, width = frame.shape[:2]
    for hand_index, landmarks in enumerate(result.hand_landmarks):
        points = [
            (int(landmark.x * width), int(landmark.y * height))
            for landmark in landmarks
        ]
        for start, end in HAND_CONNECTIONS:
            cv2.line(frame, points[start], points[end], (80, 220, 120), 2)
        for point in points:
            cv2.circle(frame, point, 4, (40, 80, 255), -1)

        handedness = "Hand"
        if hand_index < len(result.handedness) and result.handedness[hand_index]:
            handedness = result.handedness[hand_index][0].category_name
        gesture, score = gesture_label(result, hand_index)
        if six_seven_score is not None:
            gesture, score = "Six-seven (67)", six_seven_score
        else:
            history = ui_state["gesture_history"][hand_index]
            history.append((gesture, score))
            stable_labels = [
                label for label, confidence in history
                if confidence >= GESTURE_SCORE_THRESHOLD
                and label not in ("Unknown gesture", "No known gesture")
            ]
            if stable_labels:
                stable_label, count = Counter(stable_labels).most_common(1)[0]
                if count >= 2:
                    gesture = stable_label
                    matching_scores = [value for label, value in history if label == stable_label]
                    score = sum(matching_scores) / len(matching_scores)
        label = f"{gesture} | {handedness} {score:.0%}"
        draw_label(frame, label, min(point[0] for point in points), min(point[1] for point in points) - 8, (40, 120, 35))


def draw_objects(frame, detections) -> None:
    for detection in detections:
        box = detection.bounding_box
        left = max(0, box.origin_x)
        top = max(0, box.origin_y)
        right = min(frame.shape[1] - 1, left + box.width)
        bottom = min(frame.shape[0] - 1, top + box.height)
        cv2.rectangle(frame, (left, top), (right, bottom), (30, 190, 245), 2)

        if detection.categories:
            category = detection.categories[0]
            name = category.display_name or category.category_name or "Object"
            label = f"{name} {category.score:.0%}"
        else:
            label = "Object"
        draw_label(frame, label, left, top - 6, (170, 95, 20))


def facial_expression(blendshapes) -> tuple[str, float]:
    scores = {category.category_name: category.score for category in blendshapes}
    average = lambda first, second: (scores.get(first, 0.0) + scores.get(second, 0.0)) / 2
    expression_scores = {
        "Happy": average("mouthSmileLeft", "mouthSmileRight"),
        "Surprised": (
            0.35 * scores.get("browInnerUp", 0.0)
            + 0.30 * average("eyeWideLeft", "eyeWideRight")
            + 0.35 * scores.get("jawOpen", 0.0)
        ),
        "Sad": (
            0.55 * average("mouthFrownLeft", "mouthFrownRight")
            + 0.45 * scores.get("browInnerUp", 0.0)
        ),
        "Angry": (
            0.55 * average("browDownLeft", "browDownRight")
            + 0.45 * average("mouthPressLeft", "mouthPressRight")
        ),
    }
    label, confidence = max(expression_scores.items(), key=lambda item: item[1])
    if confidence < 0.34:
        return "Neutral", 1.0 - confidence
    return label, confidence


def draw_faces(frame, result, ui_state: dict) -> None:
    if result is None:
        return

    height, width = frame.shape[:2]
    connections = mp.tasks.vision.FaceLandmarksConnections
    for face_index, landmarks in enumerate(result.face_landmarks):
        points = [
            (int(landmark.x * width), int(landmark.y * height))
            for landmark in landmarks
        ]
        if ui_state["full_face_mesh"]:
            face_edges = connections.FACE_LANDMARKS_TESSELATION
            line_color = (245, 248, 255)
        else:
            face_edges = (
                connections.FACE_LANDMARKS_FACE_OVAL
                + connections.FACE_LANDMARKS_LEFT_EYE
                + connections.FACE_LANDMARKS_RIGHT_EYE
                + connections.FACE_LANDMARKS_LIPS
            )
            line_color = (100, 225, 205)
        for edge in face_edges:
            cv2.line(frame, points[edge.start], points[edge.end], line_color, 1, cv2.LINE_AA)

        blendshapes = result.face_blendshapes[face_index] if face_index < len(result.face_blendshapes) else []
        expression, confidence = facial_expression(blendshapes)
        histories = ui_state["face_expression_history"]
        while len(histories) <= face_index:
            histories.append(deque(maxlen=3))
        history = histories[face_index]
        history.append((expression, confidence))
        stable_expression, count = Counter(label for label, _ in history).most_common(1)[0]
        if count >= 2:
            expression = stable_expression
            matching = [score for label, score in history if label == expression]
            confidence = sum(matching) / len(matching)

        top = min(point[1] for point in points)
        left = min(point[0] for point in points)
        draw_label(frame, f"Expression: {expression} {confidence:.0%}", left, top - 8, (115, 80, 25))


def make_recognition_state() -> dict:
    return {
        "gesture_history": [deque(maxlen=5), deque(maxlen=5)],
        "six_seven_history": deque(maxlen=36),
        "face_expression_history": [deque(maxlen=3)],
        "full_face_mesh": True,
    }


def should_toggle_full_face_mesh(key_code: int, control_pressed: bool) -> bool:
    return key_code == ord("1") and control_pressed


def is_control_pressed() -> bool:
    if sys.platform != "win32":
        return False
    return bool(ctypes.windll.user32.GetAsyncKeyState(0x11) & 0x8000)
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Live hand landmarks and gesture dataset capture")
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default: 0)")
    parser.add_argument(
        "--model",
        type=Path,
        default=Path("models/gesture_recognizer.task"),
        help="Path to the MediaPipe Gesture Recognizer model",
    )
    parser.add_argument(
        "--object-model",
        type=Path,
        default=Path("models/efficientdet_lite0.tflite"),
        help="Path to the MediaPipe object detection model",
    )
    parser.add_argument(
        "--face-model",
        type=Path,
        default=Path("models/face_landmarker.task"),
        help="Path to the MediaPipe Face Landmarker model",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/landmarks.csv"),
        help="CSV file for labeled landmark samples",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        ensure_model(args.model, MODEL_URL, "Gesture Recognizer")
        ensure_model(args.object_model, OBJECT_MODEL_URL, "EfficientDet Lite0")
        ensure_model(args.face_model, FACE_MODEL_URL, "Face Landmarker")
    except Exception as error:
        print(f"Could not download the model: {error}")
        return 1

    camera = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    if not camera.isOpened():
        camera.release()
        camera = cv2.VideoCapture(args.camera)
    if not camera.isOpened():
        print(f"Could not open camera {args.camera}. Check the device index and permissions.")
        return 1

    gesture_options = mp.tasks.vision.GestureRecognizerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        canned_gesture_classifier_options=mp.tasks.components.processors.ClassifierOptions(
            max_results=8,
            score_threshold=0.15,
        ),
    )
    object_options = mp.tasks.vision.ObjectDetectorOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.object_model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        max_results=5,
        score_threshold=0.45,
    )
    face_options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.face_model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_face_blendshapes=True,
    )

    last_timestamp_ms = -1
    frame_index = 0
    object_detections = []
    face_result = None
    status = ""
    status_until = 0.0
    recognition_state = make_recognition_state()
    cv2.namedWindow(CAMERA_WINDOW, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(CAMERA_WINDOW, 960, 540)
    try:
        with mp.tasks.vision.GestureRecognizer.create_from_options(gesture_options) as recognizer, \
            mp.tasks.vision.ObjectDetector.create_from_options(object_options) as object_detector, \
            mp.tasks.vision.FaceLandmarker.create_from_options(face_options) as face_landmarker:
            while True:
                try:
                    if cv2.getWindowProperty(CAMERA_WINDOW, cv2.WND_PROP_VISIBLE) < 1:
                        break
                except cv2.error:
                    break

                success, frame = camera.read()
                if not success:
                    print("Could not read a frame from the camera.")
                    break

                frame = cv2.flip(frame, 1)
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                timestamp_ms = max(time.monotonic_ns() // 1_000_000, last_timestamp_ms + 1)
                last_timestamp_ms = timestamp_ms
                result = recognizer.recognize_for_video(image, timestamp_ms)
                if frame_index % OBJECT_DETECTION_INTERVAL == 0:
                    object_result = object_detector.detect_for_video(image, timestamp_ms)
                    object_detections = object_result.detections
                if frame_index % FACE_DETECTION_INTERVAL == 0:
                    face_result = face_landmarker.detect_for_video(image, timestamp_ms)
                six_seven_score = detect_six_seven(result, recognition_state, time.monotonic())
                frame_index += 1

                draw_hands(frame, result, recognition_state, six_seven_score)
                draw_objects(frame, object_detections)
                draw_faces(frame, face_result, recognition_state)
                draw_text(
                    frame,
                    f"Hands: {len(result.hand_landmarks)}  Faces: {len(face_result.face_landmarks) if face_result else 0}  Objects: {len(object_detections)}",
                    16,
                    12,
                    (255, 255, 255),
                )
                if status and time.monotonic() < status_until:
                    draw_label(frame, status, 16, 58, (40, 120, 35))
                draw_text(
                    frame,
                    "1 Open palm   2 Fist   3 Peace   4 Pointing   5 Thumbs up   Save sample",
                    16,
                    frame.shape[0] - 34,
                    (255, 255, 255),
                )
                cv2.imshow(CAMERA_WINDOW, frame)

                key = cv2.waitKeyEx(1)
                key_code = key & 0xFF
                try:
                    if cv2.getWindowProperty(CAMERA_WINDOW, cv2.WND_PROP_VISIBLE) < 1:
                        break
                except cv2.error:
                    break
                if key_code == ord("q"):
                    break
                if key_code == 27:
                    break
                control_pressed = key_code == ord("1") and is_control_pressed()
                if should_toggle_full_face_mesh(key_code, control_pressed):
                    recognition_state["full_face_mesh"] = not recognition_state["full_face_mesh"]
                elif key_code in GESTURES:
                    gesture = GESTURES[key_code]
                    saved = save_samples(args.output, gesture, result)
                    status = f"Saved {saved} hand(s) as {gesture}" if saved else "No hand detected; sample not saved"
                    status_until = time.monotonic() + 1.5
    finally:
        camera.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
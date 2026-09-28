import argparse
import csv
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
    "gesture_recognizer/float16/1/gesture_recognizer.task"
)
OBJECT_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/object_detector/"
    "efficientdet_lite0/float32/1/efficientdet_lite0.tflite"
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


def draw_label(frame, text: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    text_size, baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
    text_width, text_height = text_size
    x = max(0, min(x, frame.shape[1] - text_width - 10))
    y = max(text_height + 8, y)
    cv2.rectangle(
        frame,
        (x, y - text_height - 8),
        (x + text_width + 10, y + baseline + 4),
        color,
        cv2.FILLED,
    )
    cv2.putText(
        frame,
        text,
        (x + 5, y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )


def gesture_label(result, hand_index: int) -> tuple[str, float]:
    if hand_index >= len(result.gestures) or not result.gestures[hand_index]:
        return "Unknown gesture", 0.0

    category = result.gestures[hand_index][0]
    if category.category_name == "None":
        return "No known gesture", category.score
    label = GESTURE_NAMES.get(category.category_name, category.category_name)
    return label, category.score


def draw_hands(frame, result) -> None:
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


SLIDER_CONFIG = {
    "zoom": ("Digital zoom", 100, 300, 100, "%"),
    "window": ("Window size", 60, 160, 100, "%"),
    "brightness": ("Brightness", 0, 200, 100, "%"),
    "contrast": ("Contrast", 0, 200, 100, "%"),
    "saturation": ("Saturation", 0, 200, 100, "%"),
    "hue": ("Hue", -180, 180, 0, " deg"),
}


def make_ui_state() -> dict:
    return {
        "settings_open": False,
        "section": "camera",
        "active_slider": None,
        "layout": {},
        "values": {name: config[3] for name, config in SLIDER_CONFIG.items()},
    }


def point_in_rect(x: int, y: int, rect: tuple[int, int, int, int]) -> bool:
    left, top, right, bottom = rect
    return left <= x <= right and top <= y <= bottom


def set_slider_from_x(ui_state: dict, name: str, x: int) -> None:
    layout = ui_state["layout"].get("sliders", {}).get(name)
    if not layout:
        return
    minimum, maximum = SLIDER_CONFIG[name][1:3]
    left, right = layout["track"][:2]
    fraction = max(0.0, min(1.0, (x - left) / max(1, right - left)))
    ui_state["values"][name] = round(minimum + fraction * (maximum - minimum))


def handle_mouse(event: int, x: int, y: int, _flags: int, ui_state: dict) -> None:
    layout = ui_state["layout"]
    if event == cv2.EVENT_LBUTTONDOWN:
        if point_in_rect(x, y, layout.get("gear", (0, 0, 0, 0))):
            ui_state["settings_open"] = not ui_state["settings_open"]
            ui_state["active_slider"] = None
            return
        if not ui_state["settings_open"]:
            return
        if point_in_rect(x, y, layout.get("close", (0, 0, 0, 0))):
            ui_state["settings_open"] = False
            return
        if point_in_rect(x, y, layout.get("nav_camera", (0, 0, 0, 0))):
            ui_state["section"] = "camera"
            return
        if point_in_rect(x, y, layout.get("nav_image", (0, 0, 0, 0))):
            ui_state["section"] = "image"
            return
        if point_in_rect(x, y, layout.get("reset", (0, 0, 0, 0))):
            ui_state["values"] = {name: config[3] for name, config in SLIDER_CONFIG.items()}
            return
        for name, slider in layout.get("sliders", {}).items():
            if point_in_rect(x, y, slider["bounds"]):
                ui_state["active_slider"] = name
                set_slider_from_x(ui_state, name, x)
                return
    elif event == cv2.EVENT_MOUSEMOVE and ui_state["active_slider"]:
        set_slider_from_x(ui_state, ui_state["active_slider"], x)
    elif event == cv2.EVENT_LBUTTONUP:
        ui_state["active_slider"] = None


def draw_settings_icon(frame, ui_state: dict) -> None:
    height, width = frame.shape[:2]
    size = max(40, min(52, width // 14))
    x = width - size - max(14, width // 40)
    y = max(14, height // 35)
    ui_state["layout"]["gear"] = (x, y, x + size, y + size)

    layer = frame.copy()
    cv2.circle(layer, (x + size // 2, y + size // 2), size // 2, (38, 42, 48), cv2.FILLED, cv2.LINE_AA)
    cv2.addWeighted(layer, 0.62, frame, 0.38, 0, frame)
    center = (x + size // 2, y + size // 2)
    radius = size // 4
    for tooth_index in range(8):
        angle = tooth_index * np.pi / 4
        inner = (int(center[0] + np.cos(angle) * (radius + 1)), int(center[1] + np.sin(angle) * (radius + 1)))
        outer = (int(center[0] + np.cos(angle) * (radius + size // 9)), int(center[1] + np.sin(angle) * (radius + size // 9)))
        cv2.line(frame, inner, outer, (245, 247, 250), max(2, size // 10), cv2.LINE_AA)
    cv2.circle(frame, center, radius, (245, 247, 250), max(2, size // 11), cv2.LINE_AA)
    cv2.circle(frame, center, max(2, size // 13), (38, 42, 48), cv2.FILLED, cv2.LINE_AA)


def draw_slider(frame, ui_state: dict, name: str, x: int, y: int, width: int, row_height: int) -> None:
    label, minimum, maximum, _default, suffix = SLIDER_CONFIG[name]
    value = ui_state["values"][name]
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.54, (40, 44, 50), 1, cv2.LINE_AA)
    value_text = f"{value}{suffix}"
    (text_width, _), _ = cv2.getTextSize(value_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
    cv2.putText(frame, value_text, (x + width - text_width, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (76, 82, 91), 1, cv2.LINE_AA)

    track_y = y + 24
    track_left = x + 4
    track_right = x + width - 4
    fraction = (value - minimum) / max(1, maximum - minimum)
    thumb_x = int(track_left + fraction * (track_right - track_left))
    cv2.line(frame, (track_left, track_y), (track_right, track_y), (193, 199, 207), 4, cv2.LINE_AA)
    cv2.line(frame, (track_left, track_y), (thumb_x, track_y), (0, 120, 212), 4, cv2.LINE_AA)
    cv2.circle(frame, (thumb_x, track_y), 8, (0, 120, 212), cv2.FILLED, cv2.LINE_AA)
    ui_state["layout"].setdefault("sliders", {})[name] = {
        "track": (track_left, track_right, track_y),
        "bounds": (x, y - 10, x + width, y + row_height + 2),
    }


def draw_settings_overlay(frame, ui_state: dict) -> None:
    draw_settings_icon(frame, ui_state)
    if not ui_state["settings_open"]:
        return

    height, width = frame.shape[:2]
    margin = max(12, min(28, width // 30))
    panel_left, panel_top = margin, margin
    panel_right, panel_bottom = width - margin, height - margin
    panel_width = panel_right - panel_left
    panel_height = panel_bottom - panel_top
    compact = panel_height < 350 or panel_width < 460
    nav_width = 0 if compact else min(190, max(135, int(panel_width * 0.29)))
    content_left = panel_left + nav_width

    dim = cv2.addWeighted(frame, 0.28, np.zeros_like(frame), 0.72, 0)
    frame[:] = dim
    cv2.rectangle(frame, (panel_left, panel_top), (panel_right, panel_bottom), (244, 245, 247), cv2.FILLED)
    cv2.rectangle(frame, (panel_left, panel_top), (panel_left + nav_width, panel_bottom), (237, 239, 242), cv2.FILLED)
    cv2.line(frame, (content_left, panel_top), (content_left, panel_bottom), (222, 225, 230), 1)

    title_y = panel_top + (27 if compact else max(34, panel_height // 11))
    cv2.putText(frame, "Settings", (panel_left + 24, title_y), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (30, 34, 40), 2, cv2.LINE_AA)
    if not compact:
        cv2.putText(frame, "Camera and image", (panel_left + 24, title_y + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (92, 99, 108), 1, cv2.LINE_AA)

    nav_top = panel_top + 57 if compact else title_y + 55
    nav_height = 28 if compact else 38
    nav_items = (("Camera", "camera"), ("Image", "image"))
    for index, (label, section) in enumerate(nav_items):
        if compact:
            item_width = min(100, (panel_width - 32) // 2)
            left = panel_left + 12 + index * (item_width + 8)
            rect = (left, nav_top - 17, left + item_width, nav_top + 8)
            text_x = left + 8
        else:
            top = nav_top + index * (nav_height + 8)
            rect = (panel_left + 10, top - 24, panel_left + nav_width - 10, top + 10)
            text_x = rect[0] + 14
        ui_state["layout"][f"nav_{section}"] = rect
        if ui_state["section"] == section:
            cv2.rectangle(frame, (rect[0], rect[1]), (rect[2], rect[3]), (222, 235, 248), cv2.FILLED)
            cv2.rectangle(frame, (rect[0], rect[1]), (rect[0] + 3, rect[3]), (0, 120, 212), cv2.FILLED)
        cv2.putText(frame, label, (text_x, rect[3] - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (39, 43, 49), 1, cv2.LINE_AA)

    close_size = 34
    close_x = panel_right - close_size - 12
    close_y = panel_top + 12
    ui_state["layout"]["close"] = (close_x, close_y, close_x + close_size, close_y + close_size)
    cv2.putText(frame, "x", (close_x + 11, close_y + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (72, 78, 87), 1, cv2.LINE_AA)

    section = ui_state["section"]
    heading = "Camera" if section == "camera" else "Image calibration"
    body = "Digital controls for this app's camera view" if section == "camera" else "Adjust color before hand and object recognition"
    content_x = panel_left + 18 if compact else content_left + 24
    content_width = panel_right - content_x - 18 if compact else panel_right - content_x - 24
    heading_y = panel_top + 91 if compact else title_y + 8
    if not compact:
        cv2.putText(frame, heading, (content_x, heading_y), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (30, 34, 40), 2, cv2.LINE_AA)
        cv2.putText(frame, body, (content_x, heading_y + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (92, 99, 108), 1, cv2.LINE_AA)

    ui_state["layout"]["sliders"] = {}
    if section == "camera":
        names = ("zoom", "window")
        row_height = max(34, min(82, (panel_height - (112 if compact else 180)) // 2))
    else:
        names = ("brightness", "contrast", "saturation", "hue")
        row_height = max(30, min(64, (panel_height - (96 if compact else 178)) // 4))
    first_y = panel_top + 94 if compact else heading_y + 72
    for index, name in enumerate(names):
        draw_slider(frame, ui_state, name, content_x, first_y + index * row_height, content_width, row_height)

    if not compact:
        reset_width = 90
        reset_height = 30
        reset_x = panel_right - reset_width - 20
        reset_y = panel_bottom - reset_height - 14
        ui_state["layout"]["reset"] = (reset_x, reset_y, reset_x + reset_width, reset_y + reset_height)
        cv2.rectangle(frame, (reset_x, reset_y), (reset_x + reset_width, reset_y + reset_height), (232, 234, 237), cv2.FILLED)
        cv2.putText(frame, "Reset", (reset_x + 21, reset_y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (48, 53, 60), 1, cv2.LINE_AA)


def toggle_settings(ui_state: dict) -> None:
    ui_state["settings_open"] = not ui_state["settings_open"]
    ui_state["active_slider"] = None


def apply_digital_zoom(frame, zoom_percent: int):
    if zoom_percent <= 100:
        return frame

    height, width = frame.shape[:2]
    crop_width = max(1, int(width * 100 / zoom_percent))
    crop_height = max(1, int(height * 100 / zoom_percent))
    left = (width - crop_width) // 2
    top = (height - crop_height) // 2
    cropped = frame[top:top + crop_height, left:left + crop_width]
    return cv2.resize(cropped, (width, height), interpolation=cv2.INTER_LINEAR)


def calibrate_colors(frame, brightness: int, contrast: int, saturation: int, hue: int):
    adjusted = cv2.convertScaleAbs(
        frame,
        alpha=contrast / 100.0,
        beta=brightness - 100,
    )
    if saturation == 100 and hue == 180:
        return adjusted

    hsv = cv2.cvtColor(adjusted, cv2.COLOR_BGR2HSV)
    hue_shift = int(round((hue - 180) / 2))
    hsv[:, :, 0] = (
        (hsv[:, :, 0].astype(np.int16) + hue_shift) % 180
    ).astype(np.uint8)
    hsv[:, :, 1] = np.clip(
        hsv[:, :, 1].astype(np.float32) * (saturation / 100.0),
        0,
        255,
    ).astype(np.uint8)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)


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
    )
    object_options = mp.tasks.vision.ObjectDetectorOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.object_model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        max_results=5,
        score_threshold=0.45,
    )

    last_timestamp_ms = -1
    frame_index = 0
    object_detections = []
    status = "Press 1-5 to save a labeled sample; Q to quit"
    status_until = 0.0
    ui_state = make_ui_state()
    last_window_size = -1
    cv2.namedWindow(CAMERA_WINDOW, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(CAMERA_WINDOW, 960, 540)
    cv2.setMouseCallback(CAMERA_WINDOW, handle_mouse, ui_state)
    try:
        with mp.tasks.vision.GestureRecognizer.create_from_options(gesture_options) as recognizer, \
            mp.tasks.vision.ObjectDetector.create_from_options(object_options) as object_detector:
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
                source_height, source_width = frame.shape[:2]
                values = ui_state["values"]
                zoom_percent = values["zoom"]
                window_size = values["window"]

                if window_size != last_window_size:
                    cv2.resizeWindow(
                        CAMERA_WINDOW,
                        max(320, int(source_width * window_size / 100)),
                        max(240, int(source_height * window_size / 100)),
                    )
                    last_window_size = window_size

                frame = apply_digital_zoom(frame, zoom_percent)
                frame = calibrate_colors(
                    frame,
                    values["brightness"],
                    values["contrast"],
                    values["saturation"],
                    values["hue"] + 180,
                )
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                timestamp_ms = max(time.monotonic_ns() // 1_000_000, last_timestamp_ms + 1)
                last_timestamp_ms = timestamp_ms
                result = recognizer.recognize_for_video(image, timestamp_ms)
                if frame_index % OBJECT_DETECTION_INTERVAL == 0:
                    object_result = object_detector.detect_for_video(image, timestamp_ms)
                    object_detections = object_result.detections
                frame_index += 1

                draw_hands(frame, result)
                draw_objects(frame, object_detections)
                cv2.putText(
                    frame,
                    f"Hands: {len(result.hand_landmarks)}  Objects: {len(object_detections)}",
                    (16, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )
                message = status if time.monotonic() < status_until else (
                    "1 Open palm  2 Fist  3 Peace  4 Pointing  5 Thumbs up  Q Quit"
                )
                cv2.putText(
                    frame,
                    "Settings: click the gear or press Ctrl+I | Q: quit",
                    (16, frame.shape[0] - 18),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    message,
                    (16, frame.shape[0] - 42),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )
                draw_settings_overlay(frame, ui_state)
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
                    if ui_state["settings_open"]:
                        ui_state["settings_open"] = False
                    else:
                        break
                if key_code in (9, ord("i"), ord("I")):
                    toggle_settings(ui_state)
                if key_code in (ord("+"), ord("=")):
                    values["zoom"] = min(300, values["zoom"] + 10)
                if key_code in (ord("-"), ord("_")):
                    values["zoom"] = max(100, values["zoom"] - 10)
                if key_code == ord("r"):
                    ui_state["values"] = {name: config[3] for name, config in SLIDER_CONFIG.items()}
                if not ui_state["settings_open"] and key_code in GESTURES:
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
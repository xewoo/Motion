# Gesture and Object Detector

Live hand and object recognition with Python, OpenCV, and MediaPipe Tasks. The camera view draws the 21 landmarks for each hand, labels recognized hand gestures, and outlines recognized objects with their class and confidence.

## Requirements

- Python 3.9-3.13
- A webcam

## Setup

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Start the camera app:

```powershell
python app.py
```

On first launch, the gesture-recognition, EfficientDet Lite0, and Face Landmarker models are downloaded to `models/`. Use `--camera 1` to select another camera device. Press `Q` to close the window.

The app does not change camera properties or apply zoom, brightness, contrast, saturation, or hue adjustments. The mirrored camera frame is passed directly to the recognizers. Press `Q` or `Esc` to exit; closing the camera window also exits the app.

The built-in gesture model recognizes common gestures such as open palm, fist, pointing up, thumbs up/down, victory, and "I Love You". Results are confidence-filtered and smoothed across frames. "I Love You" is accepted only when the thumb, index, and pinky are extended while the middle and ring fingers are curled. The custom "Six-seven (67)" label requires two open hands to alternate vertical positions; hold both hands in view and move them up and down in turns.

Face Landmarker draws a face outline, eyes, and lips, then estimates expression cues (happy, surprised, sad, angry, neutral) from its blendshape scores. These labels describe visible facial movement and are not a reliable measurement of someone's actual feelings. The object detector recognizes common COCO classes; it does not identify arbitrary objects.

## Capture a dataset

Show a hand pose to the camera and press the corresponding key. One row is saved per detected hand in `data/landmarks.csv`:

| Key | Label |
| --- | --- |
| `1` | `open_palm` |
| `2` | `fist` |
| `3` | `peace` |
| `4` | `pointing` |
| `5` | `thumbs_up` |

Each sample contains the label, handedness, and normalized `x`, `y`, `z` coordinates for all 21 landmarks. Capture varied examples for each label to build a dataset for custom gesture training.

## Run recognition tests

```powershell
python -m unittest discover -s tests -v
```
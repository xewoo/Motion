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

On first launch, the gesture-recognition and EfficientDet Lite0 object-detection models are downloaded to `models/`. Use `--camera 1` to select another camera device. Press `Q` or `Esc` to close the window.

Click the translucent gear in the top-right corner or press `Ctrl+I` to open the in-window settings. The Camera section has digital zoom and preview window size; Image calibration has brightness, contrast, saturation, and hue sliders. These image adjustments are applied before recognition. `+` and `-` change digital zoom, `R` resets the controls, and `Esc` closes the settings overlay (press it again to exit). Closing the camera window also exits the app.

The built-in gesture model recognizes common gestures such as open palm, fist, pointing up, thumbs up/down, victory, and "I love you". The object detector recognizes common COCO classes; it does not identify arbitrary objects.

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
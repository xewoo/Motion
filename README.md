# Temple Guardian: Motion

**Temple Guardian: Motion** is a browser rhythm game controlled by hand gestures. The webcam becomes the controller: the player completes a short tutorial, selects difficulty and a hand mode, then protects the temple by showing the required gestures at the right moment.

The entire game runs in the browser. Camera frames are processed locally with MediaPipe; no video is sent to a server.

## Project description

The project was created for the ADMIT Hackathon Motion case. It demonstrates a complete camera-control scenario:

`gesture -> local recognition -> game response -> score and result`

The recognizer uses custom rules based on 3D joint angles of the fingers. It does not rely only on a ready-made gesture label from the library.

## Features

- First-run tutorial for five gestures, with no time limit.
- Five gestures: Open Palm, Fist, Victory, Pointing, and Thumbs Up.
- Three difficulty levels: Easy, Medium, and Hard.
- Three hand modes: Solo, Two Hands, and Split Hands.
- Two-hand skeleton overlay and feedback when a hand is missing or the gesture is incorrect.
- Fullscreen adaptive layout, front-camera preference, and preserved camera aspect ratio.
- Local high-score table stored in the browser.
- Music toggle and saved volume control.
- Visual effects for hits, misses, training completion, and combat.

## Run the game

### GitHub Pages

Push to `main` triggers the included GitHub Pages workflow. Open the Pages URL configured for this repository and allow camera access.

### Local preview

Serve the `web/` folder with any static web server, for example VS Code Live Server. Open the served URL in current Chrome or Edge; do not open `index.html` directly, because webcam access requires `https` or `localhost`.

No Python application, API, database, or installation is required for the game itself.

## How to play

1. Press **Start training** and show each requested gesture clearly.
2. After training, choose a difficulty and hand mode.
3. Press **Start level**.
4. Match the note when it reaches the center of the rhythm lane.
5. Protect the temple for three waves and improve the local record.

In **Two Hands**, both hands repeat the same gesture. In **Split Hands**, the left and right hands show different gestures. The lower-right camera panel shows the camera image, hand skeletons, and detected gestures.

## Repository layout

- `web/` - deployable Temple Guardian game.
- `browser/` - standalone browser gesture-recognition prototype.
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment.

## Verification

Run the game recognizer tests from the repository root:

```powershell
node --test web/game.test.js
```

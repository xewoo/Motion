# Temple Guardian architecture

## Product vision

Temple Guardian is a rhythm-defense game where the player protects a temple against monsters using live gestures and facial expressions captured from the camera. The gameplay loop is:

1. A gesture prompt appears on screen.
2. The player performs the matching gesture in time with the music.
3. A successful hit triggers an attack animation.
4. Enemies lose health and the player builds combo/streak points.
5. Missed hits reduce temple health.

## Frontend stack

- GitHub Pages for static hosting
- HTML + CSS + vanilla JavaScript
- MediaPipe in the browser or a WebRTC camera capture layer
- Rhythm UI rendered in the browser

## Backend stack

- Azure App Service or Azure Container Apps
- Python FastAPI API
- PostgreSQL database in Azure Database for PostgreSQL

## Data model

### `players`
- id
- username
- email
- created_at

### `sessions`
- id
- player_id
- started_at
- ended_at
- score
- combo_max
- temple_hp_start
- temple_hp_end
- result

### `gestures`
- id
- name
- description

### `session_events`
- id
- session_id
- timestamp
- event_type
- gesture_name
- accuracy
- is_hit

## Deployment plan

### GitHub Pages
- The `.github/workflows/deploy-pages.yml` workflow publishes the `web/` folder automatically on pushes to `main` that change `web/`.
- The current game is a static browser app and does not require an Azure server; camera access and gesture recognition run in the browser.
- The optional API and persistent score storage described below are not connected to the game yet.

### Azure API
- Deploy FastAPI application from `api/` with Azure App Service or Container Apps
- Configure environment variables for `DATABASE_URL`
- Use PostgreSQL on Azure Database for PostgreSQL Flexible Server

### Database access
- Use SQLAlchemy or psycopg to connect from the API
- Save scores, sessions, and player stats

## MVP roadmap

1. Browser camera preview in a small panel
2. Temple background and rhythm lane
3. Hit/miss logic for 4 to 6 gestures
4. Combo and score
5. Enemy damage animation
6. Save score to API
7. Leaderboard screen
8. Optional auth/profile system

## Local development

### Frontend

```bash
cd web
python -m http.server 8000
```

Then open `http://localhost:8000`.

### Backend

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

## Production notes

- GitHub Pages is best for static UI only.
- Sensitive game logic and persistent storage should remain in the API and PostgreSQL.
- For future scaling, use Azure App Service + Postgres + GitHub Actions + CDN.

import os
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title='Temple Guardian API', version='0.1.0')


class ScorePayload(BaseModel):
    player_name: str
    score: int
    combo: int
    gesture: str
    result: Literal['win', 'loss', 'draw'] = 'win'


@app.get('/health')
def health() -> dict[str, str]:
    return {'status': 'ok', 'service': 'temple-guardian-api'}


@app.get('/api/game/leaderboard')
def leaderboard() -> list[dict[str, object]]:
    return [
        {'player_name': 'demo', 'score': 2500, 'combo': 12, 'gesture': 'Victory'},
        {'player_name': 'player', 'score': 1800, 'combo': 8, 'gesture': 'Fist'},
    ]


@app.post('/api/game/score')
def save_score(payload: ScorePayload) -> dict[str, object]:
    return {
        'saved': True,
        'player_name': payload.player_name,
        'score': payload.score,
        'combo': payload.combo,
        'result': payload.result,
        'gesture': payload.gesture,
        'database_url_configured': bool(os.getenv('DATABASE_URL')),
    }


@app.get('/')
def root() -> dict[str, str]:
    return {'message': 'Temple Guardian API is running.'}

# stede

*Stede* — the old word for a location or place.

## Layout

- `backend/` — Python API (FastAPI, managed with [uv](https://docs.astral.sh/uv/))
- `frontend/` — TypeScript web app (React + Vite)

## Development

Backend (http://localhost:8000):

```sh
cd backend
uv sync
uv run uvicorn stede.main:app --reload
uv run pytest
```

Frontend (http://localhost:5173, proxies `/api` to the backend):

```sh
cd frontend
npm install
npm run dev
```

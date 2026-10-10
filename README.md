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

To try it on a phone on the same network, run `npm run dev:lan` instead and open
https://<your-mac>.local:5173 (or the "Network" address it prints). It serves
over HTTPS, which browsers require before sharing your location.

Safari only shares your location with a certificate it trusts. With
[mkcert](https://github.com/FiloSottile/mkcert), once:

```sh
cd frontend
mkdir -p .cert
mkcert -key-file .cert/key.pem -cert-file .cert/cert.pem \
  localhost 127.0.0.1 "$(ipconfig getifaddr en0)" "$(scutil --get LocalHostName).local"
```

then send `rootCA.pem` from `mkcert -CAROOT` to the phone (never the key), install
the profile, and turn on full trust in Settings → General → About → Certificate
Trust Settings. Without `.cert/`, `dev:lan` falls back to a self-signed
certificate (fine for everything but location).

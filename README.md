# DadaPal

DadaPal is a web-first MVP for simulating a WeCom-style Dada assistant before the real enterprise WeChat account is available.

The first version is intentionally mock-driven: a mobile WeChat-like web UI, a deterministic bot flow, a group invite QR card, and a FastAPI backend boundary that can later switch from mock replies to OpenRouter-powered agent replies.

## Structure

```text
DadaPal/
  apps/
    web/   React + Vite fake-WeChat UI
    api/   FastAPI backend and bot engine boundary
  docker-compose.yml
  .env.example
```

## Local Development

Run the web app first. It will try to connect to FastAPI at `http://localhost:8000`; if the API is not running, it automatically falls back to local mock replies.

```sh
cd apps/web
npm install
npm run dev
```

For a quick backend smoke test without Docker or PostgreSQL, run FastAPI with a local SQLite file:

```sh
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="sqlite+pysqlite:///./dadapal.local.db" uvicorn app.main:app --reload
```

To enable model-guided replies, set server-side env vars before starting FastAPI:

```sh
export OPENROUTER_API_KEY="your_key_here"
export OPENROUTER_MODEL="openrouter/auto"
```

Security boundary: keep `OPENROUTER_API_KEY` only in backend runtime env. Do not place provider keys in `VITE_*` variables.

For the intended PostgreSQL-backed local stack, start PostgreSQL first:


```sh
docker compose up -d postgres
```

Run the API:

```sh
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The web app expects the API at `http://localhost:8000` by default. Override it with `VITE_API_BASE_URL` if needed.

Conversation logic note: backend now uses a model-guided decision tree. The model classifies user natural language intent, while stage transitions remain deterministic in API code so the journey stays logical.

Profile collection is context-aware: the web app sends the current stage goal, latest user input, known profile fields, and recent role-marked turns (`user` vs `agent`) to `/profile/extract`. The backend model returns both structured profile updates and an `assistant_reply`, while backend validation prevents profile fields from being filled from the assistant's own examples.

## Deployment Path

For the first online demo, deploy the built web files, FastAPI service, and PostgreSQL on one small Tencent Cloud Lighthouse/CVM in Hong Kong. Expose the public IP first for a smoke test, then add a domain, Nginx, and HTTPS when sharing publicly.

GitHub Pages can host a pure frontend preview, but it cannot run FastAPI or PostgreSQL. Once persistence or OpenRouter proxying is needed, the web app should point to a real API server.
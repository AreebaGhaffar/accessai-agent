# Start the AccessAI backend using the project virtual environment.
# Usage: .\run_backend.ps1
#
# Always use this script (or the .venv uvicorn directly) instead of a bare
# `python backend.py` so that all dependencies (boto3, fastapi, etc.) are
# available regardless of which Python is on the system PATH.

$ErrorActionPreference = "Stop"

# ── Canonical port ────────────────────────────────────────────────────────
# This is the single source of truth for the backend port.
# voice_test.html and any other frontend files must use this same value.
$PORT = 8000
# ─────────────────────────────────────────────────────────────────────────

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$uvicorn   = Join-Path $scriptDir ".venv\Scripts\uvicorn.exe"

if (-not (Test-Path $uvicorn)) {
    Write-Error "Virtual environment not found at $uvicorn. Run: python -m venv .venv && .venv\Scripts\pip install -r requirements.txt"
    exit 1
}

& $uvicorn backend:app --host 0.0.0.0 --port $PORT --reload

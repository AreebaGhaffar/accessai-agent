"""
cloud_brain.py — the "thinking" layer.

Exposes a single endpoint:
  POST /plan  {"text": "..."}  →  JSON array of action steps from Claude.

No execution happens here — no pyautogui, no webbrowser, no clicking.
Run on port 8000 (default).
"""

import collections
import hashlib
import hmac
import logging
import os
import subprocess
import json
import datetime as _dt
from pathlib import Path

import boto3
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("accessai.demo")

# ---------------------------------------------------------------------------
# API-key guard (set BRAIN_API_KEY in the environment to enable)
# ---------------------------------------------------------------------------

BRAIN_API_KEY = os.environ.get("BRAIN_API_KEY", "")

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="AccessAI Cloud Brain")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Bedrock client (lazy-initialised with credential refresh)
# ---------------------------------------------------------------------------

MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

_bedrock_client = None


def get_bedrock_client():
    """Return a Bedrock client using boto3's default credential chain:
    your aws configure keys locally, the instance role on Elastic Beanstalk."""
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-runtime", region_name="us-east-1")
    return _bedrock_client


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a computer-automation assistant that can control any app, \
website, or desktop program.


When given a natural-language instruction you MUST:
1. Reason about what application or website is involved and, if it is a website, \
   determine its most likely URL from general knowledge (e.g. Instagram → \
   https://www.instagram.com, Gmail → https://mail.google.com, \
   Netflix → https://www.netflix.com, etc.).
2. Break the instruction into an ordered sequence of atomic steps needed to \
   complete it end-to-end (e.g. open the browser first, then scroll, then click, etc.).
3. Return ONLY a JSON object with a single key "steps" whose value is an array. \
   Each element is an object with exactly two string fields:
     "action" — one of: open_browser | click | type_text | scroll | \
                         key_press | wait | read_screen | compose_email | whatsapp_message
     "target" — what to act on (a URL, button label, text to type, key name, \
                  scroll direction, wait duration in ms, or a JSON string for compose_email)

Rules:
- Never hardcode logic for specific apps — figure out URLs and UI flows \
  dynamically from general knowledge.
- Always start with open_browser + the correct URL when the task involves a \
  website or web app.
- Use wait steps (target: "1500") between actions that require a page to load.
- No explanation, no markdown fences — respond with raw JSON only.

SPECIAL RULE — sending email via Gmail:
When the task involves sending an email through Gmail, you MUST use ONLY the \
compose_email action — do NOT add open_browser or wait steps before it. \
The compose_email action opens Gmail itself via a pre-filled URL internally. \
The target for compose_email must be a JSON string with keys: \
"to", "subject" (optional), "body" (optional).
Example: {"action":"compose_email","target":"{\\"to\\":\\"user@example.com\\",\\"subject\\":\\"Hello\\",\\"body\\":\\"Hi there\\"}"}
The full step list for a Gmail send task is just ONE step:
  1. compose_email → JSON string with to/subject/body

Example for "open Instagram and scroll down":
{"steps":[{"action":"open_browser","target":"https://www.instagram.com"},{"action":"wait","target":"2000"},{"action":"scroll","target":"down"}]}

Example for "open gmail and send mail to bob@example.com saying hello":
{"steps":[{"action":"compose_email","target":"{\\"to\\":\\"bob@example.com\\",\\"subject\\":\\"hello\\",\\"body\\":\\"hello\\"}"}]}

SPECIAL RULE — sending a WhatsApp message:
When the task involves sending a WhatsApp message, you MUST use ONLY the \
whatsapp_message action — do NOT add open_browser or wait steps before it. \
The whatsapp_message action opens WhatsApp Web internally and waits for it \
to be ready. \
The target must be a JSON string with keys: \
"contact" (the name exactly as the user said it) and "message" (the message text).
Example: {"action":"whatsapp_message","target":"{\\"contact\\":\\"maryam\\",\\"message\\":\\"hi\\"}"}
The full step list for a WhatsApp send task is just ONE step:
  1. whatsapp_message → JSON string with contact/message

Example for "send message to maryam saying hi":
{"steps":[{"action":"whatsapp_message","target":"{\\"contact\\":\\"maryam\\",\\"message\\":\\"hi\\"}"}]}

LANGUAGE SUPPORT:
The user may speak or type in any of the following:
- English
- Urdu (Arabic script, e.g. "مریم کو واٹس ایپ پر میسج بھیجو")
- Roman Urdu (Urdu written in English letters, e.g. "maryam ko whatsapp pe message bhejo ke main late ho gaya hoon")
- A natural mix of the above in a single command

Rules for multilingual input:
- Always understand the user's intent regardless of which language or script they use.
- The "action" field in every step MUST always be one of the English action names: \
  open_browser | click | type_text | scroll | key_press | wait | read_screen | compose_email | whatsapp_message
- Keep contact names exactly as the user said them (do not translate or transliterate names).
- Keep message bodies and email subjects/bodies in the same language and script the user used; \
  do NOT translate them unless the user explicitly asks for a translation.

Example — Roman Urdu WhatsApp message \
("maryam ko message bhejo ke main late ho gaya hoon"):
{"steps":[{"action":"whatsapp_message","target":"{\\"contact\\":\\"maryam\\",\\"message\\":\\"main late ho gaya hoon\\"}"}]}

Example — Roman Urdu browsing \
("instagram kholo aur neeche scroll karo"):
{"steps":[{"action":"open_browser","target":"https://www.instagram.com"},{"action":"wait","target":"2000"},{"action":"scroll","target":"down"}]}"""


# ---------------------------------------------------------------------------
# Claude call
# ---------------------------------------------------------------------------

def ask_claude(user_text: str) -> list[dict]:
    """Send user_text to Claude via Bedrock and return a list of action dicts."""
    client = get_bedrock_client()

    response = client.converse(
        modelId=MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[
            {
                "role": "user",
                "content": [{"text": user_text}],
            }
        ],
        inferenceConfig={"maxTokens": 1024},
    )

    reply = response["output"]["message"]["content"][0]["text"]

    # Strip markdown code fences if Claude wrapped the JSON
    clean = reply.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        inner = [line for line in lines[1:] if not line.strip().startswith("```")]
        clean = "\n".join(inner).strip()

    data = json.loads(clean)

    # Accept both {"steps": [...]} and a bare list
    if isinstance(data, list):
        return data
    return data.get("steps", [data])


# ---------------------------------------------------------------------------
# Demo system prompt
# ---------------------------------------------------------------------------

DEMO_SYSTEM_PROMPT = """You are an accessibility assistant inside a PRACTICE demo of \
a fake WhatsApp. The user is learning to use the app.

The only contacts that exist in this fake WhatsApp are:
  Maryam, Ayesha, Mom, Caregiver, Doctor

Things you CAN do inside this WhatsApp:
  - Open a chat with a contact
  - Read the last message in a chat
  - Send a message
  - Make a call (audio or video)
  - Search for a contact or message

You must NEVER suggest executing anything — this is planning only.

Rules:
1. If the request is clear and matches exactly one contact, produce a concrete plan.
2. If the contact name is ambiguous or unclear, ask a short clarifying question in \
   "say" and set needs_reply to true. Do not guess.
3. If the request is something you cannot do inside WhatsApp, say so honestly in "say" \
   and briefly list what you can do.
4. Always respond in the SAME language the user used: English, Urdu (Arabic script), \
   or Roman Urdu — never translate unless asked.
5. "say" must be one or two short spoken sentences, friendly and natural — as if \
   spoken aloud to someone learning to use a phone.
6. "needs_confirm" is true when an action is about to be taken (e.g. sending a message \
   or making a call) and you want the user to confirm first.
7. "needs_reply" is true only when you asked a question and need the user to answer \
   before proceeding.

You MUST return ONLY valid JSON — no markdown, no explanation — in this exact shape:
{
  "say": "<one or two short spoken sentences>",
  "steps": ["<short human-readable step>", ...],
  "needs_confirm": true or false,
  "needs_reply": true or false
}"""


# ---------------------------------------------------------------------------
# Demo rate-limit state (in-memory, resets on process restart)
# ---------------------------------------------------------------------------

# Per-IP: deque of UTC timestamps for the current rolling minute
_demo_ip_timestamps: dict[str, collections.deque] = {}

# Global daily counter: {"date": "YYYY-MM-DD", "count": int}
_demo_global = {"date": "", "count": 0}

_DEMO_PER_IP_PER_MINUTE = 10
_DEMO_GLOBAL_PER_DAY = 300


def _get_client_ip(request: Request) -> str:
    """Return the client IP: first value of X-Forwarded-For, else host."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _demo_rate_check(ip: str) -> bool:
    """
    Return True if the request is within limits, False if it should be rejected.
    Updates counters only when returning True.
    """
    now = _dt.datetime.utcnow()
    today = now.strftime("%Y-%m-%d")

    # Global daily cap
    if _demo_global["date"] != today:
        _demo_global["date"] = today
        _demo_global["count"] = 0

    if _demo_global["count"] >= _DEMO_GLOBAL_PER_DAY:
        return False

    # Per-IP rolling-minute cap
    if ip not in _demo_ip_timestamps:
        _demo_ip_timestamps[ip] = collections.deque()

    dq = _demo_ip_timestamps[ip]
    cutoff = now - _dt.timedelta(seconds=60)
    while dq and dq[0] < cutoff:
        dq.popleft()

    if len(dq) >= _DEMO_PER_IP_PER_MINUTE:
        return False

    # Passed — record the hit
    dq.append(now)
    _demo_global["count"] += 1
    return True


# ---------------------------------------------------------------------------
# Demo Bedrock call
# ---------------------------------------------------------------------------

_DEMO_FALLBACK = {
    "say": "Sorry, I had trouble thinking about that. Please try again.",
    "steps": [],
    "needs_confirm": False,
    "needs_reply": False,
}


def ask_claude_demo(user_text: str) -> dict:
    """Call Claude with the demo system prompt and return a parsed dict."""
    client = get_bedrock_client()

    response = client.converse(
        modelId=MODEL_ID,
        system=[{"text": DEMO_SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": user_text}]}],
        inferenceConfig={"maxTokens": 300},
    )

    raw = response["output"]["message"]["content"][0]["text"].strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        lines = raw.splitlines()
        inner = [l for l in lines[1:] if not l.strip().startswith("```")]
        raw = "\n".join(inner).strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Parsing failed — return a safe fallback with a friendly message
        return _DEMO_FALLBACK.copy()

    # Ensure required keys exist with sane defaults
    return {
        "say": str(data.get("say", _DEMO_FALLBACK["say"])),
        "steps": list(data.get("steps", [])),
        "needs_confirm": bool(data.get("needs_confirm", False)),
        "needs_reply": bool(data.get("needs_reply", False)),
    }


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class PlanRequest(BaseModel):
    text: str


class PlanResponse(BaseModel):
    steps: list[dict]


class DemoRequest(BaseModel):
    text: str


# ---------------------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    """Serve the landing page — no API key required."""
    index = Path(__file__).parent / "index.html"
    return FileResponse(str(index), media_type="text/html")


@app.get("/health")
async def health():
    """Health check — no API key required."""
    return {"status": "ok", "service": "accessai-brain"}


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.post("/plan", response_model=PlanResponse)
async def plan(req: PlanRequest, request: Request):
    """
    Accept a natural-language command, ask Claude to produce an ordered list
    of action steps, and return them as JSON — no execution occurs here.
    """
    # API-key check — skipped when BRAIN_API_KEY is not configured
    if BRAIN_API_KEY:
        incoming_key = request.headers.get("X-API-Key", "")
        if not hmac.compare_digest(incoming_key, BRAIN_API_KEY):
            raise HTTPException(status_code=401, detail="Invalid or missing API key")

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="'text' must not be empty.")

    try:
        steps = ask_claude(req.text)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not retrieve AWS credentials: {exc.stderr}",
        )
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Claude returned non-JSON output: {exc}",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return PlanResponse(steps=steps)


# ---------------------------------------------------------------------------
# Demo endpoint — no API key, planning only, rate-limited
# ---------------------------------------------------------------------------

@app.post("/demo")
async def demo(req: DemoRequest, request: Request):
    """
    Practice endpoint — plans actions inside a fake WhatsApp demo.
    No execution, no API key required.
    """
    # --- Input validation ---
    text = req.text.strip() if req.text else ""
    if not text:
        raise HTTPException(status_code=400, detail="'text' must not be empty.")
    if len(text) > 200:
        raise HTTPException(
            status_code=400,
            detail="'text' must be 200 characters or fewer.",
        )

    # --- Rate limiting ---
    ip = _get_client_ip(request)
    if not _demo_rate_check(ip):
        return JSONResponse(
            status_code=429,
            content={"say": "The demo is busy right now. Please try again in a minute."},
        )

    # --- Logging (no message content) ---
    ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:12]
    logger.info(
        "demo request ts=%s ip_hash=%s text_len=%d",
        _dt.datetime.utcnow().isoformat(),
        ip_hash,
        len(text),
    )

    # --- Bedrock call ---
    try:
        result = ask_claude_demo(text)
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"say": "The demo is temporarily unavailable."},
        )

    return result


# ---------------------------------------------------------------------------
# Dev entry-point  (python cloud_brain.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    import os

    venv_python = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        ".venv", "Scripts", "python.exe",
    )
    if os.path.exists(venv_python) and sys.executable != os.path.normcase(venv_python):
        os.execv(venv_python, [venv_python] + sys.argv)

    import uvicorn
    uvicorn.run("cloud_brain:app", host="0.0.0.0", port=8000, reload=True)

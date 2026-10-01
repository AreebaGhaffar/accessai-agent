"""
cloud_brain.py — the "thinking" layer.

Exposes a single endpoint:
  POST /plan  {"text": "..."}  →  JSON array of action steps from Claude.

No execution happens here — no pyautogui, no webbrowser, no clicking.
Run on port 8000 (default).
"""

import subprocess
import json
import datetime as _dt

import boto3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
                         key_press | wait | read_screen | compose_email
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
{"steps":[{"action":"compose_email","target":"{\\"to\\":\\"bob@example.com\\",\\"subject\\":\\"hello\\",\\"body\\":\\"hello\\"}"}]}"""


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
# Request / response models
# ---------------------------------------------------------------------------

class PlanRequest(BaseModel):
    text: str


class PlanResponse(BaseModel):
    steps: list[dict]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.post("/plan", response_model=PlanResponse)
async def plan(req: PlanRequest):
    """
    Accept a natural-language command, ask Claude to produce an ordered list
    of action steps, and return them as JSON — no execution occurs here.
    """
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

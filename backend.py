import subprocess
import json
import webbrowser

import boto3
import pyautogui
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="AccessAI Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten this for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Bedrock client (lazy-initialised so startup is fast)
# ---------------------------------------------------------------------------

MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

_bedrock_client = None


def get_bedrock_client():
    """Return a cached Bedrock runtime client using AWS CLI credentials."""
    global _bedrock_client
    if _bedrock_client is not None:
        return _bedrock_client

    result = subprocess.run(
        ["aws", "configure", "export-credentials", "--profile", "default"],
        capture_output=True,
        text=True,
        check=True,
    )
    creds = json.loads(result.stdout)

    session = boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds.get("SessionToken"),
        region_name="us-east-1",
    )
    _bedrock_client = session.client("bedrock-runtime")
    return _bedrock_client


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CommandRequest(BaseModel):
    text: str


class CommandResponse(BaseModel):
    action: str
    target: str
    status: str


# ---------------------------------------------------------------------------
# Helper: call Claude and parse the JSON action
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are a computer-automation assistant. "
    "When given a natural-language instruction, respond ONLY with a JSON object "
    "containing exactly two fields: "
    "'action' (one of: open_browser, click, type_text, scroll, read_screen) and "
    "'target' (what to open/click/type, e.g. a URL or text). "
    "No explanation, no markdown fences — just the raw JSON."
)


def ask_claude(user_text: str) -> dict:
    """Send user_text to Claude Haiku via Bedrock and return parsed action dict."""
    client = get_bedrock_client()

    prompt = f"The user said: '{user_text}'. {SYSTEM_PROMPT}"

    response = client.converse(
        modelId=MODEL_ID,
        messages=[
            {
                "role": "user",
                "content": [{"text": prompt}],
            }
        ],
        inferenceConfig={"maxTokens": 512},
    )

    reply = response["output"]["message"]["content"][0]["text"]

    # Strip markdown code fences if Claude wrapped the JSON in ```json … ```
    clean = reply.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        inner = [line for line in lines[1:] if not line.strip().startswith("```")]
        clean = "\n".join(inner).strip()

    return json.loads(clean)


# ---------------------------------------------------------------------------
# Helper: execute the action locally
# ---------------------------------------------------------------------------

def execute_action(action: str, target: str) -> str:
    """Execute the resolved action and return a status string."""
    if action == "open_browser":
        webbrowser.open(target)
        return "executed"

    if action == "scroll":
        # negative = scroll down
        pyautogui.scroll(-500)
        return "executed"

    if action == "type_text":
        pyautogui.write(target, interval=0.05)
        return "executed"

    if action == "click":
        # Locate and click if target is a screen label; fall back gracefully
        try:
            location = pyautogui.locateCenterOnScreen(target, confidence=0.8)
            if location:
                pyautogui.click(location)
                return "executed"
        except Exception:
            pass
        return "not_found"

    if action == "read_screen":
        # Placeholder — actual OCR would go here
        return "not_implemented"

    return "unknown_action"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.post("/command", response_model=CommandResponse)
async def handle_command(req: CommandRequest):
    """
    Accept a natural-language command, translate it via Claude Haiku,
    execute the resulting action, and return the outcome.
    """
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="'text' must not be empty.")

    try:
        data = ask_claude(req.text)
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

    action = data.get("action", "unknown")
    target = data.get("target", "")

    status = execute_action(action, target)

    return CommandResponse(action=action, target=target, status=status)


# ---------------------------------------------------------------------------
# Dev entry-point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=True)

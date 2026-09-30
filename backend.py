import subprocess
import json
import webbrowser
import urllib.parse

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

import datetime as _dt

_bedrock_client = None
_creds_expiry: _dt.datetime | None = None


def get_bedrock_client():
    """Return a Bedrock runtime client, refreshing credentials when they are
    within 60 seconds of expiry or have already expired."""
    global _bedrock_client, _creds_expiry

    now = _dt.datetime.now(_dt.timezone.utc)
    needs_refresh = (
        _bedrock_client is None
        or _creds_expiry is None
        or (_creds_expiry - now).total_seconds() < 60
    )

    if not needs_refresh:
        return _bedrock_client

    result = subprocess.run(
        ["aws", "configure", "export-credentials", "--profile", "default"],
        capture_output=True,
        text=True,
        check=True,
    )
    creds = json.loads(result.stdout)

    # Parse expiry if present (temporary credentials include an Expiration field)
    expiry_str = creds.get("Expiration")
    if expiry_str:
        _creds_expiry = _dt.datetime.fromisoformat(expiry_str.replace("Z", "+00:00"))
    else:
        # Long-term keys don't expire; set a far-future sentinel
        _creds_expiry = now + _dt.timedelta(hours=12)

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


class StepResult(BaseModel):
    action: str
    target: str
    status: str


class CommandResponse(BaseModel):
    steps: list[StepResult]
    overall_status: str


# ---------------------------------------------------------------------------
# Helper: call Claude and parse the JSON step list
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
    return data.get("steps", [data])  # fallback: treat root object as single step


# ---------------------------------------------------------------------------
# Helper: execute a single action step
# ---------------------------------------------------------------------------

import time       # noqa: E402
import platform   # noqa: E402


def _focus_browser_window() -> None:
    """Best-effort: bring the most recently opened browser window to the
    foreground on Windows so subsequent pyautogui calls land inside it."""
    if platform.system() != "Windows":
        return
    try:
        subprocess.run(
            [
                "powershell", "-NoProfile", "-Command",
                "$wsh = New-Object -ComObject WScript.Shell; "
                "$proc = Get-Process | Where-Object { $_.MainWindowTitle -match "
                "'Chrome|Firefox|Edge|Instagram|Gmail|Opera|Brave' } | "
                "Sort-Object CPU -Descending | Select-Object -First 1; "
                "if ($proc) { $wsh.AppActivate($proc.Id) }",
            ],
            capture_output=True,
            timeout=5,
        )
        time.sleep(0.4)          # let the OS finish the focus transition
    except Exception:
        pass


def execute_step(action: str, target: str) -> str:
    """Execute one action step and return a status string."""

    # ── open_browser ────────────────────────────────────────────────────
    if action == "open_browser":
        webbrowser.open(target)
        # Give the OS time to actually open/focus the browser window before
        # any follow-up steps (scroll, click, type) run against it.
        time.sleep(1.0)
        return "executed"

    # ── wait ────────────────────────────────────────────────────────────
    if action == "wait":
        try:
            ms = int(target)
        except (ValueError, TypeError):
            ms = 1000
        time.sleep(ms / 1000)
        return "executed"

    # ── scroll ──────────────────────────────────────────────────────────
    if action == "scroll":
        # Ensure the browser has focus, then move the mouse to the centre of
        # the screen so pyautogui.scroll() lands inside the page content area.
        _focus_browser_window()
        sw, sh = pyautogui.size()
        pyautogui.moveTo(sw // 2, sh // 2, duration=0.15)
        time.sleep(0.2)
        # pyautogui.scroll(): positive = up, negative = down
        clicks = -5 if target.lower() in ("down", "scroll down", "") else 5
        pyautogui.scroll(clicks)
        return "executed"

    # ── type_text ───────────────────────────────────────────────────────
    if action == "type_text":
        # pyautogui.write() silently drops non-ASCII characters.
        # Use clipboard paste instead so the full string always arrives.
        try:
            import pyperclip
            pyperclip.copy(target)
            pyautogui.hotkey("ctrl", "v")
        except Exception:
            pyautogui.write(target, interval=0.04)
        return "executed"

    # ── key_press ───────────────────────────────────────────────────────
    if action == "key_press":
        pyautogui.press(target)
        return "executed"

    # ── click ───────────────────────────────────────────────────────────
    if action == "click":
        # Claude passes human-readable labels ("Compose", "To", "Send").
        # Image-based locateCenterOnScreen needs an image file, not a label,
        # so it will always fail.  Use Windows UI Automation to find the
        # element by its accessible name instead.
        _focus_browser_window()
        if platform.system() == "Windows":
            try:
                ps_script = (
                    "Add-Type -AssemblyName UIAutomationClient; "
                    "Add-Type -AssemblyName UIAutomationTypes; "
                    "$root = [System.Windows.Automation.AutomationElement]::RootElement; "
                    f"$cond = New-Object System.Windows.Automation.PropertyCondition("
                    f"  [System.Windows.Automation.AutomationElement]::NameProperty, '{target}'); "
                    "$el = $root.FindFirst("
                    "  [System.Windows.Automation.TreeScope]::Descendants, $cond); "
                    "if ($el) { "
                    "  $pt = $el.GetClickablePoint(); "
                    "  Add-Type -AssemblyName System.Windows.Forms; "
                    "  [System.Windows.Forms.Cursor]::Position = "
                    "    [System.Drawing.Point]::new([int]$pt.X, [int]$pt.Y); "
                    "  Start-Sleep -Milliseconds 100; "
                    "  Add-Type -TypeDefinition '"
                    "    using System; using System.Runtime.InteropServices; "
                    "    public class Clicker { "
                    "      [DllImport(\"user32.dll\")] public static extern void mouse_event(int f,int x,int y,int d,int e); "
                    "    }'; "
                    "  [Clicker]::mouse_event(2,0,0,0,0); "   # MOUSEEVENTF_LEFTDOWN
                    "  [Clicker]::mouse_event(4,0,0,0,0); "   # MOUSEEVENTF_LEFTUP
                    "  Write-Output 'found' "
                    "} else { Write-Output 'not_found' }"
                )
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    capture_output=True, text=True, timeout=10,
                )
                if "found" in result.stdout:
                    return "executed"
            except Exception:
                pass
        return "not_found"

    # ── compose_email ────────────────────────────────────────────────────
    if action == "compose_email":
        """
        Opens Gmail's pre-filled compose URL, waits for the compose box to
        render (verified via screenshot), then sends with Ctrl+Enter.

        URL approach: https://mail.google.com/mail/?view=cm&fs=1&to=X&su=Y&tf=1&body=Z
        Gmail populates To/Subject/Body from the query parameters automatically —
        no clicking into fields, no clipboard paste, no coordinate guessing.

        target: JSON string with keys "to", "subject" (optional), "body" (optional).
        """
        try:
            params = json.loads(target) if isinstance(target, str) else target
        except (json.JSONDecodeError, TypeError):
            return "invalid_compose_params"

        to_addr = params.get("to", "").strip()
        subject = params.get("subject", "").strip()
        body    = params.get("body", "").strip()

        if not to_addr:
            return "missing_to_address"

        from PIL import ImageStat

        # ── Step 1: build the pre-filled compose URL ───────────────────────
        # tf=1  → open in full compose window (not pop-up mini-compose)
        # fs=1  → full-screen compose
        qs = urllib.parse.urlencode({
            "view": "cm",
            "fs":   "1",
            "tf":   "1",
            "to":   to_addr,
            "su":   subject,
            "body": body,
        })
        compose_url = f"https://mail.google.com/mail/?{qs}"

        # ── Step 2: open the URL — Gmail renders a pre-filled compose box ──
        webbrowser.open(compose_url)
        time.sleep(1.0)   # give the OS a moment to hand off to the browser

        # ── Step 3: wait for the browser window to come to the front ───────
        _focus_browser_window()

        # ── Step 4: wait for the compose box to render (up to 12 s) ────────
        # We detect it by sampling the bottom-right quadrant of the screen —
        # Gmail's compose box (dark header ~#404040) darkens that region.
        sw, sh = pyautogui.size()

        def _sample_brightness(left, top, width, height):
            try:
                img = pyautogui.screenshot(region=(left, top, width, height))
                return ImageStat.Stat(img.convert("L")).mean[0]
            except Exception:
                return 200.0  # assume bright (not loaded) on error

        def _compose_visible():
            b = _sample_brightness(sw // 2, sh // 2, sw // 2, sh // 2)
            return b < 110   # compose header darkens this area

        compose_ready = False
        deadline = time.time() + 12.0
        while time.time() < deadline:
            time.sleep(0.6)
            if _compose_visible():
                compose_ready = True
                break

        if not compose_ready:
            # Page may still be loading — give it a final 3 s grace period
            time.sleep(3.0)

        # Extra settle time after detection so the fields are fully interactive
        time.sleep(1.5)

        # ── Step 5: bring the browser window to the foreground ─────────────
        _focus_browser_window()
        time.sleep(0.5)

        # ── Step 6: send with Ctrl+Enter ────────────────────────────────────
        # Fields are already populated by the URL — just send.
        pyautogui.hotkey("ctrl", "enter")
        time.sleep(2.5)

        # ── Step 7: confirm compose is gone (= sent successfully) ──────────
        if _compose_visible():
            # Still open — one retry
            pyautogui.hotkey("ctrl", "enter")
            time.sleep(2.5)

        return "executed" if not _compose_visible() else "sent_unconfirmed"

    # ── read_screen ─────────────────────────────────────────────────────
    if action == "read_screen":
        return "not_implemented"

    return "unknown_action"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.post("/command", response_model=CommandResponse)
async def handle_command(req: CommandRequest):
    """
    Accept a natural-language command, let Claude reason out the full
    step sequence for whatever app/website is involved, execute every
    step in order, and return the per-step outcomes.
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

    results: list[StepResult] = []
    overall = "executed"

    for step in steps:
        action = step.get("action", "unknown")
        target = step.get("target", "")
        status = execute_step(action, target)
        results.append(StepResult(action=action, target=target, status=status))
        if status not in ("executed", "not_implemented"):
            overall = "partial"

    return CommandResponse(steps=results, overall_status=overall)


# ---------------------------------------------------------------------------
# Dev entry-point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    import os

    # Ensure we are running inside the project's virtual environment.
    # If not, re-exec with the venv interpreter so all dependencies are available.
    venv_python = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        ".venv", "Scripts", "python.exe",
    )
    if os.path.exists(venv_python) and sys.executable != os.path.normcase(venv_python):
        os.execv(venv_python, [venv_python] + sys.argv)

    import uvicorn

    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=True)

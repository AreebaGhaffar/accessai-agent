"""
local_executor.py — the "hands" layer.

Exposes a single endpoint:
  POST /command  {"text": "..."}

It calls cloud_brain's /plan endpoint to get the step list from Claude,
then executes each step locally (pyautogui, webbrowser, clipboard, etc.).

Run on port 8001 (default).
Set CLOUD_BRAIN_URL env-var to override where cloud_brain lives.
"""

from pathlib import Path
from fastapi.responses import FileResponse
import json
import os
import platform
import subprocess
import time
import urllib.parse
import webbrowser

import httpx
import pyautogui
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="AccessAI Local Executor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Where to reach the cloud_brain /plan endpoint
CLOUD_BRAIN_URL = os.environ.get("CLOUD_BRAIN_URL", "http://localhost:8002")

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
# Helper: fetch plan from cloud_brain
# ---------------------------------------------------------------------------

async def get_plan(user_text: str) -> list[dict]:
    """Call cloud_brain's /plan and return the list of action dicts."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{CLOUD_BRAIN_URL}/plan",
            json={"text": user_text},
        )
        resp.raise_for_status()
        return resp.json()["steps"]


# ---------------------------------------------------------------------------
# Helper: browser focus
# ---------------------------------------------------------------------------

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
        time.sleep(0.4)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Reusable UI Automation helper
# ---------------------------------------------------------------------------

def click_element_by_name(name: str) -> bool:
    """Find a UI element anywhere on the desktop by its accessible name and
    click it via UIAutomationClient (Windows only).

    Returns True if an element was found and clicked, False otherwise.
    Tries the exact name supplied, so callers may loop over fallback names.
    """
    if platform.system() != "Windows":
        return False

    # Escape any single-quotes in the name so the PS string is valid
    safe_name = name.replace("'", "''")

    ps_script = (
        "Add-Type -AssemblyName UIAutomationClient; "
        "Add-Type -AssemblyName UIAutomationTypes; "
        "Add-Type -AssemblyName System.Windows.Forms; "
        "Add-Type -TypeDefinition '"
        "  using System; using System.Runtime.InteropServices; "
        "  public class UiaClicker { "
        "    [DllImport(\"user32.dll\")] "
        "    public static extern void mouse_event(int f, int x, int y, int d, int e); "
        "  }'; "
        "$root = [System.Windows.Automation.AutomationElement]::RootElement; "
        f"$cond = New-Object System.Windows.Automation.PropertyCondition("
        f"  [System.Windows.Automation.AutomationElement]::NameProperty, '{safe_name}'); "
        "$els = $root.FindAll("
        "  [System.Windows.Automation.TreeScope]::Descendants, $cond); "
        "$clicked = $false; "
        "foreach ($el in $els) { "
        "  try { "
        "    $pt = $el.GetClickablePoint(); "
        "    [System.Windows.Forms.Cursor]::Position = "
        "      [System.Drawing.Point]::new([int]$pt.X, [int]$pt.Y); "
        "    Start-Sleep -Milliseconds 150; "
        "    [UiaClicker]::mouse_event(2,0,0,0,0); "   # MOUSEEVENTF_LEFTDOWN
        "    [UiaClicker]::mouse_event(4,0,0,0,0); "   # MOUSEEVENTF_LEFTUP
        "    $clicked = $true; break "
        "  } catch {} "
        "} "
        "if ($clicked) { Write-Output 'clicked' } else { Write-Output 'not_found' }"
    )

    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_script],
            capture_output=True, text=True, timeout=12,
        )
        return "clicked" in result.stdout
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Action executor
# ---------------------------------------------------------------------------

def execute_step(action: str, target: str) -> str:
    """Execute one action step and return a status string."""

    # ── open_browser ────────────────────────────────────────────────────
    if action == "open_browser":
        webbrowser.open(target)
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
        _focus_browser_window()
        sw, sh = pyautogui.size()
        pyautogui.moveTo(sw // 2, sh // 2, duration=0.15)
        time.sleep(0.2)
        clicks = -600 if target.lower() in ("down", "scroll down", "") else 600
        pyautogui.scroll(clicks)
        return "executed"

    # ── type_text ───────────────────────────────────────────────────────
    if action == "type_text":
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
        _focus_browser_window()
        if click_element_by_name(target):
            return "executed"
        return "not_found"

    # ── compose_email ────────────────────────────────────────────────────
    if action == "compose_email":
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

        qs = urllib.parse.urlencode({
            "view": "cm",
            "fs":   "1",
            "tf":   "1",
            "to":   to_addr,
            "su":   subject,
            "body": body,
        })
        compose_url = f"https://mail.google.com/mail/?{qs}"

        webbrowser.open(compose_url)
        time.sleep(1.0)

        _focus_browser_window()

        sw, sh = pyautogui.size()

        def _sample_brightness(left, top, width, height):
            try:
                img = pyautogui.screenshot(region=(left, top, width, height))
                return ImageStat.Stat(img.convert("L")).mean[0]
            except Exception:
                return 200.0

        def _compose_visible():
            b = _sample_brightness(sw // 2, sh // 2, sw // 2, sh // 2)
            return b < 110

        # ── Wait for the compose box to render (up to 15 s) ────────────
        compose_ready = False
        deadline = time.time() + 15.0
        while time.time() < deadline:
            time.sleep(0.6)
            if _compose_visible():
                compose_ready = True
                break

        if not compose_ready:
            time.sleep(3.0)   # grace period — keep going anyway

        time.sleep(1.5)       # let fields fully settle
        _focus_browser_window()
        time.sleep(0.5)

        # ── Click the "Send" button via UI Automation ──────────────────
        # Gmail labels the button "Send" (exact); try that plus Unicode
        # shortcut-hint variants the browser may append to the name.
        SEND_NAMES = ["Send \u202a(Ctrl-Enter)\u202c", "Send"]

        def _try_send() -> bool:
            for name in SEND_NAMES:
                if click_element_by_name(name):
                    return True
            return False

        def _send_button_exists() -> bool:
            """Return True if any of the Send button names are still in the UIA tree."""
            ps = (
                "Add-Type -AssemblyName UIAutomationClient; "
                "Add-Type -AssemblyName UIAutomationTypes; "
                "$root = [System.Windows.Automation.AutomationElement]::RootElement; "
                "$names = @('Send \u202a(Ctrl-Enter)\u202c'); "
                "foreach ($name in $names) { "
                "  $cond = New-Object System.Windows.Automation.PropertyCondition("
                "    [System.Windows.Automation.AutomationElement]::NameProperty, $name); "
                "  $el = $root.FindFirst("
                "    [System.Windows.Automation.TreeScope]::Descendants, $cond); "
                "  if ($el) { Write-Output 'found'; exit } "
                "} "
                "Write-Output 'gone'"
            )
            try:
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps],
                    capture_output=True, text=True, timeout=10,
                )
                return "found" in res.stdout
            except Exception:
                return False  # assume gone on error

        # Attempt 1
        _try_send()
        time.sleep(2.5)

        # Attempt 2 if the Send button is still present
        if _send_button_exists():
            _focus_browser_window()
            time.sleep(0.3)
            _try_send()
            time.sleep(2.5)

        # Final verdict: compose is gone when Send button is no longer in UIA tree
        if _send_button_exists():
            return "sent_unconfirmed"
        return "executed"
    # ── read_screen ─────────────────────────────────────────────────────
    if action == "read_screen":
        return "not_implemented"

    return "unknown_action"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

APP_HTML = Path(__file__).parent / "app.html"


@app.get("/")
async def home():
    return FileResponse(APP_HTML)
@app.post("/command", response_model=CommandResponse)
async def handle_command(req: CommandRequest):
    """
    Accept a natural-language command, fetch the step plan from cloud_brain,
    execute every step locally, and return per-step outcomes.
    """
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="'text' must not be empty.")

    try:
        steps = await get_plan(req.text)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"cloud_brain returned an error: {exc.response.status_code} {exc.response.text}",
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach cloud_brain at {CLOUD_BRAIN_URL}: {exc}",
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
# Dev entry-point  (python local_executor.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    venv_python = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        ".venv", "Scripts", "python.exe",
    )
    if os.path.exists(venv_python) and sys.executable != os.path.normcase(venv_python):
        os.execv(venv_python, [venv_python] + sys.argv)

    import uvicorn
    uvicorn.run("local_executor:app", host="0.0.0.0", port=8001, reload=True)

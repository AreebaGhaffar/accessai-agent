# AccessAI Agent

**"Hey Access." A hands-free voice assistant for WhatsApp, built for people who cannot use their hands.**

Live URL: http://accessai-brain.us-east-1.elasticbeanstalk.com
Built for the AWS Zero to Shipped hackathon by team Mind Flayer.

## The problem

Millions of people with motor disabilities cannot use a mouse or keyboard comfortably. Most voice tools still ask them to press a button first, or only understand one short command at a time ("open Gmail"). Messaging, which keeps people connected to family, friends and work, should not depend on working hands.

## What AccessAI does

You say the wake phrase and then talk to it like an assistant. It follows what you ask inside WhatsApp, asks when it is unsure, and confirms by voice before anything is sent.

Target conversation:

> **You:** Hey Access.
> **Access:** Yes?
> **You:** Read my last message from Maryam.
> **Access:** Maryam says: "Are you coming tonight?"
> **You:** Send it to Ali.
> **Access:** Send Ali "Are you coming tonight?" Say yes to confirm.
> **You:** Yes.
> **Access:** Sent.

It can ask clarifying questions ("Which Maryam?"), repeat itself on request, spell a contact's name, and tell you plainly when something is outside what it can do. It works in English and Roman Urdu (Urdu written in English letters).

## Status (honest)

| Feature | Status |
|---|---|
| Cloud brain on AWS (Amazon Bedrock, Claude Haiku 4.5), key-protected, live URL | Working |
| Landing page and `/health` on the live URL | Working |
| Laptop executor: open sites, scroll, send Gmail, send WhatsApp message by partial contact name | Working |
| English, Urdu and Roman Urdu understanding in the brain | Working (typed); voice depends on the browser's recognizer |
| Dark, low-glare interface with editable transcript | Working |
| Edge extension: reads WhatsApp Web messages, sends a message, always-on microphone, speaks back | Working |
| Wake phrase "Hey Access" | Mostly working; can be misheard |
| Command capture after the wake phrase | In progress |
| Open chat, copy, paste, search, calls, fuzzy contact matching, spoken confirmation | Written, being tested |
| Extension connected to the AWS brain, multi-turn conversation | In progress |
| Public demo page on the live URL | Planned |

Hands-free after one-time setup. A helper installs the extension and opens WhatsApp Web once; after that the user speaks.

## How it works

![Architecture](docs/architecture.svg)

The diagram shows the laptop-executor path. The WhatsApp assistant swaps the executor for a browser extension that reads WhatsApp Web's own page content (more reliable than screenshots) and talks to the same AWS brain.

- **Cloud brain (`cloud_brain.py`)**: FastAPI on AWS Elastic Beanstalk. Sends your words to Claude Haiku 4.5 on Amazon Bedrock and returns a plan (and, in the conversational version, what to say back). It never touches a screen.
- **Hands**: either the laptop executor (`local_executor.py`, Windows UI Automation, keyboard and mouse) or the Edge extension (`extension/`). Only the user's own computer can act on the user's own screen, which is why thinking (cloud) and acting (local) are split.
- **Voice page (`app.html`)**: dark interface, editable transcript, language choice, history.

## AWS services

- **Amazon Bedrock**: Claude Haiku 4.5 understands and plans.
- **AWS Elastic Beanstalk**: hosts the brain at the live URL.
- **AWS IAM**: the server uses an instance role for Bedrock; the API is protected by a secret key, and no keys are stored in this repository.
- **Kiro with the Agent Toolkit for AWS**: the coding agent connected to the AWS console, used to build and ship the project.

## How it was built

Built with Kiro as the coding agent, using small single-purpose prompts, and an AI mentor for planning and debugging. Things we learned the hard way:

- A UI Automation click can silently miss. Gmail's real Send button is named `Send (Ctrl-Enter)` with hidden characters, and our first check reported success when it found nothing. We now verify the result.
- WhatsApp Web's search box has an exact accessible name, `Search or start a new chat`. Matching on the word "Search" clicked the Windows taskbar instead.
- Browser speech recognition mishears names and Roman Urdu, so confirmation by voice is part of the design, not an extra.
- We started with screenshots and moved to reading the page's own HTML in the extension, which is far more reliable.
- We locked the public brain behind a secret key after realizing anyone could spend our Bedrock credits.

## Run it yourself

Requirements: Windows, Python 3.11+, Chrome or Edge, and an AWS account with Bedrock access to Claude Haiku 4.5 in us-east-1 (`aws configure`).

```powershell
git clone https://github.com/AreebaGhaffar/accessai-agent
cd accessai-agent
python -m venv .venv
.venv\Scripts\pip install fastapi uvicorn boto3 httpx pyautogui pyperclip pillow pydantic
```

Terminal 1, the brain:

```powershell
.venv\Scripts\python.exe -m uvicorn cloud_brain:app --port 8000
```

Terminal 2, the executor:

```powershell
$env:CLOUD_BRAIN_URL="http://localhost:8000"
.venv\Scripts\python.exe -m uvicorn local_executor:app --host 127.0.0.1 --port 8001
```

Open `http://localhost:8001/` in Chrome. To use a deployed brain that has an API key, set `$env:BRAIN_API_KEY` to the same value as the server's `BRAIN_API_KEY` setting.

WhatsApp extension: open `edge://extensions`, turn on Developer mode, choose **Load unpacked**, select the `extension` folder, then open WhatsApp Web and open a chat.

## Privacy and safety

- The agent asks for a spoken yes before sending messages or calling.
- Audio is processed by the browser's built-in speech service.
- The cloud endpoint requires a secret key. No keys are stored in this repository.
- Use test contacts when trying it. WhatsApp may restrict accounts that automate messaging, and this project is not affiliated with WhatsApp or Meta.

## Roadmap

1. Reliable command capture after the wake phrase, then full multi-turn conversation: clarifying questions, "repeat that", "spell that".
2. Chained sequences: read, copy, forward, search, call.
3. Public demo page on the live URL.
4. Sign-in (Amazon Cognito) so each user has their own access.
5. Stronger speech recognition and a dedicated wake-word engine.
6. A one-click Windows installer, and other apps beyond WhatsApp.

## Team

Mind Flayer. Builder: Areeba Ghaffar.
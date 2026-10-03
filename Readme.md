# AccessAI Agent

**A hands-free voice assistant prototype for people who cannot use a mouse or keyboard.**

Built by Areeba Ghaffar (team Mind Flayer) for the AWS Student Builder *Zero to Shipped* hackathon. Category: Social Good (Health). Lane: Startups.

**Live demo (HTTPS):** https://d2u5z1wgj70hss.cloudfront.net
**Code:** https://github.com/AreebaGhaffar/accessai-agent

> **Status: prototype.** Tested by its builder only, not yet with people with motor disabilities. Not a medical device and not an emergency system. Do not rely on it for urgent help.

## Quick path for judges (2 minutes)

1. Open the live link and scroll to **"Try it: practice WhatsApp"**.
2. Type or say: `Send hello to Maryam`. The assistant repeats the request, asks "Sure?", and only then "sends" it (a simulation, nothing leaves the page).
3. Try Roman Urdu: `Maryam ko bolo main late hoon`.
4. Try something it cannot do. It says so honestly and lists what it can do.
5. The real laptop agent (sending real WhatsApp and Gmail messages, scrolling a site) is shown in the demo video linked from the Builder Center page.

## The problem

Many people with motor disabilities, injuries or conditions that make hands unreliable still need to message family, email, and use everyday apps. Mouse and keyboard are the barrier. Voice assistants exist, but most are built for phones and smart speakers, not for controlling the apps already open on a laptop.

## The idea

You say what you want, in English, Urdu or Roman Urdu. AccessAI works out the steps, repeats the request, asks before it sends or calls anything, and speaks back. It is meant to be hands-free after one-time setup.

**An illustrative day (a scenario, not a case study):** a person who cannot use their hands says "Hi AI, message my caregiver I need water". The assistant answers "Send 'I need water' to Caregiver. Sure?". They say "yes". It sends the message and says "Done." No mouse, no keyboard, and nothing is sent without their spoken yes.

## Why it matters (sources)

- The World Health Organization describes assistive technology as part of health technology that helps people live healthy, independent and dignified lives ([PAHO, 7 Oct 2021](https://www.paho.org/en/news/7-10-2021-global-report-effective-access-assistive-technology-consultation)).
- WHO estimates over 1 billion people need at least one assistive product and only 1 in 10 has access, because of high prices, lack of awareness and a shortage of trained staff ([WHO, 23 Aug 2019](https://www.who.int/news/item/23-08-2019-who-convenes-global-stakeholders-to-improve-access-to-assistive-technology)).
- AccessAI aims to be low-cost assistive software: an ordinary laptop plus pay-per-use cloud, with no special hardware.

We make no clinical or health-outcome claims.

## What works today

| Part | Status |
|---|---|
| Cloud brain on AWS: turns a spoken or typed request into steps (English, Urdu, Roman Urdu) | Working, live |
| Public practice demo (`/demo`): simulated WhatsApp chat, spoken replies, confirm before send | Working, live |
| Laptop agent: open a website and scroll | Verified by the builder |
| Laptop agent: compose a Gmail message and press Send | Verified by the builder |
| Laptop agent: send a WhatsApp message to a contact found by partial name | Verified by the builder |
| API key lock on the planning endpoint (401 without the key) | Verified |
| WhatsApp Web voice extension: wake phrase, conversation mode, spoken yes/no confirmation | **Early prototype, not reliable.** Browser speech recognition mishears names and commands, and restarts can drop the microphone |
| Open chat, copy and paste between chats, search, calls by voice in real WhatsApp | Written, not yet reliable |

Not done yet: measured results with real users, connecting the extension to the cloud brain, multi-turn conversation with the cloud brain.

## Architecture

```
You speak or type
      |
      v
Laptop agent (local_executor.py, FastAPI, 127.0.0.1:8001)
      |  POST /plan  (X-API-Key)
      v
CloudFront (HTTPS) -> Elastic Beanstalk (cloud_brain.py, FastAPI)
      |
      v
Amazon Bedrock (Claude Haiku 4.5) -> a list of steps
      |
      v
Laptop agent runs the steps (pyautogui, Windows UI Automation, pyperclip)
```

- `cloud_brain.py`: `GET /` landing page and practice demo, `GET /health`, `POST /plan` (needs `X-API-Key`), `POST /demo` (public, plan-only).
- `local_executor.py`: runs on the user's laptop and serves `app.html` at http://localhost:8001/ (transcript editor, steps panel, history, language selector).
- `extension/`: Edge/Chrome extension for WhatsApp Web (prototype). It reads the page HTML, listens for a wake phrase, and speaks back.

**AWS services:** Elastic Beanstalk (hosting), Amazon Bedrock with Claude Haiku 4.5 (understanding), CloudFront (HTTPS in front of the app), IAM (instance role for Bedrock access).

## Safety and cost protection

- Nothing is sent or called without a spoken or clicked yes.
- The real planning endpoint needs a private API key. The key is never stored in the repo.
- The public demo only plans. It never executes anything and never touches anyone's computer.
- The public demo is rate limited (10 requests per minute per IP, 300 per day) and caps the model output, so strangers cannot run up the AWS bill.
- WhatsApp may restrict accounts that automate, so testing uses test contacts.

## How the coding agent helped

I built it with **Kiro**, connected to my AWS console through the Agent Toolkit for AWS. Kiro wrote and fixed the FastAPI service, the Windows automation agent, the web UI and the browser extension, and helped with the Elastic Beanstalk deployment. When my Kiro credits ran out near the deadline, I used Claude chats to plan the work, debug the speech loop and write the final demo page.

## What I learned

- Browser speech recognition and speech synthesis share the microphone and hear each other. Restarting recognition at the wrong moment drops it, so the voice loop needs one continuous session and a watchdog.
- Reading the page structure is more reliable than screenshots for WhatsApp Web.
- Spoken confirmation is the safety net when recognition mishears a name.
- Honest labels matter for assistive tools: claiming too much about people with disabilities is a big responsibility.

## Run it yourself

You need Python 3.12, an AWS account with Amazon Bedrock access to Claude Haiku 4.5, and AWS credentials from `aws configure`. Never commit keys.

```powershell
python -m pip install fastapi uvicorn boto3
python -m uvicorn cloud_brain:app --port 8002
# open http://127.0.0.1:8002/
```

For the laptop agent, set `CLOUD_BRAIN_URL` to your brain and `BRAIN_API_KEY` to your own key as environment variables, then run `python -m uvicorn local_executor:app --host 127.0.0.1 --port 8001`. Use Chrome for voice input.

## How impact will be measured (planned, no results yet)

Log every command (time to finish, success or failure, whether any mouse or keyboard was needed), run a documented session of about 30 commands, and report success rate, median time per task and cost per 100 commands. Any simulated trial will be labeled as simulated. If a person with a motor disability tests it, it will be with consent and their feedback will be reported honestly. A "Measured results" section will be added only when real numbers exist.

## Honest limits

- Speech recognition is not accurate enough yet for everyone. Names and Roman Urdu are often misheard.
- Windows only for the laptop agent.
- Single builder, tested only by me so far.
- No measured results yet.

## Roadmap

1. Make the WhatsApp voice extension reliable, then connect it to the cloud brain with spoken clarifying questions ("Which Maryam?").
2. Quick contact roles such as "message my caregiver", with a clear statement that it is not an emergency system.
3. Test with people who have motor disabilities, with their consent, and publish measured results.
4. Move from browser speech recognition to a streaming speech service for a more natural conversation.
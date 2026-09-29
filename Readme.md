# 🎙️ AccessAI Agent

**One voice. Full control. For everyone.**

AccessAI Agent is a voice-controlled AI assistant that lets people with motor disabilities — and anyone who wants hands-free computer use — operate their entire laptop using natural language. Speak a command, and an AI agent understands your intent, plans the steps, and executes them for you: opening apps, browsing the web, typing messages, and more.

> 🔗 **Live Demo:** [Add your Elastic Beanstalk URL here once deployed]
> 🎥 **Demo Video:** [Add your video link here]

---

## 💡 Problem

Over 1 billion people worldwide live with disabilities affecting their ability to use a standard mouse and keyboard. Most assistive tools are rigid, expensive, and only respond to fixed commands — they can't understand what a person actually *means*.

## ✅ Solution

AccessAI Agent uses **Amazon Bedrock (Claude Haiku 4.5)** to understand natural spoken commands like *"open Gmail and send an email saying hi"* — reasoning out the correct sequence of steps dynamically, for **any** app or website, not just a hardcoded list. It then executes those steps directly on the computer using keyboard/mouse automation.

## 🏗️ Architecture
Voice Input (Web Speech API)
↓
Frontend (HTML/JS) — click-to-record, live transcript, session history
↓ HTTP POST
FastAPI Backend
↓
Amazon Bedrock (Claude Haiku 4.5, cross-region inference profile)
↓ returns structured multi-step JSON plan
Action Executor (PyAutoGUI, clipboard automation, browser control)
↓
Real actions on the user's computer

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Voice Input | Web Speech API |
| Frontend | HTML / CSS / JavaScript |
| Backend | FastAPI (Python) |
| AI Model | Amazon Bedrock — Claude Haiku 4.5 |
| Action Execution | PyAutoGUI, clipboard automation |
| Coding Agent | Kiro, connected to AWS via Agent Toolkit |
| Deployment | AWS Elastic Beanstalk |

## 🎯 Example Commands

- "Open Gmail and send an email to alice@example.com saying hi"
- "Open Instagram and scroll down"
- "Open my browser and go to Netflix"
- "Scroll down slowly"

## 🚀 How to Run Locally

```bash
git clone https://github.com/AreebaGhaffar/accessai-agent.git
cd accessai-agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
.\run_backend.ps1
```
Then open `voice_test.html` in your browser.

## ☁️ AWS Deployment

The backend is deployed on **AWS Elastic Beanstalk**, calling **Amazon Bedrock** for AI reasoning. [Add a sentence here once deployed about your specific setup.]

## 🗺️ Future Roadmap

- Text-to-speech feedback for fully screen-free operation
- Broader desktop app support beyond browser-based tasks
- Persistent session history across restarts
- Expanded accessibility testing with real users with motor disabilities

## 🏆 Hackathon

Built for **AWS Zero to Shipped** — Category: Social Good (Health) — Lane: [Startup/Community]

## 👤 Team

Areeba Ghaffar — Team Mind Flayer
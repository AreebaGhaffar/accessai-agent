// AccessAI content script — WhatsApp Web (Manifest V3)

// ── Badge ────────────────────────────────────────────────────────────────────
const badge = document.createElement('div');
badge.style.cssText =
  'position:fixed;bottom:10px;right:10px;z-index:99999;' +
  'background:#128C7E;color:#fff;padding:8px 14px;' +
  'border-radius:20px;font:14px sans-serif;cursor:pointer;' +
  'user-select:none;';
document.body.appendChild(badge);

function setBadge(text) {
  badge.textContent = text;
}
setBadge('Click to start');

// ── readMessages(n) ──────────────────────────────────────────────────────────
// Returns the last n text strings from visible message spans.
function readMessages(n) {
  const spans = [...document.querySelectorAll('span.selectable-text')];
  return spans.slice(-n).map(el => el.innerText);
}

// ── sendMessage(text) ────────────────────────────────────────────────────────
// Focuses the compose box, inserts text, waits 500 ms, then clicks Send.
// Returns a Promise that resolves to 'sent' or an error string.
function sendMessage(text) {
  return new Promise(resolve => {
    const composeBox = document.querySelector('footer div[contenteditable="true"]');
    if (!composeBox) {
      resolve('compose box not found');
      return;
    }

    composeBox.focus();
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      composeBox.textContent = text;
      composeBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    setTimeout(() => {
      let sendBtn = document.querySelector('button[aria-label="Send"]');
      if (!sendBtn) {
        const sendIcon = document.querySelector('span[data-icon="send"]');
        if (sendIcon) sendBtn = sendIcon.closest('button');
      }
      if (!sendBtn) {
        resolve('send button not found');
        return;
      }
      sendBtn.click();
      resolve('sent');
    }, 500);
  });
}

// ── Message listener ─────────────────────────────────────────────────────────
window.addEventListener('message', async event => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== 'ACCESSAI') return;

  let result;
  switch (data.action) {
    case 'read_last':
      result = readMessages(1);
      break;
    case 'read_recent':
      result = readMessages(3);
      break;
    case 'send':
      result = data.text ? await sendMessage(data.text) : 'no text provided';
      break;
    default:
      result = `unknown action: ${data.action}`;
  }
  console.log('AccessAI result:', result);
});

// ── Voice module ─────────────────────────────────────────────────────────────
(function initVoice() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('AccessAI: SpeechRecognition not available in this browser.');
    setBadge('AccessAI (no mic API)');
    return;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  // Modes: 'idle' | 'wake' | 'command' | 'speaking'
  let mode       = 'idle';
  let isRunning  = false;   // true between onstart and onend (authoritative)
  let isSpeaking = false;   // true while TTS is active
  let hasStarted = false;   // true once the user clicked the badge
  let commandTimer = null;  // 10-second no-command timeout

  // ── Single recognition instance ────────────────────────────────────────────
  const recog = new SpeechRecognition();
  recog.continuous      = true;
  recog.interimResults  = false;
  recog.lang            = 'en-US';

  // ── startRecognition / stopRecognition ──────────────────────────────────────
  function startRecognition() {
    if (isRunning || isSpeaking) return;
    try {
      recog.start();
      // isRunning is set to true in onstart, not here, to stay in sync
    } catch (e) {
      // InvalidStateError = already started; ignore silently
      if (!e.message.includes('already started')) {
        console.warn('AccessAI: recognition start error', e.message);
      }
    }
  }

  function stopRecognition() {
    if (!isRunning) return;
    try { recog.stop(); } catch (_) {}
    // isRunning is set to false in onend
  }

  // ── Wake-phrase detection ───────────────────────────────────────────────────
  const WAKE_REGEX =
    /\b(hey|he|hi|hay|a|okay|ok)\s+(access|acces|axis|excess|assess|accessai|access\s+ai|access\s+a\s+i)\b(.*)/;

  function normalizeTranscript(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')  // remove punctuation
      .replace(/\s+/g, ' ')     // collapse spaces
      .trim();
  }

  /**
   * @returns {{ matched: boolean, tail: string }}
   *   tail = trimmed text after the wake phrase, empty if none.
   */
  function matchWakePhrase(normalized) {
    const m = WAKE_REGEX.exec(normalized);
    if (!m) return { matched: false, tail: '' };
    return { matched: true, tail: m[3].trim() };
  }

  // ── Command timeout (10 s) ──────────────────────────────────────────────────
  function clearCommandTimer() {
    if (commandTimer) { clearTimeout(commandTimer); commandTimer = null; }
  }

  function startCommandTimer() {
    clearCommandTimer();
    commandTimer = setTimeout(() => {
      console.log('AccessAI: command timeout');
      speak("I didn't hear anything", () => {
        enterWakeMode();
        startRecognition();
      });
    }, 10000);
  }

  // ── Mode transitions ────────────────────────────────────────────────────────
  function enterWakeMode() {
    clearCommandTimer();
    mode = 'wake';
    setBadge('Listening for Hey Access');
    console.log('AccessAI: entering wake mode');
  }

  function enterCommandMode() {
    mode = 'command';
    setBadge('Listening for your command');
    console.log('AccessAI: entering command mode');
    startCommandTimer();
  }

  // ── Speech synthesis ────────────────────────────────────────────────────────
  function speak(text, onDone) {
    window.speechSynthesis.cancel();

    isSpeaking = true;
    mode = 'speaking';
    setBadge('Speaking');
    stopRecognition();
    console.log('AccessAI: speaking →', text);

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';

    const finish = () => {
      isSpeaking = false;
      console.log('AccessAI: speech ended');
      if (typeof onDone === 'function') onDone();
    };

    utter.onend   = finish;
    utter.onerror = (e) => {
      console.warn('AccessAI: speech error', e.error);
      finish();
    };

    window.speechSynthesis.speak(utter);
  }

  // ── Command handler ─────────────────────────────────────────────────────────
  function handleCommand(cmd) {
    clearCommandTimer();
    setBadge(`"${cmd}"`);
    console.log('AccessAI command captured:', cmd);
    speak(`I heard: ${cmd}`, () => {
      // After speaking: switch to wake mode AND restart recognition
      enterWakeMode();
      startRecognition();
    });
  }

  // ── Transcript handler ──────────────────────────────────────────────────────
  recog.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (!event.results[i].isFinal) continue;

      const transcript = event.results[i][0].transcript.trim();
      if (!transcript) continue;

      if (mode === 'wake') {
        const normalized = normalizeTranscript(transcript);
        const { matched, tail } = matchWakePhrase(normalized);
        if (!matched) continue; // privacy: no log for non-wake speech

        console.log('AccessAI: wake phrase detected');

        const wordCount = tail.split(/\s+/).filter(Boolean).length;
        if (wordCount >= 2) {
          handleCommand(tail);           // same-breath command
        } else {
          enterCommandMode();            // wait for next utterance
        }

      } else if (mode === 'command') {
        handleCommand(transcript);
      }
      // 'speaking' / 'idle': ignore
    }
  };

  // ── Recognition lifecycle ───────────────────────────────────────────────────
  recog.onstart = () => {
    isRunning = true;
    console.log('AccessAI: recognition started');
  };

  recog.onend = () => {
    isRunning = false;
    console.log('AccessAI: recognition ended (mode=' + mode + ')');

    if (isSpeaking || mode === 'idle') return; // TTS will restart; not yet started

    if (mode === 'command') {
      // Restart quickly so the command utterance isn't missed;
      // keep the existing 10-second timer running
      setTimeout(startRecognition, 100);
    } else {
      // wake / speaking-cleanup: standard 500 ms restart
      setTimeout(startRecognition, 500);
    }
  };

  recog.onerror = (event) => {
    // isRunning will be set false by the onend that always follows onerror
    console.warn('AccessAI: recognition error', event.error);
    // No manual restart here — onend fires next and handles it
  };

  // ── Watchdog: every 3 s, ensure recognition is running ─────────────────────
  setInterval(() => {
    if (!hasStarted || isSpeaking || isRunning || mode === 'idle') return;
    console.log('AccessAI: watchdog restarted recognition');
    startRecognition();
  }, 3000);

  // ── One-time start click ────────────────────────────────────────────────────
  badge.addEventListener('click', () => {
    if (mode !== 'idle') return; // already running — ignore further clicks
    hasStarted = true;
    enterWakeMode();
    startRecognition();
  });
})();

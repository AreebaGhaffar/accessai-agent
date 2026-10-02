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

// ── WhatsApp UI helpers ───────────────────────────────────────────────────────

/** Resolves after `ms` milliseconds. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Insert text into a contenteditable element using execCommand, with an
 * input-event fallback so React/Vue controlled inputs pick up the change.
 */
function insertIntoEditable(el, text) {
  el.focus();
  // Select-all + insertText replaces any existing value cleanly
  document.execCommand('selectAll', false, null);
  const ok = document.execCommand('insertText', false, text);
  if (!ok) {
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Clear a contenteditable element. */
function clearEditable(el) {
  el.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Module-level clipboard for copy_last / paste
let clipboardMemory = null;

// ── open_chat(name) ───────────────────────────────────────────────────────────
async function openChat(name) {
  // 1. Find the chat-list search box
  let searchBox =
    document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
    document.querySelector('#side div[contenteditable="true"]');
  if (!searchBox) return 'search box not found';

  // 2. Clear and type the contact name
  clearEditable(searchBox);
  await sleep(300);
  insertIntoEditable(searchBox, name);

  // 3. Wait for results to populate
  await sleep(1200);

  // 4. Click the first result row
  const result =
    document.querySelector('#pane-side div[role="listitem"]') ||
    document.querySelector('#pane-side div[role="row"]');
  if (!result) {
    // Clean up search before returning
    clearEditable(searchBox);
    return 'contact not found';
  }
  result.click();
  await sleep(500);

  // 5. Clear the search box so the full list is restored
  // Re-query in case focus moved
  const sb =
    document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
    document.querySelector('#side div[contenteditable="true"]');
  if (sb) clearEditable(sb);

  // 6. Read the chat header title
  const header =
    document.querySelector('header [data-testid="conversation-info-header-chat-title"]') ||
    document.querySelector('header span[title]') ||
    document.querySelector('#main header span[dir="auto"]');
  const title = header ? (header.title || header.textContent).trim() : name;
  return `opened ${title}`;
}

// ── copy_last() ───────────────────────────────────────────────────────────────
function copyLast() {
  const spans = [...document.querySelectorAll('span.selectable-text')];
  if (!spans.length) return 'no messages found';
  clipboardMemory = spans[spans.length - 1].innerText;
  return clipboardMemory;
}

// ── paste() ───────────────────────────────────────────────────────────────────
function pasteMemory() {
  if (!clipboardMemory) return 'nothing copied';
  const composeBox = document.querySelector('footer div[contenteditable="true"]');
  if (!composeBox) return 'compose box not found';
  composeBox.focus();
  document.execCommand('insertText', false, clipboardMemory);
  return 'pasted';
}

// ── search_in_chat(text) ──────────────────────────────────────────────────────
async function searchInChat(text) {
  // Click the search icon in the chat header
  let searchBtn =
    document.querySelector('header button[aria-label*="Search" i]') ||
    document.querySelector('header span[data-icon="search"]')?.closest('button');
  if (!searchBtn) return 'search button not found';
  searchBtn.click();
  await sleep(500);

  // Type into the search input that appears
  const searchInput =
    document.querySelector('div[data-tab="search"] div[contenteditable="true"]') ||
    document.querySelector('#main div[contenteditable="true"][role="textbox"]');
  if (!searchInput) return 'search input not found';
  insertIntoEditable(searchInput, text);
  await sleep(300);
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return 'searching';
}

// ── close_chat() ──────────────────────────────────────────────────────────────
function closeChat() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return 'closed';
}

// ── voice_call() / video_call() ───────────────────────────────────────────────
async function startCall(type) {
  // type: 'voice' | 'video'
  const ariaFragment = type === 'voice' ? 'voice call' : 'video call';
  const iconName     = type === 'voice' ? 'audio-call'  : 'video-call';

  let btn =
    [...document.querySelectorAll('header button')]
      .find(b => b.getAttribute('aria-label')?.toLowerCase().includes(ariaFragment)) ||
    document.querySelector(`header span[data-icon="${iconName}"]`)?.closest('button');

  if (!btn) return 'call button not found';
  btn.click();
  return 'calling';
}

// ── runSequence(steps) ────────────────────────────────────────────────────────
/**
 * Runs an array of { action, ...params } objects one by one.
 * Stops on the first result string that contains "not found".
 * Returns an array of result values.
 */
async function runSequence(steps) {
  const results = [];
  for (const step of steps) {
    const result = await dispatchAction(step);
    results.push(result);
    if (typeof result === 'string' && result.includes('not found')) break;
  }
  return results;
}

// ── dispatchAction({ action, ...params }) ─────────────────────────────────────
// Shared dispatch used by both the message listener and runSequence.
async function dispatchAction(data) {
  switch (data.action) {
    case 'read_last':    return readMessages(1);
    case 'read_recent':  return readMessages(3);
    case 'send':         return data.text ? sendMessage(data.text) : 'no text provided';
    case 'open_chat':    return data.name ? openChat(data.name)    : 'name required';
    case 'copy_last':    return copyLast();
    case 'paste':        return pasteMemory();
    case 'search_in_chat': return data.text ? searchInChat(data.text) : 'text required';
    case 'close_chat':   return closeChat();
    case 'voice_call':   return startCall('voice');
    case 'video_call':   return startCall('video');
    case 'run_sequence': return Array.isArray(data.steps)
                           ? runSequence(data.steps)
                           : 'steps must be an array';
    default:             return `unknown action: ${data.action}`;
  }
}

// ── Message listener ─────────────────────────────────────────────────────────
window.addEventListener('message', async event => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== 'ACCESSAI') return;

  const result = await dispatchAction(data);
  console.log('AccessAI result:', result);
});

// ══════════════════════════════════════════════════════════════════════════════
// ── Voice Command Router ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── Text normalization (shared) ───────────────────────────────────────────────
function normalizeText(text) {
  return text
    .toLowerCase()
    // strip emoji (basic Unicode ranges)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\w\s]/g, '')   // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Levenshtein distance ──────────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Token-level similarity: for each token in spokenTokens, find the closest
 * token in titleTokens and average the similarities.
 * Returns 0-1 (1 = perfect match).
 */
function tokenSimilarity(spoken, title) {
  const sTokens = spoken.split(' ').filter(Boolean);
  const tTokens = title.split(' ').filter(Boolean);
  if (!sTokens.length || !tTokens.length) return 0;
  let total = 0;
  for (const st of sTokens) {
    let best = 0;
    for (const tt of tTokens) {
      const maxLen = Math.max(st.length, tt.length);
      if (maxLen === 0) { best = 1; continue; }
      const sim = 1 - levenshtein(st, tt) / maxLen;
      if (sim > best) best = sim;
    }
    total += best;
  }
  return total / sTokens.length;
}

/**
 * Score a normalized title against a normalized spoken name.
 * Returns 0-1.
 */
function scoreTitle(spoken, title) {
  if (spoken === title)           return 1.0;
  if (title.startsWith(spoken))  return 0.95;
  if (title.includes(spoken))    return 0.90;
  if (spoken.includes(title))    return 0.85;
  return tokenSimilarity(spoken, title);
}

/** Collect visible chat rows from #pane-side. */
function collectChatRows() {
  const rows = [
    ...document.querySelectorAll('#pane-side div[role="listitem"]'),
    ...document.querySelectorAll('#pane-side div[role="row"]'),
  ];
  // deduplicate by element reference
  return [...new Set(rows)];
}

/** Extract a display title from a row element. */
function rowTitle(row) {
  const el =
    row.querySelector('span[title]') ||
    row.querySelector('span[dir="auto"]') ||
    row.querySelector('[data-testid="cell-frame-title"]');
  return el ? (el.title || el.textContent || '').trim() : '';
}

/**
 * findBestChat(spokenName) — fuzzy-match a spoken contact name against the
 * visible chat list, with a search-box fallback.
 *
 * Returns { title, row } or null.
 */
async function findBestChat(spokenName) {
  const THRESHOLD = 0.55;

  // Special self-reference
  const selfAliases = ['me', 'myself', 'my number'];
  if (selfAliases.includes(spokenName.trim().toLowerCase())) {
    const rows = collectChatRows();
    for (const row of rows) {
      if (rowTitle(row).includes('(You)')) return { title: rowTitle(row), row };
    }
  }

  const normalSpoken = normalizeText(spokenName);

  function bestAmong(rows) {
    let best = null, bestScore = 0;
    for (const row of rows) {
      const t = rowTitle(row);
      if (!t) continue;
      const score = scoreTitle(normalSpoken, normalizeText(t));
      if (score > bestScore) { bestScore = score; best = { title: t, row }; }
    }
    return bestScore >= THRESHOLD ? best : null;
  }

  // First pass: visible list
  const firstPass = bestAmong(collectChatRows());
  if (firstPass) return firstPass;

  // Second pass: search box fallback
  const searchBox =
    document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
    document.querySelector('#side div[contenteditable="true"]');
  if (!searchBox) return null;

  clearEditable(searchBox);
  await sleep(300);
  insertIntoEditable(searchBox, spokenName);
  await sleep(1200);

  const secondPass = bestAmong(collectChatRows());

  // Always clear search
  clearEditable(searchBox);
  await sleep(300);

  return secondPass;
}

// ── Command parser ────────────────────────────────────────────────────────────
const COMMAND_VERBS = /^(send|message|tell|open|go|read|copy|paste|search|call|voice|video|close)/;

/**
 * Split on " and then ", " then ", " and " — but only where what follows
 * starts with a known command verb.
 */
function splitSequence(text) {
  const SPLITTERS = [' and then ', ' then ', ' and '];
  for (const sep of SPLITTERS) {
    const idx = text.indexOf(sep);
    if (idx === -1) continue;
    const after = text.slice(idx + sep.length).trim();
    if (COMMAND_VERBS.test(after)) {
      return [text.slice(0, idx).trim(), ...splitSequence(after)];
    }
  }
  return [text];
}

/**
 * parseCommand(text) — regex-based command parser.
 *
 * Returns one of:
 *  { type: 'send',        message, name }
 *  { type: 'open',        name }
 *  { type: 'read_last' }
 *  { type: 'copy_last' }
 *  { type: 'paste' }
 *  { type: 'search',      query }
 *  { type: 'close' }
 *  { type: 'call',        name, callType: 'voice'|'video' }
 *  { type: 'send_it_to',  name }
 *  { type: 'sequence',    steps: [...parsed commands] }
 *  null  — not understood
 */
function parseCommand(raw) {
  const text = normalizeText(raw);
  console.log('AccessAI parsed: normalizing "' + raw + '" → "' + text + '"');

  // ── Sequence splitting ────────────────────────────────────────────────────
  const parts = splitSequence(text);
  if (parts.length > 1) {
    const steps = parts.map(parseCommand).filter(Boolean);
    if (steps.length > 1) {
      const parsed = { type: 'sequence', steps };
      console.log('AccessAI parsed:', parsed);
      return parsed;
    }
  }

  let m;

  // ── send it to <name> ─────────────────────────────────────────────────────
  m = text.match(/^send it to (.+)$/);
  if (m) { const p = { type: 'send_it_to', name: m[1].trim() }; console.log('AccessAI parsed:', p); return p; }

  // ── send <msg> to <name>  /  tell <name> <msg>  /  message <name> <msg> ──
  // "send X to Y" — split on LAST " to "
  m = text.match(/^send (.+)$/);
  if (m) {
    const body = m[1];
    const lastTo = body.lastIndexOf(' to ');
    if (lastTo !== -1) {
      const p = { type: 'send', message: body.slice(0, lastTo).trim(), name: body.slice(lastTo + 4).trim() };
      console.log('AccessAI parsed:', p); return p;
    }
  }
  m = text.match(/^(?:tell|message) (\S+(?:\s+\S+)??) (.+)$/);
  if (m) { const p = { type: 'send', name: m[1].trim(), message: m[2].trim() }; console.log('AccessAI parsed:', p); return p; }

  // ── open <name>  /  go to <name>  /  open chat with <name> ───────────────
  m = text.match(/^(?:open chat with|open chat for|open|go to) (.+)$/);
  if (m) { const p = { type: 'open', name: m[1].trim() }; console.log('AccessAI parsed:', p); return p; }

  // ── read last message ─────────────────────────────────────────────────────
  if (/read (?:my |the )?last message/.test(text)) {
    const p = { type: 'read_last' }; console.log('AccessAI parsed:', p); return p;
  }

  // ── copy last message / copy it ───────────────────────────────────────────
  if (/copy (?:the |my |last )?(?:last )?message|copy it/.test(text)) {
    const p = { type: 'copy_last' }; console.log('AccessAI parsed:', p); return p;
  }

  // ── paste / paste it ──────────────────────────────────────────────────────
  if (/^paste(?: it)?$/.test(text)) {
    const p = { type: 'paste' }; console.log('AccessAI parsed:', p); return p;
  }

  // ── search for <text> / search <text> ────────────────────────────────────
  m = text.match(/^search(?: for)? (.+)$/);
  if (m) { const p = { type: 'search', query: m[1].trim() }; console.log('AccessAI parsed:', p); return p; }

  // ── close / go back ──────────────────────────────────────────────────────
  if (/^(?:close(?: chat)?|go back)$/.test(text)) {
    const p = { type: 'close' }; console.log('AccessAI parsed:', p); return p;
  }

  // ── video call <name> ─────────────────────────────────────────────────────
  m = text.match(/^video call (.+)$/);
  if (m) { const p = { type: 'call', name: m[1].trim(), callType: 'video' }; console.log('AccessAI parsed:', p); return p; }

  // ── voice call <name> / call <name> ──────────────────────────────────────
  m = text.match(/^(?:voice call|call) (.+)$/);
  if (m) { const p = { type: 'call', name: m[1].trim(), callType: 'voice' }; console.log('AccessAI parsed:', p); return p; }

  console.log('AccessAI parsed: null (unrecognized)');
  return null;
}

// ── Confirmation helpers (set by initVoice after speak is available) ──────────
// These are populated by initVoice so the router can call speak() and
// listen for a confirmation utterance without duplicating TTS logic.
let _voiceSpeakFn       = null;  // (text, onDone) => void
let _voiceListenOnceFn  = null;  // (timeoutMs) => Promise<string|null>

/**
 * Speak via TTS (delegates to the voice module's speak()).
 * Safe to call even before initVoice runs (no-ops then).
 */
function voiceSpeak(text) {
  return new Promise(resolve => {
    if (!_voiceSpeakFn) { resolve(); return; }
    _voiceSpeakFn(text, resolve);
  });
}

/**
 * Wait for one more final transcript within timeoutMs.
 * Returns the transcript string, or null on timeout.
 */
function voiceListenOnce(timeoutMs) {
  if (!_voiceListenOnceFn) return Promise.resolve(null);
  return _voiceListenOnceFn(timeoutMs);
}

// ── Confirmation flow ─────────────────────────────────────────────────────────
const CONFIRM_YES = /\b(yes|yeah|yep|confirm|send it|do it|haan)\b/i;
const CONFIRM_NO  = /\b(no|cancel|stop|nahi)\b/i;

/**
 * Ask a yes/no question via TTS, then listen 8 s.
 * Returns true (confirmed) or false (cancelled / timeout).
 */
async function askConfirmation(prompt) {
  await voiceSpeak(prompt);
  const answer = await voiceListenOnce(8000);
  if (!answer) {
    await voiceSpeak('Cancelled');
    return false;
  }
  if (CONFIRM_YES.test(answer)) return true;
  if (CONFIRM_NO.test(answer))  { await voiceSpeak('Cancelled'); return false; }
  await voiceSpeak('Cancelled');
  return false;
}

// ── executeVoiceCommand ───────────────────────────────────────────────────────
/**
 * Main entry point called by handleCommand inside initVoice.
 * Parses, confirms if needed, executes, speaks feedback.
 * Always resolves (never throws).
 */
async function executeVoiceCommand(rawText) {
  const parsed = parseCommand(rawText);

  if (!parsed) {
    await voiceSpeak("Sorry, I didn't understand. Try again");
    return;
  }

  // ── Sequence ────────────────────────────────────────────────────────────
  if (parsed.type === 'sequence') {
    for (const step of parsed.steps) {
      await executeVoiceCommand(_commandToRaw(step));
    }
    return;
  }

  // ── Dispatch ────────────────────────────────────────────────────────────
  await _runParsedCommand(parsed);
}

/** Re-serialise a parsed command back to a string for recursive sequence use. */
function _commandToRaw(parsed) {
  switch (parsed.type) {
    case 'send':       return `send ${parsed.message} to ${parsed.name}`;
    case 'send_it_to': return `send it to ${parsed.name}`;
    case 'open':       return `open ${parsed.name}`;
    case 'read_last':  return 'read last message';
    case 'copy_last':  return 'copy last message';
    case 'paste':      return 'paste';
    case 'search':     return `search ${parsed.query}`;
    case 'close':      return 'close';
    case 'call':       return `${parsed.callType} call ${parsed.name}`;
    default:           return '';
  }
}

/** Execute a single (non-sequence) parsed command with confirmation where needed. */
async function _runParsedCommand(parsed) {
  switch (parsed.type) {

    // ── open ───────────────────────────────────────────────────────────────
    case 'open': {
      await voiceSpeak(`Looking for ${parsed.name}`);
      const found = await findBestChat(parsed.name);
      if (!found) { await voiceSpeak("I couldn't find that contact"); return; }
      found.row.click();
      await sleep(500);
      await voiceSpeak(`Opening ${found.title}`);
      return;
    }

    // ── read_last ──────────────────────────────────────────────────────────
    case 'read_last': {
      const msgs = readMessages(1);
      const text = msgs[0] || 'no messages found';
      await voiceSpeak(text);
      return;
    }

    // ── copy_last ──────────────────────────────────────────────────────────
    case 'copy_last': {
      const result = copyLast();
      await voiceSpeak(result === 'no messages found' ? 'No messages found' : 'Copied');
      return;
    }

    // ── paste ──────────────────────────────────────────────────────────────
    case 'paste': {
      const result = pasteMemory();
      await voiceSpeak(result === 'nothing copied' ? 'Nothing to paste' : 'Pasted');
      return;
    }

    // ── search ─────────────────────────────────────────────────────────────
    case 'search': {
      await searchInChat(parsed.query);
      await voiceSpeak(`Searching for ${parsed.query}`);
      return;
    }

    // ── close ──────────────────────────────────────────────────────────────
    case 'close': {
      closeChat();
      await voiceSpeak('Closed');
      return;
    }

    // ── send ───────────────────────────────────────────────────────────────
    case 'send': {
      // Open the chat first
      await voiceSpeak(`Looking for ${parsed.name}`);
      const found = await findBestChat(parsed.name);
      if (!found) { await voiceSpeak("I couldn't find that contact"); return; }
      found.row.click();
      await sleep(600);

      const confirmed = await askConfirmation(
        `Send "${parsed.message}" to ${found.title}. Say yes to confirm.`
      );
      if (!confirmed) return;

      const r = await sendMessage(parsed.message);
      await voiceSpeak(r === 'sent' ? 'Sent' : `Error: ${r}`);
      return;
    }

    // ── send_it_to ─────────────────────────────────────────────────────────
    case 'send_it_to': {
      if (!clipboardMemory) { await voiceSpeak('Nothing copied to send'); return; }

      await voiceSpeak(`Looking for ${parsed.name}`);
      const found = await findBestChat(parsed.name);
      if (!found) { await voiceSpeak("I couldn't find that contact"); return; }
      found.row.click();
      await sleep(600);

      const confirmed = await askConfirmation(
        `Send "${clipboardMemory}" to ${found.title}. Say yes to confirm.`
      );
      if (!confirmed) return;

      pasteMemory();
      await sleep(300);
      const r = await sendMessage(clipboardMemory);
      await voiceSpeak(r === 'sent' ? 'Sent' : `Error: ${r}`);
      return;
    }

    // ── call ───────────────────────────────────────────────────────────────
    case 'call': {
      await voiceSpeak(`Looking for ${parsed.name}`);
      const found = await findBestChat(parsed.name);
      if (!found) { await voiceSpeak("I couldn't find that contact"); return; }
      found.row.click();
      await sleep(600);

      const label = parsed.callType === 'video' ? 'Video call' : 'Call';
      const confirmed = await askConfirmation(
        `${label} ${found.title}. Say yes to confirm.`
      );
      if (!confirmed) return;

      const r = await startCall(parsed.callType);
      await voiceSpeak(r === 'calling' ? 'Calling' : `Error: ${r}`);
      return;
    }

    default:
      await voiceSpeak("Sorry, I didn't understand. Try again");
  }
}

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

  // ── Command handler — delegates to the voice command router ─────────────────
  function handleCommand(cmd) {
    clearCommandTimer();
    setBadge(`"${cmd}"`);
    console.log('AccessAI command captured:', cmd);

    // Wire the router's speak/listen hooks to this closure's speak()
    _voiceSpeakFn = speak;
    _voiceListenOnceFn = (timeoutMs) => new Promise(resolve => {
      // Temporarily enter a special 'confirm' sub-mode:
      // re-use command mode's listener but resolve on the first transcript.
      mode = 'command';
      setBadge('Say yes or no');
      let settled = false;

      // Ensure recognition is running so we can hear the answer.
      // speak() will have stopped it; restart it now.
      startRecognition();

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);

      // Monkey-patch onresult just for this one utterance
      const prevOnResult = recog.onresult;
      recog.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (!event.results[i].isFinal) continue;
          const t = event.results[i][0].transcript.trim();
          if (!t) continue;
          if (settled) continue;
          settled = true;
          clearTimeout(timer);
          recog.onresult = prevOnResult;
          resolve(t);
          return;
        }
      };
    });

    // Run the router; when done return to wake mode and restart recognition
    executeVoiceCommand(cmd).then(() => {
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

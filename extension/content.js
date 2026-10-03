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
// Waits for the chat panel (#main + header matching contactName), then finds
// the compose box, inserts text, and sends.
// contactName is optional; when supplied the header check is skipped if absent.
// Returns a Promise that resolves to 'sent' or an error string.
async function sendMessage(text, contactName) {
  // ── 1. Wait up to 5 s for #main to appear with the right chat open ────────
  const firstWord = contactName
    ? contactName.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
                 .split(/\s+/)[0].toLowerCase().trim()
    : null;

  let chatReady = false;
  const chatDeadline = Date.now() + 5000;
  while (Date.now() < chatDeadline) {
    const main = document.querySelector('#main');
    if (main) {
      if (!firstWord) { chatReady = true; break; }
      // Check that the chat header contains the first word of the contact name
      const headerEl =
        main.querySelector('header [data-testid="conversation-info-header-chat-title"]') ||
        main.querySelector('header span[title]') ||
        main.querySelector('header span[dir="auto"]');
      const headerText = headerEl
        ? (headerEl.title || headerEl.textContent || '').toLowerCase()
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        : '';
      if (headerText.includes(firstWord)) { chatReady = true; break; }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!chatReady) {
    console.log('[AccessAI]: chat panel not found');
    return 'chat panel not found';
  }
  console.log('[AccessAI]: chat panel found');

  // ── 2. Find compose box inside #main, trying selectors in priority order ──
  const COMPOSE_SELECTORS = [
    '#main footer div[contenteditable="true"][data-tab="10"]',
    '#main footer div[contenteditable="true"]',
    '#main div[contenteditable="true"][aria-label*="message" i]',
    '#main div[contenteditable="true"][role="textbox"]',
  ];

  let composeBox = null;
  let matchedSelector = null;
  const composeDeadline = Date.now() + 3000;
  while (Date.now() < composeDeadline) {
    for (const sel of COMPOSE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) { composeBox = el; matchedSelector = sel; break; }
    }
    if (composeBox) break;
    await new Promise(r => setTimeout(r, 200));
  }

  if (!composeBox) {
    // Log diagnostic info
    const allEditable = [...document.querySelectorAll('[contenteditable="true"]')].slice(0, 5);
    console.log('[AccessAI]: compose box not found. First 5 contenteditable elements:');
    allEditable.forEach((el, i) => {
      console.log(`  [${i}] aria-label="${el.getAttribute('aria-label')}" data-tab="${el.getAttribute('data-tab')}" tag=${el.tagName} id=${el.id}`);
    });
    return 'compose box not found';
  }
  console.log(`[AccessAI]: compose box found via selector: ${matchedSelector}`);

  // ── 3. Insert text and send ───────────────────────────────────────────────
  composeBox.focus();
  const inserted = document.execCommand('insertText', false, text);
  if (!inserted) {
    composeBox.textContent = text;
    composeBox.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Try pressing Enter via keyboard events
  const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
  composeBox.dispatchEvent(new KeyboardEvent('keydown',  enterOpts));
  composeBox.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
  composeBox.dispatchEvent(new KeyboardEvent('keyup',    enterOpts));

  // Also click the Send button if it exists
  const sendBtn = document.querySelector('button[aria-label="Send"]');
  if (sendBtn) sendBtn.click();

  console.log('[AccessAI] message sent');
  return 'sent';
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

/**
 * speakableName(name) — return a TTS-safe version of a contact name.
 * Removes emoji and non-letter/number/space characters, collapses repeated
 * spaces, and trims.  Used ONLY in spoken sentences; the original name is
 * always used for matching and clicking.
 */
function speakableName(name) {
  return name
    // strip emoji (Unicode emoji and misc-symbol blocks)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // keep only letters, digits, and spaces
    .replace(/[^\p{L}\p{N} ]/gu, '')
    // collapse repeated spaces
    .replace(/  +/g, ' ')
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

// Literal strings that are not valid message content
const INVALID_MESSAGES = new Set(['message', 'a message', 'whatsapp', 'a whatsapp message']);

/** Strip leading/trailing punctuation and whitespace from a field. */
function stripEdgePunct(s) {
  return s.replace(/^[\s.,!?]+|[\s.,!?]+$/g, '');
}

/**
 * Try to parse a send-message command from the ORIGINAL (un-normalized) raw
 * transcript. Returns { type:'send', name, message } or null.
 *
 * Patterns tried in order (case-insensitive):
 *  a. "send [a/the] [whatsapp] message to <name>[,/.] <msg>"
 *  b. "send [a/the] [whatsapp] message to <name> (saying|that says|that|say) <msg>"
 *  c. "send <msg> to <name>"
 *  d. "(message|text|tell) <name>[,.]? <msg>"
 */
function parseSendRaw(raw) {
  let m;

  // a. name ends at first period or comma
  m = raw.match(/^send (?:a |the )?(?:whatsapp )?message to ([^.,]+?)[.,]\s*(.+)$/i);
  if (m) {
    const name    = stripEdgePunct(m[1]);
    const message = stripEdgePunct(m[2]);
    if (name && message && !INVALID_MESSAGES.has(message.toLowerCase())) {
      return { type: 'send', name, message };
    }
  }

  // b. name ends before saying/that says/that/say
  m = raw.match(/^send (?:a |the )?(?:whatsapp )?message to (\S+(?:\s+\S+)?) (?:saying|that says|that|say) (.+)$/i);
  if (m) {
    const name    = stripEdgePunct(m[1]);
    const message = stripEdgePunct(m[2]);
    if (name && message && !INVALID_MESSAGES.has(message.toLowerCase())) {
      return { type: 'send', name, message };
    }
  }

  // c. "send <msg> to <name>" — message comes first, name at end
  m = raw.match(/^send (.+?) to ([^.,]+)$/i);
  if (m) {
    const message = stripEdgePunct(m[1]);
    const name    = stripEdgePunct(m[2]);
    // Reject if the "message" part is really a "message to" meta-phrase
    if (name && message && !INVALID_MESSAGES.has(message.toLowerCase()) &&
        !/^(?:a |the )?(?:whatsapp )?message$/i.test(message)) {
      return { type: 'send', name, message };
    }
  }

  // d. "(message|text|tell) <name>[,.]? <msg>"
  m = raw.match(/^(?:message|text|tell) (\S+(?:\s+\S+)?)[.,]?\s+(.+)$/i);
  if (m) {
    const name    = stripEdgePunct(m[1]);
    const message = stripEdgePunct(m[2]);
    if (name && message && !INVALID_MESSAGES.has(message.toLowerCase())) {
      return { type: 'send', name, message };
    }
  }

  return null;
}

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
 * parseCommand(raw) — regex-based command parser.
 *
 * Tries raw-transcript send patterns first (preserving original capitalization),
 * then falls back to the normalized pipeline for all other commands.
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
  // ── 1. Try raw send patterns before normalizing ───────────────────────────
  const rawSend = parseSendRaw(raw.trim());
  if (rawSend) {
    console.log('[AccessAI] parsed final:', rawSend);
    return rawSend;
  }

  // ── 2. Normalize and run the rest of the pipeline ─────────────────────────
  const text = normalizeText(raw);
  console.log('AccessAI parsed: normalizing "' + raw + '" → "' + text + '"');

  // ── Sequence splitting ────────────────────────────────────────────────────
  const parts = splitSequence(text);
  if (parts.length > 1) {
    const steps = parts.map(parseCommand).filter(Boolean);
    if (steps.length > 1) {
      const parsed = { type: 'sequence', steps };
      console.log('[AccessAI] parsed final:', parsed);
      return parsed;
    }
  }

  let m;
  let p;

  // ── send it to <name> ─────────────────────────────────────────────────────
  m = text.match(/^send it to (.+)$/);
  if (m) { p = { type: 'send_it_to', name: m[1].trim() }; console.log('[AccessAI] parsed final:', p); return p; }

  // ── send <msg> to <name> (normalized fallback) ────────────────────────────
  m = text.match(/^send (.+)$/);
  if (m) {
    const body = m[1];
    const lastTo = body.lastIndexOf(' to ');
    if (lastTo !== -1) {
      const message = body.slice(0, lastTo).trim();
      const name    = body.slice(lastTo + 4).trim();
      if (!INVALID_MESSAGES.has(message)) {
        p = { type: 'send', message, name };
        console.log('[AccessAI] parsed final:', p); return p;
      }
    }
  }

  // ── tell/message <name> <msg> (normalized fallback) ──────────────────────
  m = text.match(/^(?:tell|message) (\S+(?:\s+\S+)??) (.+)$/);
  if (m) {
    p = { type: 'send', name: m[1].trim(), message: m[2].trim() };
    console.log('[AccessAI] parsed final:', p); return p;
  }

  // ── open <name>  /  go to <name>  /  open chat with <name> ───────────────
  m = text.match(/^(?:open chat with|open chat for|open|go to) (.+)$/);
  if (m) { p = { type: 'open', name: m[1].trim() }; console.log('[AccessAI] parsed final:', p); return p; }

  // ── read last message ─────────────────────────────────────────────────────
  if (/read (?:my |the )?last message/.test(text)) {
    p = { type: 'read_last' }; console.log('[AccessAI] parsed final:', p); return p;
  }

  // ── copy last message / copy it ───────────────────────────────────────────
  if (/copy (?:the |my |last )?(?:last )?message|copy it/.test(text)) {
    p = { type: 'copy_last' }; console.log('[AccessAI] parsed final:', p); return p;
  }

  // ── paste / paste it ──────────────────────────────────────────────────────
  if (/^paste(?: it)?$/.test(text)) {
    p = { type: 'paste' }; console.log('[AccessAI] parsed final:', p); return p;
  }

  // ── search for <text> / search <text> ────────────────────────────────────
  m = text.match(/^search(?: for)? (.+)$/);
  if (m) { p = { type: 'search', query: m[1].trim() }; console.log('[AccessAI] parsed final:', p); return p; }

  // ── close / go back ──────────────────────────────────────────────────────
  if (/^(?:close(?: chat)?|go back)$/.test(text)) {
    p = { type: 'close' }; console.log('[AccessAI] parsed final:', p); return p;
  }

  // ── video call <name> ─────────────────────────────────────────────────────
  m = text.match(/^video call (.+)$/);
  if (m) { p = { type: 'call', name: m[1].trim(), callType: 'video' }; console.log('[AccessAI] parsed final:', p); return p; }

  // ── voice call <name> / call <name> ──────────────────────────────────────
  m = text.match(/^(?:voice call|call) (.+)$/);
  if (m) { p = { type: 'call', name: m[1].trim(), callType: 'voice' }; console.log('[AccessAI] parsed final:', p); return p; }

  console.log('[AccessAI] parsed final: null (unrecognized)');
  return null;
}

// ── Shared yes/no word lists (used by confirmation inside conversation mode) ──
const CONFIRM_YES_WORDS = ['yes', 'yeah', 'yep', 'yup', 'haan', 'han', 'ji', 'ok', 'okay', 'sure', 'confirm', 'send it', 'theek hai'];
const CONFIRM_NO_WORDS  = ['no', 'nope', 'nahi', 'nahin', 'cancel', 'stop'];

// ── voiceSpeak stub — wired by initVoice ─────────────────────────────────────
let _voiceSpeakFn        = null;
// Called after every voiceSpeak utterance; wired by initVoice to restore mode.
let _afterVoiceSpeakHook = null;

function voiceSpeak(text) {
  return new Promise(resolve => {
    if (!_voiceSpeakFn) { resolve(); return; }
    _voiceSpeakFn(text, () => {
      // Let initVoice restore the correct mode/badge/mic before resolving.
      if (typeof _afterVoiceSpeakHook === 'function') _afterVoiceSpeakHook();
      resolve();
    });
  });
}

// ── pendingConfirm — resolved by the conversation onresult handler ────────────
// { resolve: Function }   (no deadline here — silence timer handles timeout)
let pendingConfirm = null;

/**
 * askConfirmation(prompt)
 * Speaks the prompt; the answer is picked up by the conversation onresult
 * handler which checks pendingConfirm.  Returns Promise<boolean>.
 */
async function askConfirmation(prompt) {
  return new Promise(resolve => {
    console.log('[AccessAI] confirm: waiting');
    voiceSpeak(prompt).then(() => {
      pendingConfirm = { resolve };
    });
  });
}

// ── executeVoiceCommand ───────────────────────────────────────────────────────
async function executeVoiceCommand(parsed) {
  if (!parsed) {
    await voiceSpeak("Sorry, I didn't catch that. Try again.");
    return;
  }
  if (parsed.type === 'sequence') {
    for (const step of parsed.steps) await executeVoiceCommand(step);
    return;
  }
  await _runParsedCommand(parsed);
}

/** Re-serialise a parsed command back to a string (used for debug logging). */
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

    case 'open': {
      await voiceSpeak(`Looking for ${speakableName(parsed.name)}.`);
      const found = await findBestChat(parsed.name);
      if (!found) {
        await voiceSpeak("Hmm, I couldn't find that contact. Who did you mean?");
        return;
      }
      found.row.click();
      await sleep(500);
      await voiceSpeak(`Opening ${speakableName(found.title)}.`);
      return;
    }

    case 'read_last': {
      const msgs = readMessages(1);
      await voiceSpeak(msgs[0] || 'No messages found.');
      return;
    }

    case 'copy_last': {
      const result = copyLast();
      await voiceSpeak(result === 'no messages found' ? 'No messages found.' : 'Copied.');
      return;
    }

    case 'paste': {
      const result = pasteMemory();
      await voiceSpeak(result === 'nothing copied' ? 'Nothing to paste.' : 'Pasted.');
      return;
    }

    case 'search': {
      await searchInChat(parsed.query);
      await voiceSpeak(`Searching for ${parsed.query}.`);
      return;
    }

    case 'close': {
      closeChat();
      await voiceSpeak('Closed.');
      return;
    }

    case 'send': {
      let message = parsed.message || '';
      if (!message || INVALID_MESSAGES.has(message.toLowerCase())) {
        await voiceSpeak(`What should I say to ${speakableName(parsed.name)}?`);
        // The answer will arrive as the next transcript via conversation mode —
        // expose a one-shot resolve via pendingConfirm is not appropriate here;
        // just wait for the next executeVoiceCommand call driven by the transcript.
        // Abort this invocation; the user's next utterance (message text) will
        // be handled as a bare transcript by the conversation loop.
        return;
      }

      await voiceSpeak(`Looking for ${speakableName(parsed.name)}.`);
      const found = await findBestChat(parsed.name);
      if (!found) {
        await voiceSpeak("Hmm, I couldn't find that contact. Who did you mean?");
        return;
      }
      found.row.click();

      const confirmed = await askConfirmation(
        `Send "${message}" to ${speakableName(found.title)}. Sure?`
      );
      if (!confirmed) return;

      await voiceSpeak('Sure, one moment.');
      const r = await sendMessage(message, found.title);
      if (r === 'chat panel not found') {
        await voiceSpeak("I couldn't open that chat.");
        return;
      }
      await voiceSpeak(r === 'sent' ? "Done, I sent it." : `Error: ${r}`);
      return;
    }

    case 'send_it_to': {
      if (!clipboardMemory) { await voiceSpeak("Nothing copied to send."); return; }

      await voiceSpeak(`Looking for ${speakableName(parsed.name)}.`);
      const found = await findBestChat(parsed.name);
      if (!found) {
        await voiceSpeak("Hmm, I couldn't find that contact. Who did you mean?");
        return;
      }
      found.row.click();

      const confirmed = await askConfirmation(
        `Send "${clipboardMemory}" to ${speakableName(found.title)}. Sure?`
      );
      if (!confirmed) return;

      await voiceSpeak('Sure, one moment.');
      pasteMemory();
      await sleep(300);
      const r = await sendMessage(clipboardMemory, found.title);
      if (r === 'chat panel not found') {
        await voiceSpeak("I couldn't open that chat.");
        return;
      }
      await voiceSpeak(r === 'sent' ? "Done, I sent it." : `Error: ${r}`);
      return;
    }

    case 'call': {
      await voiceSpeak(`Looking for ${speakableName(parsed.name)}.`);
      const found = await findBestChat(parsed.name);
      if (!found) {
        await voiceSpeak("Hmm, I couldn't find that contact. Who did you mean?");
        return;
      }
      found.row.click();
      await sleep(600);

      const label = parsed.callType === 'video' ? 'Video call' : 'Call';
      const confirmed = await askConfirmation(
        `${label} ${speakableName(found.title)}. Sure?`
      );
      if (!confirmed) return;

      const r = await startCall(parsed.callType);
      await voiceSpeak(r === 'calling' ? 'Calling.' : `Error: ${r}`);
      return;
    }

    default:
      await voiceSpeak("Sorry, I didn't understand. Try again.");
  }
}

// ── Voice module ─────────────────────────────────────────────────────────────
(function initVoice() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('[AccessAI] SpeechRecognition not available in this browser.');
    setBadge('AccessAI (no mic API)');
    return;
  }

  // ── Modes: "wake" | "conversation" | "speaking" ────────────────────────────
  let mode = 'idle';

  function setMode(next) {
    if (mode === next) return;
    console.log(`[AccessAI] mode: ${mode} → ${next}`);
    mode = next;
  }

  // ── 30-second silence timer ────────────────────────────────────────────────
  const CONV_TIMEOUT_MS = 30_000;
  let silenceTimer = null;

  function resetSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => endConversation('silence timeout'), CONV_TIMEOUT_MS);
  }

  function clearSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  function endConversation(reason) {
    console.log(`[AccessAI] conversation ended (${reason})`);
    clearSilenceTimer();
    pendingConfirm = null;
    setMode('speaking');
    speak("Okay, I'm here if you need me.", () => {
      setMode('wake');
      setBadge('Listening for Hi AI');
    });
  }

  // ── Farewell phrases that end the conversation ─────────────────────────────
  const FAREWELL_RE = /\b(bye|goodbye|that's all|thats all|stop listening|thank you)\b/i;

  // ── Recognition instance ───────────────────────────────────────────────────
  const recog = new SpeechRecognition();
  recog.continuous     = true;
  recog.interimResults = true;
  recog.lang           = 'en-US';

  // True while the recognition session is open (between onstart and onend).
  let isRecognizing      = false;
  let recogStartAttempts = 0;

  function startRecog() {
    recogStartAttempts = 0;
    _tryStartRecog();
  }

  function _tryStartRecog() {
    try {
      recog.start();
      recogStartAttempts = 0;
    } catch (e) {
      // "already started" / InvalidStateError — the session is already open
      if (/already|InvalidState/i.test(e.message || e.name || '')) {
        isRecognizing = true; // correct the flag and bail
        return;
      }
      console.warn('[AccessAI] recog.start() error:', e.message);
      if (recogStartAttempts < 3) {
        recogStartAttempts++;
        setTimeout(_tryStartRecog, 400);
      }
    }
  }

  // ── Watchdog: restart mic if it has gone silent outside of speech ──────────
  function ensureListening() {
    if (mode === 'speaking' || mode === 'idle') return;
    if (isRecognizing) return;
    console.log(`[AccessAI] watchdog: restarted mic (mode=${mode})`);
    _tryStartRecog();
  }

  setInterval(ensureListening, 1000);

  function normalizeTranscript(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ── Wake-phrase detection ──────────────────────────────────────────────────
  const WAKE_TOKENS    = ['hiai', 'heyai', 'haiai', 'hiay', 'hiaye', 'hieye', 'highai', 'hiii', 'hii', 'hyai'];
  const WAKE_GREETINGS = new Set(['hi', 'hey', 'hai', 'high']);
  const WAKE_AI_WORDS  = new Set(['ai', 'i', 'eye', 'a']);

  function isWakePhrase(transcript) {
    const lower = transcript.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const words = lower.split(' ').filter(Boolean);
    const joined = words.slice(0, 3).join('');

    for (const token of WAKE_TOKENS) {
      if (levenshtein(joined, token) <= 1) {
        console.log(`[AccessAI] wake check: "${transcript}" -> true`);
        return true;
      }
    }
    if (words.length >= 2 && WAKE_GREETINGS.has(words[0]) && WAKE_AI_WORDS.has(words[1])) {
      console.log(`[AccessAI] wake check: "${transcript}" -> true`);
      return true;
    }
    console.log(`[AccessAI] wake check: "${transcript}" -> false`);
    return false;
  }

  /** Returns { matched, tail } — tail is everything spoken after the wake phrase. */
  function matchWakePhrase(normalized) {
    const words = normalized.split(' ').filter(Boolean);
    if (!isWakePhrase(normalized)) return { matched: false, tail: '' };
    const tail = words.slice(3).join(' ').trim();
    return { matched: true, tail };
  }

  // ── speak(text, onDone) ────────────────────────────────────────────────────
  // Queues spoken items; each item's onDone is called after its utterance.
  // The "after speech" helper logs the required line and calls ensureListening.
  // A safety timer fires speechSynthesis.cancel() if the utterance stalls.

  const _speakQueue = [];  // { text, onDone }
  let   _speakBusy  = false;

  function _drainSpeakQueue() {
    if (_speakBusy || _speakQueue.length === 0) return;
    const { text, onDone } = _speakQueue.shift();
    _speakBusy = true;

    window.speechSynthesis.cancel();
    console.log('[AccessAI] speaking →', text);
    setBadge('Speaking…');

    // Abort recognition while speaking so it cannot hear TTS output.
    try { recog.abort(); } catch (_) {}

    const utter     = new SpeechSynthesisUtterance(text);
    utter.lang      = 'en-US';
    let fired       = false;

    const afterUtterance = (isError) => {
      if (fired) return;
      fired = true;
      clearTimeout(safetyTimer);
      if (isError) console.warn('[AccessAI] speech synthesis error');
      console.log('[AccessAI] speech ended');

      // Run the caller's onDone (sets mode, badge, calls startRecog)
      if (typeof onDone === 'function') onDone();

      // Log post-speech state then nudge the mic
      console.log(`[AccessAI] after speech -> mode=${mode}, isRecognizing=${isRecognizing}`);
      ensureListening();

      // Drain the next queued item
      _speakBusy = false;
      _drainSpeakQueue();
    };

    // Safety timer: if TTS stalls, force-finish
    const safetyMs   = text.length * 90 + 3000;
    const safetyTimer = setTimeout(() => {
      console.warn(`[AccessAI] speak safety timer fired after ${safetyMs} ms`);
      window.speechSynthesis.cancel();
      afterUtterance(false);
    }, safetyMs);

    utter.onend   = () => afterUtterance(false);
    utter.onerror = (e) => { console.warn('[AccessAI] utter.onerror', e.error); afterUtterance(true); };

    window.speechSynthesis.speak(utter);
  }

  function speak(text, onDone) {
    setMode('speaking');   // mark speaking immediately so onresult drops mic input
    _speakQueue.push({ text, onDone });
    _drainSpeakQueue();
  }

  // Wire voiceSpeak so executeVoiceCommand can call it.
  _voiceSpeakFn = speak;

  // After each voiceSpeak utterance, restore mode to conversation (or wake if
  // the conversation has already ended) and nudge the mic.
  _afterVoiceSpeakHook = () => {
    const nextMode = (mode === 'wake' || mode === 'idle') ? 'wake' : 'conversation';
    setMode(nextMode);
    setBadge(nextMode === 'wake' ? 'Listening for Hi AI' : 'Listening…');
    ensureListening();
  };

  // ── isExecuting guard ──────────────────────────────────────────────────────
  let isExecuting = false;

  // ── handleConversationTranscript(raw) ─────────────────────────────────────
  // Called for every final transcript while in "conversation" mode.
  // Handles: farewell, confirm answer, commands.
  async function handleConversationTranscript(raw) {
    const norm = normalizeTranscript(raw);
    console.log(`[AccessAI] conversation transcript: "${raw}"`);

    // Reset the 30-second silence timer on every transcript.
    resetSilenceTimer();

    // ── Farewell ─────────────────────────────────────────────────────────────
    if (FAREWELL_RE.test(raw)) {
      endConversation('user farewell');
      return;
    }

    // ── Confirm answer ────────────────────────────────────────────────────────
    if (pendingConfirm) {
      let lastYesIdx = -1;
      let lastNoIdx  = -1;

      for (const w of CONFIRM_YES_WORDS) {
        const re = new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        let m;
        while ((m = re.exec(norm)) !== null) {
          if (m.index > lastYesIdx) lastYesIdx = m.index;
        }
      }
      for (const w of CONFIRM_NO_WORDS) {
        const re = new RegExp(`\\b${w.replace(/\s+/g, '\\s+')}\\b`, 'gi');
        let m;
        while ((m = re.exec(norm)) !== null) {
          if (m.index > lastNoIdx) lastNoIdx = m.index;
        }
      }

      const gotYes = lastYesIdx !== -1;
      const gotNo  = lastNoIdx  !== -1;

      if (gotYes && (!gotNo || lastYesIdx > lastNoIdx)) {
        console.log('[AccessAI] confirm: yes');
        const { resolve } = pendingConfirm;
        pendingConfirm = null;
        resolve(true);
        return;
      }
      if (gotNo && (!gotYes || lastNoIdx > lastYesIdx)) {
        console.log('[AccessAI] confirm: no');
        const { resolve } = pendingConfirm;
        pendingConfirm = null;
        resolve(false);
        setMode('speaking');
        speak('Cancelled.', () => {
          setMode('conversation');
          setBadge('Listening…');
          startRecog();
        });
        return;
      }

      // Ambiguous — ask again; keep waiting (silence timer already reset above).
      setMode('speaking');
      speak("Sorry, was that a yes or a no?", () => {
        setMode('conversation');
        setBadge('Listening…');
        startRecog();
      });
      return;
    }

    // ── Command ───────────────────────────────────────────────────────────────
    if (isExecuting) {
      console.log(`[AccessAI] ignored (already executing): "${raw}"`);
      return;
    }

    const parsed = parseCommand(raw);
    if (!parsed) {
      setMode('speaking');
      speak("Sorry, I didn't catch that. Try again.", () => {
        setMode('conversation');
        setBadge('Listening…');
        startRecog();
      });
      return;
    }

    isExecuting = true;
    setMode('speaking');   // recognition aborted inside speak(); restarted in callbacks
    await executeVoiceCommand(parsed);
    isExecuting = false;

    // If a nested confirm ended the conversation, respect that.
    if (mode !== 'wake') {
      setMode('conversation');
      setBadge('Listening…');
      startRecog();
    }
  }

  // ── onresult ───────────────────────────────────────────────────────────────
  recog.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const isFinal    = event.results[i].isFinal;
      const transcript = event.results[i][0].transcript.trim();
      if (!transcript) continue;

      // Only process interim in wake mode; everything else needs a final result.
      if (!isFinal && mode !== 'wake') continue;

      console.log(`[AccessAI] transcript (mode=${mode}, final=${isFinal}): "${transcript}"`);

      // Hard rule: drop everything while speaking.
      if (mode === 'speaking') {
        console.log(`[AccessAI] ignored (speaking): "${transcript}"`);
        continue;
      }

      // ── Wake mode ──────────────────────────────────────────────────────────
      if (mode === 'wake') {
        const normalized = normalizeTranscript(transcript);
        const { matched, tail } = matchWakePhrase(normalized);
        if (!matched) continue; // privacy: do not log non-wake speech

        console.log('[AccessAI] wake phrase detected, conversation started');
        setMode('speaking');

        if (tail) {
          // Inline command: say "Yes?" then run it immediately.
          speak('Yes?', () => {
            setMode('conversation');
            setBadge('Listening…');
            console.log('[AccessAI] conversation started');
            resetSilenceTimer();
            startRecog();
            // Execute the inline command as the first transcript.
            handleConversationTranscript(tail);
          });
        } else {
          speak('Yes?', () => {
            setMode('conversation');
            setBadge('Listening…');
            console.log('[AccessAI] conversation started');
            resetSilenceTimer();
            startRecog();
          });
        }
        return;
      }

      // ── Conversation mode ──────────────────────────────────────────────────
      if (mode === 'conversation' && isFinal) {
        // Reset silence timer on every final transcript.
        resetSilenceTimer();
        handleConversationTranscript(transcript);
        return;
      }
    }
  };

  // ── onspeechstart — also resets the silence timer ─────────────────────────
  recog.onspeechstart = () => {
    if (mode === 'conversation') resetSilenceTimer();
  };

  // ── Recognition lifecycle ──────────────────────────────────────────────────
  recog.onstart = () => {
    isRecognizing = true;
    console.log('[AccessAI] recog started');
    if (mode === 'wake') setBadge('Listening for Hi AI');
    else if (mode === 'conversation') setBadge('Listening…');
  };

  let _networkError = false;

  recog.onerror = (event) => {
    console.warn('[AccessAI] recog onerror:', event.error);
    if (event.error === 'not-allowed') {
      isRecognizing = false;
      setBadge('Mic not allowed');
      setMode('idle');
      clearSilenceTimer();
      return;
    }
    if (event.error === 'network') _networkError = true;
    // onend fires after onerror; restart happens there.
  };

  recog.onend = () => {
    isRecognizing = false;
    console.log(`[AccessAI] recog ended (mode=${mode})`);
    if (mode === 'idle' || mode === 'speaking') return; // do not restart while idle or speaking

    const delay = _networkError ? 1500 : 400;
    _networkError = false;

    setTimeout(_tryStartRecog, delay);
  };

  // ── One-time start ─────────────────────────────────────────────────────────
  badge.addEventListener('click', () => {
    if (mode !== 'idle') return;
    setMode('wake');
    setBadge('Listening for Hi AI');
    startRecog();
  });
})();

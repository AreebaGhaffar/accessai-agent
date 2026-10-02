// AccessAI content script — WhatsApp Web (Manifest V3)

// ── Badge ────────────────────────────────────────────────────────────────────
const badge = document.createElement('div');
badge.textContent = 'AccessAI ready';
badge.style.cssText =
  'position:fixed;bottom:10px;right:10px;z-index:99999;' +
  'background:#128C7E;color:#fff;padding:8px 14px;' +
  'border-radius:20px;font:14px sans-serif;';
document.body.appendChild(badge);

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
    // Locate the compose box
    const composeBox = document.querySelector('footer div[contenteditable="true"]');
    if (!composeBox) {
      resolve('compose box not found');
      return;
    }

    // Focus and insert the text
    composeBox.focus();
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      // execCommand may return false in some browsers; try the input event path
      composeBox.textContent = text;
      composeBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Wait 500 ms then click the Send button
    setTimeout(() => {
      // Primary selector
      let sendBtn = document.querySelector('button[aria-label="Send"]');

      // Fallback: find the button closest to the send icon span
      if (!sendBtn) {
        const sendIcon = document.querySelector('span[data-icon="send"]');
        if (sendIcon) {
          sendBtn = sendIcon.closest('button');
        }
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
// Accepts only { type: 'ACCESSAI', action, text } messages from the same window.
window.addEventListener('message', async event => {
  // Only handle messages from the same window (page scripts / devtools)
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
      if (!data.text) {
        result = 'no text provided';
      } else {
        result = await sendMessage(data.text);
      }
      break;

    default:
      result = `unknown action: ${data.action}`;
  }

  console.log('AccessAI result:', result);
});

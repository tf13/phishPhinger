/**
 * warning.js — phishPhinger interstitial warning page controller.
 *
 * Reads detection details from URL query parameters, renders them,
 * and handles "Go back" / "Proceed anyway" actions.
 *
 * Expected query params:
 *   hostname  — the suspicious hostname (e.g. "audit-apple.com")
 *   resembles — the brand it resembles  (e.g. "apple.com")
 *   reason    — detection reason        (e.g. "brand-substring")
 *   url       — the full original URL the tab was navigating to
 */

'use strict';

const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// ---------------------------------------------------------------------------
// Parse query parameters
// ---------------------------------------------------------------------------

const params    = new URLSearchParams(location.search);
const hostname  = params.get('hostname')  || '';
const resembles = params.get('resembles') || '';
const reason    = params.get('reason')    || '';
const origUrl   = params.get('url')       || '';

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const REASON_LABELS = {
  'brand-substring': 'brand in name',
  'tld-swap':        'TLD swap',
  'typosquat':       'typosquat',
};

document.getElementById('hostnameEl').textContent  = hostname  || '(unknown)';
document.getElementById('resemblesEl').textContent = resembles || '(unknown)';
document.getElementById('reasonEl').textContent    = REASON_LABELS[reason] || reason || '(unknown)';
document.title = `Warning: ${hostname} — phishPhinger`;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function goBack() {
  if (history.length > 1) {
    history.back();
  } else {
    // No history to go back to (e.g. new tab) — go to the browser's new-tab page
    location.replace('about:newtab');
  }
}

function proceed() {
  if (!origUrl) return;

  // Tell the background service worker to bypass this hostname so it doesn't
  // immediately redirect to the warning page again.
  browserAPI.runtime.sendMessage({ type: 'bypass', hostname });

  location.replace(origUrl);
}

// ---------------------------------------------------------------------------
// Button listeners
// ---------------------------------------------------------------------------

document.getElementById('goBackBtn').addEventListener('click', goBack);
document.getElementById('proceedBtn').addEventListener('click', proceed);

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    goBack();
  }
});

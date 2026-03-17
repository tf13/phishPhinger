/**
 * popup.js — phishPhinger extension popup controller.
 *
 * Reads alert history from chrome.storage.local and config toggles from
 * chrome.storage.sync.  Updates both on user interaction.
 */

const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

const ALERT_KEY  = 'phishAlerts';
const CONFIG_KEY = 'phishConfig';
const MAX_DISPLAY = 20;

const DEFAULT_CONFIG = { mainFrameOnly: false, showWarning: false };

const contentEl      = document.getElementById('content');
const mainFrameCheck = document.getElementById('mainFrameOnly');
const warningCheck   = document.getElementById('showWarning');
const clearBtn       = document.getElementById('clearBtn');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function reasonLabel(reason) {
  const map = {
    'brand-substring': 'brand in name',
    'tld-swap':        'TLD swap',
    'typosquat':       'typosquat',
  };
  return map[reason] || reason;
}

// ---------------------------------------------------------------------------
// Render alert table
// ---------------------------------------------------------------------------

function renderAlerts(alerts) {
  if (!alerts || alerts.length === 0) {
    contentEl.innerHTML = '<div class="empty">No suspicious domains detected yet.</div>';
    return;
  }

  const rows = alerts.slice(0, MAX_DISPLAY).map(a => `
    <tr>
      <td class="hostname">${escapeHtml(a.hostname)}</td>
      <td class="resembles">${escapeHtml(a.resembles)}</td>
      <td><span class="reason-badge">${escapeHtml(reasonLabel(a.reason))}</span></td>
      <td class="time">${formatTime(a.ts)}</td>
    </tr>
  `).join('');

  contentEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Suspicious host</th>
          <th>Resembles</th>
          <th>Reason</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Load and display current state
// ---------------------------------------------------------------------------

browserAPI.storage.local.get({ [ALERT_KEY]: [] }, result => {
  renderAlerts(result[ALERT_KEY]);
});

browserAPI.storage.sync.get({ [CONFIG_KEY]: DEFAULT_CONFIG }, result => {
  const cfg = { ...DEFAULT_CONFIG, ...result[CONFIG_KEY] };
  mainFrameCheck.checked = cfg.mainFrameOnly;
  warningCheck.checked   = cfg.showWarning;
});

// ---------------------------------------------------------------------------
// Config toggles — always save the complete config object together
// ---------------------------------------------------------------------------

function saveConfig() {
  browserAPI.storage.sync.set({
    [CONFIG_KEY]: {
      mainFrameOnly: mainFrameCheck.checked,
      showWarning:   warningCheck.checked,
    },
  });
}

mainFrameCheck.addEventListener('change', saveConfig);
warningCheck.addEventListener('change', saveConfig);

// ---------------------------------------------------------------------------
// Clear button
// ---------------------------------------------------------------------------

clearBtn.addEventListener('click', () => {
  browserAPI.storage.local.set({ [ALERT_KEY]: [] }, () => {
    renderAlerts([]);
  });
  browserAPI.action.setBadgeText({ text: '' });
});

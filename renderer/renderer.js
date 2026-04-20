let statuses = [];

const gifGrid = document.getElementById('gif-grid');
const operationStatus = document.getElementById('operation-status');
const statusText = document.getElementById('status-text');
const loadingSpinner = document.getElementById('loading-spinner');
const connectionBadge = document.getElementById('connection-badge');
const badgeText = document.getElementById('badge-text');
const timerSelect = document.getElementById('timer-select');
const brightnessSlider = document.getElementById('brightness-slider');
let activeStatusKey = null;
let revertTimeout = null;

function createCard({ key, label, gif }) {
  const card = document.createElement('article');
  card.classList.add('card');
  card.dataset.status = key;

  card.innerHTML = `
    <div class="card-sending-overlay">
      <div class="card-spinner"></div>
    </div>
    <img src="${gif}" alt="${label} GIF preview" />
    <div class="card-body">
      <h3 class="card-title">${label}</h3>
      <p class="card-subtitle">Click to send animation</p>
      <div class="active-indicator">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="#3fb950" stroke-width="3" fill="none" class="check-icon">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Currently Displayed</span>
      </div>
    </div>
  `;

  card.addEventListener('click', async () => {
    if (card.classList.contains('sending')) return; // debounce
    card.classList.add('sending');
    setOperationStatus(`Sending "${label}" to device...`, 'primary', true);
    try {
      const r = await window.stofotag.sendStatus(key);
      setSelectedCard(key); // only mark success
      setOperationStatus('Displayed', 'success');

      const durationStr = timerSelect.value;
      const durationMins = parseInt(durationStr, 10);
      if (revertTimeout) clearTimeout(revertTimeout);
      if (durationMins > 0) {
        revertTimeout = setTimeout(async () => {
          try {
            await window.stofotag.sendStatus('available');
            setSelectedCard('available');
            setOperationStatus('Auto-reverted to Available.', 'success');
          } catch (e) { }
        }, durationMins * 60 * 1000);
      }
    } catch (err) {
      setOperationStatus('Unable to send — check USB connection.', 'danger');
    } finally {
      card.classList.remove('sending');
    }
  });

  return card;
}

function setStatusText(connected, port) {
  if (connected) {
    connectionBadge.className = 'connection-badge connected';
    badgeText.textContent = 'Connected';
    setOperationStatus('');
  } else {
    connectionBadge.className = 'connection-badge disconnected';
    badgeText.textContent = 'Not connected';
    setOperationStatus('');
  }
}

function setOperationStatus(message, style = 'primary', loading = false) {
  statusText.textContent = message;
  operationStatus.className = 'operation-status';
  if (style === 'success') operationStatus.style.color = '#10b981';
  else if (style === 'danger') operationStatus.style.color = '#ef4444';
  else operationStatus.style.color = '#3b82f6';

  if (loading) {
    loadingSpinner.classList.remove('hidden');
  } else {
    loadingSpinner.classList.add('hidden');
  }
}

function setSelectedCard(statusKey) {
  activeStatusKey = statusKey;
  document.querySelectorAll('.card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.status === statusKey);
  });
}

async function initUI() {
  setOperationStatus('Loading library...', 'primary', true);
  try {
    statuses = await window.stofotag.getGifs();
    gifGrid.innerHTML = '';
    statuses.forEach((status) => {
      gifGrid.appendChild(createCard(status));
    });
    setOperationStatus('');
  } catch (e) {
    setOperationStatus('Failed to load GIF library.', 'danger');
  }
  setStatusText(false, null);
}

window.stofotag.onDeviceStatus((data) => {
  setStatusText(data.connected, data.port);
});

window.stofotag.onDeviceError((message) => {
  setOperationStatus('Unable to communicate with the tag. Please check the USB connection.', 'danger');
});

initUI();

const themeCheckbox = document.getElementById('theme-checkbox');
if (themeCheckbox) {
  themeCheckbox.addEventListener('change', () => {
    if (themeCheckbox.checked) {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
  });
}

brightnessSlider.addEventListener('change', (e) => {
  window.stofotag.setBrightness(e.target.value);
});



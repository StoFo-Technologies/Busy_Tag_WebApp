let statuses = [];

const gifGrid = document.getElementById('gif-grid');
const operationStatus = document.getElementById('operation-status');
const statusText = document.getElementById('status-text');
const loadingSpinner = document.getElementById('loading-spinner');
const connectionBadge = document.getElementById('connection-badge');
const badgeText = document.getElementById('badge-text');
const timerSelect = document.getElementById('timer-select');
const brightnessSlider = document.getElementById('brightness-slider');
const toggleGif = document.getElementById('toggle-gif');
const toggleImage = document.getElementById('toggle-image');
let currentFilter = 'gif';
let activeStatusKey = null;

function createCard({ key, label, src, type }) {
  const card = document.createElement('article');
  card.classList.add('card');
  card.dataset.status = key;

  card.innerHTML = `
    <div class="card-sending-overlay">
      <div class="card-spinner"></div>
    </div>
    <div class="card-image-wrapper">
      <img src="${src}" alt="${type === 'cartoon' ? 'Cartoon preview' : label} ${type === 'image' ? 'Image' : type === 'cartoon' ? 'Cartoon' : 'GIF'} preview" />
      <div class="play-btn">
        <svg viewBox="0 0 24 24" fill="white" width="16" height="16">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </div>
    </div>
    ${type !== 'cartoon' ? `<h3 class="card-title">${label}</h3>` : ''}
  `;

  card.addEventListener('click', async () => {
    if (card.classList.contains('sending')) return; // debounce
    card.classList.add('sending');
    setOperationStatus(`Sending "${label}" to device...`, 'primary', true);
    try {
      const r = await window.statustag.sendStatus(key);
      setSelectedCard(key); // only mark success
      setOperationStatus(`Displayed "${label}"`, 'success');

      const durationStr = timerSelect.value;
      const durationMins = parseInt(durationStr, 10);
      if (durationMins > 0) {
        const statusItem = statuses.find(s => s.key === key);
        const type = statusItem ? statusItem.type : 'gif';

        let revertKey;

        if (type === 'cartoon') {
          revertKey = 'Free_Cartoon.webp';
        } else if (type === 'image') {
          revertKey = 'available_Image.png';
        } else {
          revertKey = 'Available_Gif.gif';
        }

        window.statustag.setAutoRevert({ durationMins, revertKey }).catch(() => { });
      }
    } catch (err) {
      let errorMsg = err.message || 'Unknown error';
      if (errorMsg.toLowerCase().includes('cancelled by new selection')) {
        setOperationStatus('');
        return;
      }
      if (errorMsg.includes('Error invoking remote method')) {
        errorMsg = errorMsg.split(':').slice(2).join(':').trim() || errorMsg;
      }
      setOperationStatus(`Error: ${errorMsg}`, 'danger');
    } finally {
      card.classList.remove('sending');
    }
  });

  return card;
}

function setStatusText(connected, port) {
  const statusIcon = document.getElementById('status-icon');
  const badgeStatusWrap = document.getElementById('badge-status-wrap');

  if (connected) {
    if (badgeStatusWrap) badgeStatusWrap.className = 'connection-status connected';
    if (badgeText) badgeText.textContent = 'Connected';
    if (statusIcon) {
      statusIcon.setAttribute('fill', '#3fb950');
      statusIcon.innerHTML = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>';
    }
    setOperationStatus('');
  } else {
    if (badgeStatusWrap) badgeStatusWrap.className = 'connection-status disconnected';
    if (badgeText) badgeText.textContent = 'No devices found';
    if (statusIcon) {
      statusIcon.setAttribute('fill', '#f85149');
      statusIcon.innerHTML = '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.59 13.17L15.17 16.59 12 13.41 8.83 16.59 7.41 15.17 10.59 12 7.41 8.83 8.83 7.41 12 10.59 15.17 7.41 16.59 8.83 13.41 12l3.18 3.17z"/>';
    }
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

function renderGrid() {
  gifGrid.innerHTML = '';
  statuses.forEach((status) => {
    if (status.type === currentFilter) {
      gifGrid.appendChild(createCard(status));
    }
  });
  if (activeStatusKey) {
    setSelectedCard(activeStatusKey);
  }
}

async function initUI() {
  setOperationStatus('Loading library...', 'primary', true);
  try {
    statuses = await window.statustag.getGifs();
    const deviceStatus = await window.statustag.getDeviceStatus();
    setStatusText(deviceStatus.connected, deviceStatus.port);
    renderGrid();
    setOperationStatus('');
  } catch (e) {
    setOperationStatus('Failed to load library.', 'danger');
  }
}

if (toggleGif) {
  toggleGif.addEventListener('change', (e) => {
    if (e.target.checked) {
      currentFilter = 'gif';
      renderGrid();
    }
  });
}

if (toggleImage) {
  toggleImage.addEventListener('change', (e) => {
    if (e.target.checked) {
      currentFilter = 'image';
      renderGrid();
    }
  });
}

const toggleCartoon = document.getElementById('toggle-cartoon');
if (toggleCartoon) {
  toggleCartoon.addEventListener('change', (e) => {
    if (e.target.checked) {
      currentFilter = 'cartoon';
      renderGrid();
    }
  });
}

window.statustag.onDeviceStatus((data) => {
  setStatusText(data.connected, data.port);
});

window.statustag.onDeviceError((message) => {
  setOperationStatus(`Error: ${message}`, 'danger');
});

window.statustag.onAutoReverted((revertKey) => {
  setSelectedCard(revertKey);
  setOperationStatus('Auto-reverted to Available.', 'success');
});

if (timerSelect) {
  timerSelect.addEventListener('change', () => {
    if (!activeStatusKey || activeStatusKey.toLowerCase().includes('available')) return;

    const durationMins = parseInt(timerSelect.value, 10);
    if (durationMins > 0) {
      const statusItem = statuses.find(s => s.key === activeStatusKey);
      const type = statusItem ? statusItem.type : 'gif';

      let revertKey;

      if (type === 'cartoon') {
        revertKey = 'Free_Cartoon.webp';
      } else if (type === 'image') {
        revertKey = 'available_Image.png';
      } else {
        revertKey = 'Available_Gif.gif';
      }

      window.statustag.setAutoRevert({ durationMins, revertKey }).catch(() => { });
    } else {
      window.statustag.setAutoRevert({ durationMins: 0 }).catch(() => { });
    }
  });
}

initUI();

const themeCheckbox = document.getElementById('theme-checkbox');
if (themeCheckbox) {
  themeCheckbox.addEventListener('change', () => {
    const isLight = themeCheckbox.checked;
    if (isLight) {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
    window.statustag.setTitleBarTheme(isLight);
  });
}

brightnessSlider.addEventListener('change', (e) => {
  window.statustag.setBrightness(e.target.value);
});

const resetDisplayBtn = document.getElementById('reset-display-btn');
const resetOverlay = document.getElementById('reset-overlay');

if (resetDisplayBtn) {
  resetDisplayBtn.addEventListener('click', async () => {
    // Show overlay
    resetOverlay.classList.remove('hidden');
    // Allow browser to register 'hidden' removal before adding 'active' for transition
    requestAnimationFrame(() => {
      resetOverlay.classList.add('active');
    });

    setOperationStatus('Initiating system reset...', 'primary', true);

    try {
      await window.statustag.resetDisplay();

      // Keep overlay for a moment for "WOW" factor
      await new Promise(resolve => setTimeout(resolve, 2000));

      setOperationStatus('System reset successfully', 'success');
      setSelectedCard(null);
    } catch (err) {
      setOperationStatus('Reset Error: ' + err.message, 'danger');
    } finally {
      // Hide overlay
      resetOverlay.classList.remove('active');
      setTimeout(() => {
        resetOverlay.classList.add('hidden');
      }, 500); // Wait for fade out
    }
  });
}

const helpBtn = document.getElementById('help-btn');
const closeHelpBtn = document.getElementById('close-help-btn');
const helpOverlay = document.getElementById('help-overlay');

if (helpBtn && helpOverlay) {
  helpBtn.addEventListener('click', () => {
    helpOverlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      helpOverlay.classList.add('active');
    });
  });
}

if (closeHelpBtn && helpOverlay) {
  closeHelpBtn.addEventListener('click', () => {
    helpOverlay.classList.remove('active');
    setTimeout(() => {
      helpOverlay.classList.add('hidden');
    }, 500);
  });
}

// Custom Dropdown Logic
const customTimerContainer = document.getElementById('custom-timer-container');
const customTimerTrigger = document.getElementById('custom-timer-trigger');
const customTimerLabel = document.getElementById('custom-timer-label');
const customOptions = document.querySelectorAll('.custom-option');
const hiddenTimerSelect = document.getElementById('timer-select');

if (customTimerContainer && customTimerTrigger) {
  customTimerTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    customTimerContainer.classList.toggle('open');
  });

  customOptions.forEach(option => {
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove selected from all
      customOptions.forEach(opt => opt.classList.remove('selected'));
      // Add selected to clicked
      option.classList.add('selected');
      // Update label
      customTimerLabel.textContent = option.textContent;
      // Update hidden select
      hiddenTimerSelect.value = option.dataset.value;
      // Close dropdown
      customTimerContainer.classList.remove('open');
      // Dispatch change event to trigger existing logic
      hiddenTimerSelect.dispatchEvent(new Event('change'));
    });
  });

  // Close when clicking outside
  document.addEventListener('click', () => {
    customTimerContainer.classList.remove('open');
  });
}

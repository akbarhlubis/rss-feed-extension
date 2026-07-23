document.addEventListener('DOMContentLoaded', function () {
  // ── DOM References ──────────────────────────────────────────────
  const addUrlForm = document.getElementById('add-url-form');
  const urlsList = document.getElementById('urls-list');
  const addFeedToggleBtn = document.getElementById('add-feed-toggle-btn');
  const addUrlSection = document.getElementById('add-url-section');
  const closeAddFormBtn = document.getElementById('close-add-form-btn');
  const searchInput = document.getElementById('search-input');
  const filterSelect = document.getElementById('filter-select');
  const checkUpdateBtn = document.getElementById('check-update-btn');

  // ── State ────────────────────────────────────────────────────────
  let allUrls = [];   // Master copy from storage
  let searchQuery = '';
  let filterValue = 'all';

  // ── Init ─────────────────────────────────────────────────────────
  displayVersion();
  loadUrls();

  // ── Add Feed Toggle ──────────────────────────────────────────────
  addFeedToggleBtn.addEventListener('click', function () {
    const isHidden = addUrlSection.hidden;
    addUrlSection.hidden = !isHidden;
    addFeedToggleBtn.setAttribute('aria-expanded', String(isHidden));
    if (isHidden) {
      document.getElementById('url-input').focus();
    }
  });

  closeAddFormBtn.addEventListener('click', function () {
    addUrlSection.hidden = true;
    addFeedToggleBtn.setAttribute('aria-expanded', 'false');
  });

  // ── Search & Filter ──────────────────────────────────────────────
  searchInput.addEventListener('input', function () {
    searchQuery = this.value.toLowerCase().trim();
    renderUrls();
  });

  filterSelect.addEventListener('change', function () {
    filterValue = this.value;
    renderUrls();
  });

  // ── Add Feed Form ────────────────────────────────────────────────
  addUrlForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const url = document.getElementById('url-input').value.trim();
    const name = document.getElementById('name-input').value.trim();
    const interval = parseInt(document.getElementById('interval-input').value, 10);

    if (!url || !name || isNaN(interval) || interval < 1) {
      showToast('Please fill all required fields correctly.');
      return;
    }

    checkDuplicateURL(url, name, interval);
  });

  // ── Storage Change Listener ──────────────────────────────────────
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.urls) {
      allUrls = changes.urls.newValue || [];
      renderUrls();
    }
  });

  // ── Check for Updates ────────────────────────────────────────────
  checkUpdateBtn.addEventListener('click', checkForUpdates);

  // ════════════════════════════════════════════════════════════════
  // CORE FUNCTIONS
  // ════════════════════════════════════════════════════════════════

  function loadUrls() {
    chrome.storage.local.get('urls', function (data) {
      allUrls = data.urls || [];
      renderUrls();
    });
  }

  // Filter + search, then call displayUrls
  function renderUrls() {
    let filtered = allUrls;

    // Apply search
    if (searchQuery) {
      filtered = filtered.filter(u =>
        u.name.toLowerCase().includes(searchQuery) ||
        u.url.toLowerCase().includes(searchQuery)
      );
    }

    // Apply filter
    if (filterValue === 'new') {
      filtered = filtered.filter(u => u.hasNew);
    } else if (filterValue === 'error') {
      filtered = filtered.filter(u => u.isError);
    } else if (filterValue === 'paused') {
      filtered = filtered.filter(u => u.isPaused);
    }

    displayUrls(filtered);
  }

  function checkDuplicateURL(url, name, interval) {
    const isDuplicate = allUrls.some(item => item.url === url);
    if (isDuplicate) {
      showToast(`"${name}" is already in the list.`);
    } else {
      addUrl(url, name, interval);
      addUrlForm.reset();
      addUrlSection.hidden = true;
      addFeedToggleBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function addUrl(url, name, interval) {
    const newUrl = {
      id: Date.now(),
      url,
      name,
      interval,
      lastChecked: null,
      lastContent: null,
      latestItems: [],
      isPaused: false,
      hasNew: false,
      isError: false,
      isChecking: false
    };
    allUrls.push(newUrl);
    chrome.storage.local.set({ urls: allUrls }, function () {
      renderUrls();
      chrome.runtime.sendMessage({ action: 'scheduleCheck', url: newUrl });
      showToast(`"${name}" added and first check started.`);
    });
  }

  function deleteUrl(id) {
    allUrls = allUrls.filter(item => item.id !== id);
    chrome.storage.local.set({ urls: allUrls }, function () {
      renderUrls();
      chrome.runtime.sendMessage({ action: 'cancelCheck', id });
    });
  }

  function togglePause(id, shouldPause) {
    const url = allUrls.find(u => u.id === id);
    if (!url) return;
    url.isPaused = shouldPause;
    chrome.storage.local.set({ urls: allUrls }, function () {
      const action = shouldPause ? 'pauseCheck' : 'resumeCheck';
      chrome.runtime.sendMessage({ action, id });
      renderUrls();
    });
  }

  // ════════════════════════════════════════════════════════════════
  // DISPLAY
  // ════════════════════════════════════════════════════════════════

  function displayUrls(urls) {
    urlsList.innerHTML = '';

    if (allUrls.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'no-urls';
      empty.innerHTML = '<i class="bi bi-rss"></i><p>No feeds yet. Click "Add Feed" to start.</p>';
      urlsList.appendChild(empty);
      return;
    }

    if (urls.length === 0) {
      const noResult = document.createElement('div');
      noResult.className = 'no-urls';
      noResult.textContent = 'No feeds match your search.';
      urlsList.appendChild(noResult);
      return;
    }

    urls.forEach(item => {
      const urlItem = document.createElement('div');
      urlItem.className = 'url-item' + (item.isPaused ? ' is-paused' : '');
      urlItem.setAttribute('role', 'listitem');
      urlItem.dataset.id = item.id;

      // ── Header row ──
      const header = document.createElement('div');
      header.className = 'url-item-header';

      const statusDot = document.createElement('span');
      statusDot.className = 'status-dot ' + getStatusClass(item);
      statusDot.setAttribute('aria-label', getStatusTitle(item));
      statusDot.title = getStatusTitle(item);

      const nameEl = document.createElement('div');
      nameEl.className = 'url-name';
      nameEl.textContent = item.name;

      const metaEl = document.createElement('div');
      metaEl.className = 'url-meta';
      metaEl.textContent = item.isPaused
        ? 'Paused'
        : (item.lastChecked ? relativeTime(item.lastChecked) : 'Never checked');

      const expandBtn = document.createElement('button');
      expandBtn.className = 'expand-btn';
      expandBtn.setAttribute('aria-label', `Expand ${item.name}`);
      expandBtn.setAttribute('aria-expanded', 'false');
      expandBtn.innerHTML = '<i class="bi bi-chevron-down" aria-hidden="true"></i>';

      header.appendChild(statusDot);
      header.appendChild(nameEl);
      header.appendChild(metaEl);
      header.appendChild(expandBtn);

      // ── Detail panel (collapsed by default) ──
      const detail = document.createElement('div');
      detail.className = 'url-detail';
      detail.hidden = true;

      const urlDetail = document.createElement('div');
      urlDetail.className = 'url-details url-detail-link';
      const urlLink = document.createElement('a');
      urlLink.href = safeUrl(item.url);
      urlLink.target = '_blank';
      urlLink.rel = 'noopener noreferrer';
      urlLink.textContent = item.url;
      urlLink.className = 'feed-source-link';
      urlDetail.appendChild(urlLink);

      const intervalDetail = document.createElement('div');
      intervalDetail.className = 'url-details';
      intervalDetail.textContent = `Check every ${item.interval} min`;

      const latestSection = document.createElement('div');
      latestSection.className = 'rss-latest';

      const latestTitle = document.createElement('strong');
      latestTitle.textContent = 'Latest Items:';
      latestSection.appendChild(latestTitle);

      const itemList = document.createElement('ul');
      if (item.latestItems && item.latestItems.length > 0) {
        item.latestItems.forEach(i => {
          const li = document.createElement('li');
          const link = document.createElement('a');
          link.href = safeUrl(i.link);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = i.title || '(no title)';

          const dateSpan = document.createElement('span');
          dateSpan.className = 'rss-date';
          if (i.pubDate) {
            try {
              dateSpan.textContent = new Date(i.pubDate).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
              });
            } catch (e) { dateSpan.textContent = i.pubDate; }
          }

          li.appendChild(link);
          li.appendChild(dateSpan);

          if (i.blockquote) {
            const bq = document.createElement('div');
            bq.className = 'rss-blockquote';
            bq.textContent = i.blockquote;
            li.appendChild(bq);
          }
          itemList.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        const em = document.createElement('em');
        em.textContent = '(no data yet)';
        li.appendChild(em);
        itemList.appendChild(li);
      }
      latestSection.appendChild(itemList);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'btn-group';

      const checkBtn = document.createElement('button');
      checkBtn.className = 'check-btn';
      checkBtn.setAttribute('aria-label', `Check now: ${item.name}`);
      checkBtn.innerHTML = 'Check Now <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>';

      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'pause-btn';
      const isPaused = item.isPaused === true;
      pauseBtn.setAttribute('aria-label', isPaused ? `Resume ${item.name}` : `Pause ${item.name}`);
      pauseBtn.innerHTML = isPaused
        ? 'Resume <i class="bi bi-play-fill" aria-hidden="true"></i>'
        : 'Pause <i class="bi bi-pause-fill" aria-hidden="true"></i>';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.setAttribute('aria-label', `Delete ${item.name}`);
      deleteBtn.innerHTML = 'Delete <i class="bi bi-trash" aria-hidden="true"></i>';

      btnGroup.appendChild(checkBtn);
      btnGroup.appendChild(pauseBtn);
      btnGroup.appendChild(deleteBtn);

      detail.appendChild(urlDetail);
      detail.appendChild(intervalDetail);
      detail.appendChild(latestSection);
      detail.appendChild(btnGroup);

      urlItem.appendChild(header);
      urlItem.appendChild(detail);
      urlsList.appendChild(urlItem);

      // ── Event listeners ──
      expandBtn.addEventListener('click', () => {
        const isExpanded = !detail.hidden;
        detail.hidden = isExpanded;
        expandBtn.setAttribute('aria-expanded', String(!isExpanded));
        expandBtn.querySelector('i').className = isExpanded
          ? 'bi bi-chevron-down'
          : 'bi bi-chevron-up';
        // Clear "new" badge when user expands
        if (!isExpanded && item.hasNew) {
          const idx = allUrls.findIndex(u => u.id === item.id);
          if (idx !== -1) {
            allUrls[idx].hasNew = false;
            chrome.storage.local.set({ urls: allUrls });
          }
          statusDot.className = 'status-dot status-ok';
          statusDot.title = 'Up to date';
        }
      });

      checkBtn.addEventListener('click', () => {
        checkBtn.disabled = true;
        checkBtn.innerHTML = 'Checking... <i class="bi bi-hourglass-split" aria-hidden="true"></i>';
        chrome.runtime.sendMessage({ action: 'manualCheck', id: item.id });
        setTimeout(() => {
          if (checkBtn.disabled) {
            checkBtn.disabled = false;
            checkBtn.innerHTML = 'Check Now <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>';
          }
        }, 8000);
      });

      pauseBtn.addEventListener('click', () => {
        togglePause(item.id, !isPaused);
      });

      deleteBtn.addEventListener('click', () => {
        if (confirm(`Delete feed "${item.name}"?`)) {
          deleteUrl(item.id);
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
    } catch (e) { /* noop */ }
    return '#';
  }

  function relativeTime(isoString) {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHour < 24) return `${diffHour} hr ago`;
    return `${diffDay}d ago`;
  }

  function getStatusClass(item) {
    if (item.isPaused) return 'status-paused';
    if (item.isError) return 'status-error';
    if (item.hasNew) return 'status-new';
    return 'status-ok';
  }

  function getStatusTitle(item) {
    if (item.isPaused) return 'Paused';
    if (item.isError) return 'Error on last check';
    if (item.hasNew) return 'New content available';
    return 'Up to date';
  }

  function showToast(message) {
    Toastify({
      text: message,
      duration: 3000,
      close: true,
      gravity: 'bottom',
      position: 'right',
    }).showToast();
  }

  function displayVersion() {
    const manifest = chrome.runtime.getManifest();
    const versionEl = document.querySelector('.version');
    if (versionEl) versionEl.textContent = `v${manifest.version}`;
  }

  // ════════════════════════════════════════════════════════════════
  // CHECK FOR UPDATES
  // ════════════════════════════════════════════════════════════════

  function checkForUpdates() {
    const githubReleasesURL = 'https://github.com/akbarhlubis/rss-feed-extension/releases.atom';
    checkUpdateBtn.innerHTML = '<i class="bi bi-hourglass-split" aria-hidden="true"></i>';
    checkUpdateBtn.disabled = true;

    fetch(githubReleasesURL)
      .then(r => r.text())
      .then(xmlText => {
        const latestVersion = parseGithubReleaseFeed(xmlText);
        const currentVersion = chrome.runtime.getManifest().version;

        if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
          if (confirm(`Version ${latestVersion} is available! (yours: ${currentVersion}). Open download page?`)) {
            chrome.tabs.create({ url: 'https://github.com/akbarhlubis/rss-feed-extension/releases/latest' });
          }
        } else {
          showToast('You are using the latest version.');
        }
      })
      .catch(() => {
        showToast('Failed to check for updates. Please try again.');
      })
      .finally(() => {
        checkUpdateBtn.innerHTML = '<i class="bi bi-arrow-repeat" aria-hidden="true"></i>';
        checkUpdateBtn.disabled = false;
      });
  }

  function parseGithubReleaseFeed(xmlText) {
    const match = /<entry>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<\/entry>/i.exec(xmlText);
    if (match?.[1]) {
      const v = match[1].trim();
      return v.startsWith('v') ? v.substring(1) : v;
    }
    return null;
  }

  function compareVersions(v1, v2) {
    const a = v1.split('.').map(Number);
    const b = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] || 0) - (b[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
});
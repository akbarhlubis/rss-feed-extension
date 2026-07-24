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
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file-input');

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

  // ── Export & Import ──────────────────────────────────────────────
  exportBtn.addEventListener('click', exportFeeds);
  importBtn.addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', handleImportFile);

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
      const classes = ['url-item'];
      if (item.isPaused)  classes.push('is-paused');
      if (item.isChecking) classes.push('is-checking');
      urlItem.className = classes.join(' ');
      urlItem.setAttribute('role', 'listitem');
      if (item.isChecking) urlItem.setAttribute('aria-busy', 'true');
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
        if (deleteBtn.dataset.confirming === 'true') {
          // Second click within the window — execute delete
          deleteUrl(item.id);
        } else {
          // First click — enter confirmation mode
          deleteBtn.dataset.confirming = 'true';
          deleteBtn.textContent = 'Confirm?';
          deleteBtn.style.background = '#922b21';
          const resetTimer = setTimeout(() => {
            if (deleteBtn.isConnected) {
              deleteBtn.dataset.confirming = 'false';
              deleteBtn.innerHTML = 'Delete <i class="bi bi-trash" aria-hidden="true"></i>';
              deleteBtn.style.background = '';
            }
          }, 3000);
          deleteBtn._resetTimer = resetTimer;
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════


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
    checkUpdateBtn.innerHTML = '<i class="bi bi-hourglass-split" aria-hidden="true"></i>';
    checkUpdateBtn.disabled = true;

    // MV3 restriction: popup cannot fetch cross-origin URLs reliably.
    // Delegate to background service worker which has full network access.
    chrome.runtime.sendMessage({ action: 'checkLatestVersion' }, (response) => {
      checkUpdateBtn.innerHTML = '<i class="bi bi-arrow-repeat" aria-hidden="true"></i>';
      checkUpdateBtn.disabled = false;

      if (chrome.runtime.lastError) {
        console.error('checkForUpdates runtime error:', chrome.runtime.lastError.message);
        showToast('Failed to check for updates. Please try again.');
        return;
      }

      if (!response || !response.success) {
        console.error('checkForUpdates failed:', response?.error);
        showToast('Failed to check for updates. Please try again.');
        return;
      }

      const { latestVersion, currentVersion } = response;
      if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
        showUpdateBanner(latestVersion);
      } else {
        showToast('You are using the latest version.');
      }
    });
  }

  function showUpdateBanner(newVersion) {
    const banner = document.getElementById('update-banner');
    if (!banner) return;

    const msg = banner.querySelector('#update-banner-msg');
    const downloadBtn = banner.querySelector('#update-download-btn');
    const dismissBtn = banner.querySelector('#update-dismiss-btn');

    if (msg) msg.textContent = `v${newVersion} is available!`;
    banner.hidden = false;

    // Auto-download ZIP via chrome.downloads
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const zipUrl = `https://github.com/akbarhlubis/rss-feed-extension/archive/refs/tags/v${newVersion}.zip`;
        chrome.downloads.download({
          url: zipUrl,
          filename: `rss-feed-warrior-v${newVersion}.zip`,
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            showToast('Download failed. Opening GitHub instead...');
            chrome.tabs.create({ url: 'https://github.com/akbarhlubis/rss-feed-extension/releases/latest' });
          } else {
            showToast(`Downloading v${newVersion}... Check your downloads folder.`);
            banner.hidden = true;
          }
        });
      };
    }

    if (dismissBtn) {
      dismissBtn.onclick = () => { banner.hidden = true; };
    }
  }

  function parseGithubReleaseFeed(xmlText) {
    const match = /<entry>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<\/entry>/i.exec(xmlText);
    if (match?.[1]) {
      const titleText = match[1].trim();
      // Match semantic version pattern like v2.0.0 or 2.0.0 from title "RSS Feed Warrior v2.0.0"
      const versionMatch = /v?(\d+\.\d+(?:\.\d+)?)/i.exec(titleText);
      if (versionMatch?.[1]) {
        return versionMatch[1];
      }
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════
  // EXPORT & IMPORT
  // ════════════════════════════════════════════════════════════════

  function exportFeeds() {
    if (allUrls.length === 0) {
      showToast('No feeds to export.');
      return;
    }

    const exportData = {
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      feeds: allUrls.map(u => ({
        name: u.name,
        url: u.url,
        interval: u.interval,
        isPaused: u.isPaused || false
      }))
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);

    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `rss-feed-warrior-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    showToast(`Exported ${allUrls.length} feed(s) successfully.`);
  }

  function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const content = e.target.result;
        const data = JSON.parse(content);

        let importedFeeds = [];
        if (Array.isArray(data)) {
          importedFeeds = data;
        } else if (data && Array.isArray(data.feeds)) {
          importedFeeds = data.feeds;
        } else {
          showToast('Invalid JSON file format.');
          return;
        }

        let addedCount = 0;
        let skippedCount = 0;
        const now = Date.now();

        importedFeeds.forEach((item, index) => {
          const rawUrl = item.url ? String(item.url).trim() : '';
          const rawName = item.name ? String(item.name).trim() : '';
          const rawInterval = parseInt(item.interval, 10);

          if (!rawUrl || !rawName || isNaN(rawInterval) || rawInterval < 1) {
            return;
          }

          if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
            return;
          }

          const exists = allUrls.some(u => u.url === rawUrl);
          if (exists) {
            skippedCount++;
          } else {
            const newFeed = {
              id: now + index,
              url: rawUrl,
              name: rawName,
              interval: rawInterval,
              lastChecked: null,
              lastContent: null,
              latestItems: [],
              isPaused: item.isPaused === true,
              hasNew: false,
              isError: false,
              isChecking: false
            };
            allUrls.push(newFeed);
            chrome.runtime.sendMessage({ action: 'scheduleCheck', url: newFeed });
            addedCount++;
          }
        });

        if (addedCount > 0) {
          chrome.storage.local.set({ urls: allUrls }, function () {
            renderUrls();
            showToast(`Imported ${addedCount} feed(s). (${skippedCount} skipped)`);
          });
        } else {
          showToast(`No new feeds added. (${skippedCount} skipped/duplicate)`);
        }
      } catch (err) {
        console.error('Import error:', err);
        showToast('Failed to parse JSON file.');
      } finally {
        event.target.value = '';
      }
    };

    reader.readAsText(file);
  }
});
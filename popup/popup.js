document.addEventListener('DOMContentLoaded', function() {
  const addUrlForm = document.getElementById('add-url-form');
  const urlsList = document.getElementById('urls-list');

  loadUrls();

  addUrlForm.addEventListener('submit', function(event) {
    event.preventDefault();

    const url = document.getElementById('url-input').value;
    const name = document.getElementById('name-input').value;
    const interval = parseInt(document.getElementById('interval-input').value);

    if (url && name && interval) {
      addUrl(url, name, interval);
      addUrlForm.reset();
    }
  });

  function loadUrls() {
    chrome.storage.local.get('urls', function(data) {
      const urls = data.urls || [];
      displayUrls(urls);
    });
  }

  function addUrl(url, name, interval) {
    chrome.storage.local.get('urls', function(data) {
      const urls = data.urls || [];
      const newUrl = {
        id: Date.now(),
        url: url,
        name: name,
        interval: interval,
        lastChecked: null,
        lastContent: null,
        latestItems: []
      };
      urls.push(newUrl);
      chrome.storage.local.set({ urls: urls }, function() {
        displayUrls(urls);
        chrome.runtime.sendMessage({ action: 'scheduleCheck', url: newUrl });
      });
    });
  }

  function deleteUrl(id) {
    chrome.storage.local.get('urls', function(data) {
      const urls = data.urls || [];
      const updatedUrls = urls.filter(item => item.id !== id);
      chrome.storage.local.set({ urls: updatedUrls }, function() {
        displayUrls(updatedUrls);
        chrome.runtime.sendMessage({ action: 'cancelCheck', id: id });
      });
    });
  }

  function displayUrls(urls) {
    urlsList.innerHTML = '';
    if (urls.length === 0) {
      urlsList.innerHTML = '<div class="no-urls">Belum ada feed ditambahkan.</div>';
      return;
    }

    urls.forEach(item => {
      const urlItem = document.createElement('div');
      urlItem.className = 'url-item';

      const lastCheckedText = item.lastChecked ?
        new Date(item.lastChecked).toLocaleTimeString() :
        'Never';

      urlItem.innerHTML = `
        <div class="url-name">${item.name}</div>
        <div class="url-details">${item.url}</div>
        <div class="url-details">Interval: ${item.interval} menit</div>
        <div class="url-details">Terakhir cek: ${lastCheckedText}</div>
        <div class="rss-latest">
          <strong>3 Item Terbaru:</strong>
          <ul>
            ${
              item.latestItems && item.latestItems.length
                ? item.latestItems.map(i =>
                    `<li>
                      <a href="${i.link}" target="_blank">${i.title}</a>
                      <span class="rss-date">${
                        i.pubDate
                          ? new Date(i.pubDate).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : ''
                      }</span>
                      ${i.blockquote ? `<div class="rss-blockquote">${i.blockquote}</div>` : ''}
                    </li>`
                  ).join('')
                : '<li><em>(belum ada data)</em></li>'
            }
          </ul>
        </div>
        <div class="btn-group">
          <button class="check-btn">Check Now <i class="bi bi-search"></i></button>
          <button class="delete-btn">Delete <i class="bi bi-trash"></i></button>
        </div>
      `;

      urlItem.querySelector('.delete-btn').addEventListener('click', function() {
        deleteUrl(item.id);
      });

      urlItem.querySelector('.check-btn').addEventListener('click', function() {
        chrome.runtime.sendMessage({
          action: 'manualCheck',
          id: item.id
        });
      });

      urlsList.appendChild(urlItem);
    });
  }

  // Auto update list jika ada perubahan dari background
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.urls) {
      displayUrls(changes.urls.newValue || []);
    }
  });

  // Collapse/Expand URLs section
  urlsList.classList.add('collapsed');
  document.getElementById('collapse-urls').textContent = 'Open';

  // Check for Updates button
  const checkUpdateBtn = document.getElementById('check-update-btn');
  checkUpdateBtn.addEventListener('click', checkForUpdates);

  function checkForUpdates() {
    // Change this URL to your GitHub repository releases atom feed URL
    const githubReleasesURL = "https://github.com/akbarhlubis/rss-feed-extension/releases.atom";
    
    // Change button appearance during the process
    checkUpdateBtn.textContent = "Checking...";
    checkUpdateBtn.disabled = true;
    
    fetch(githubReleasesURL)
      .then(response => response.text())
      .then(xmlText => {
        // Parse Atom feed for latest release
        const latestVersion = parseGithubReleaseFeed(xmlText);
        
        // Read extension version from manifest.json - NO .then() NEEDED
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;
        
        if (latestVersion && compareVersions(latestVersion, currentVersion) > 0) {
          // New version available
          if (confirm(`New version ${latestVersion} available! Your version: ${currentVersion}. Open download page?`)) {
            chrome.tabs.create({ url: "https://github.com/akbarhlubis/rss-feed-extension/releases/latest" });
          }
        } else {
          // Version is up to date
          alert("You are using the latest version.");
        }
        
        // Reset button to normal
        checkUpdateBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i>';
        checkUpdateBtn.disabled = false;
      })
      .catch(error => {
        console.error("Error checking for updates:", error);
        alert("Failed to check for updates. Please try again later.");
        
        // Reset button to normal
        checkUpdateBtn.textContent = "Check for Update";
        checkUpdateBtn.disabled = false;
      });
  }
  
  function parseGithubReleaseFeed(xmlText) {
    // Parsing GitHub Releases Atom feed
    const entryMatch = /<entry>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<\/entry>/i.exec(xmlText);
    if (entryMatch && entryMatch[1]) {
      // Biasanya format title adalah "v1.0.0" atau hanya "1.0.0"
      const versionText = entryMatch[1].trim();
      // Remove 'v' prefix jika ada
      return versionText.startsWith('v') ? versionText.substring(1) : versionText;
    }
    return null;
  }
  
  function compareVersions(v1, v2) {
    // Split versi berdasarkan titik, lalu bandingkan numerik
    const v1parts = v1.split('.').map(Number);
    const v2parts = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
      const v1part = i < v1parts.length ? v1parts[i] : 0;
      const v2part = i < v2parts.length ? v2parts[i] : 0;
      
      if (v1part > v2part) return 1;
      if (v1part < v2part) return -1;
    }
    
    return 0; // Versi sama
  }

  // Helper: show version from manifest
  function displayVersion() {
    const manifest = chrome.runtime.getManifest();
    const versionElement = document.querySelector('.version');
    if (versionElement && manifest.version) {
      versionElement.textContent = `v${manifest.version}`;
    }
  }

  displayVersion();
});

// handle collapse/expand URLs section
document.getElementById('collapse-urls').addEventListener('click', function() {
  const urlsList = document.querySelector('#urls-list');
  if (urlsList.classList.contains('collapsed')) {
    urlsList.classList.remove('collapsed');
    this.textContent = 'Close';
  } else {
    urlsList.classList.add('collapsed');
    this.textContent = 'Open';
  }
});
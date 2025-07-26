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
                    `<li><a href="${i.link}" target="_blank">${i.title}</a></li>`
                  ).join('')
                : '<li><em>(belum ada data)</em></li>'
            }
          </ul>
        </div>
        <div class="btn-group">
          <button class="check-btn">Cek Sekarang</button>
          <button class="delete-btn">Delete</button>
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
});
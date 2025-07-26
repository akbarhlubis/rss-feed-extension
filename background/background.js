chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scheduleCheck') {
    scheduleCheck(message.url);
  } else if (message.action === 'cancelCheck') {
    cancelCheck(message.id);
  } else if (message.action === 'manualCheck') {
    checkUrl(message.id);
  }
});

// Alarm akan trigger checkUrl
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith('check_url_')) {
    const urlId = parseInt(alarm.name.split('_')[2]);
    checkUrl(urlId);
  }
});

function setupAlarms() {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    urls.forEach(url => {
      scheduleCheck(url);
    });
  });
}

function scheduleCheck(url) {
  const alarmName = `check_url_${url.id}`;
  chrome.alarms.create(alarmName, {
    delayInMinutes: url.interval,
    periodInMinutes: url.interval
  });
  // Cek awal langsung
  checkUrl(url.id);
}

function cancelCheck(id) {
  const alarmName = `check_url_${id}`;
  chrome.alarms.clear(alarmName);
}

function checkUrl(urlId) {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    const url = urls.find(u => u.id === urlId);
    if (!url) return;

    fetch(url.url)
      .then(response => response.text())
      .then(xmlText => {
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, 'application/xml');
        // Support Atom (entry) dan RSS (item)
        let entries = Array.from(xml.querySelectorAll('entry'));
        if (entries.length === 0) {
          entries = Array.from(xml.querySelectorAll('item'));
        }
        const latestItems = entries.slice(0, 3).map(entry => {
          // Atom
          const title = entry.querySelector('title')?.textContent || '';
          let link = '';
          if (entry.querySelector('link')) {
            link = entry.querySelector('link').getAttribute('href') || entry.querySelector('link').textContent || '';
          } else if (entry.querySelector('guid')) {
            link = entry.querySelector('guid').textContent || '';
          }
          const pubDate = entry.querySelector('updated')?.textContent ||
                          entry.querySelector('pubDate')?.textContent ||
                          '';
          return { title, link, pubDate };
        });

        // Deteksi perubahan: bandingkan title item terbaru
        let changed = false;
        if (latestItems.length > 0) {
          if (url.lastContent !== latestItems[0].title) {
            changed = !!url.lastContent; // Jangan notif pertama kali
            url.lastContent = latestItems[0].title;
          }
        }

        url.latestItems = latestItems;
        url.lastChecked = new Date().toISOString();

        // Update storage
        chrome.storage.local.set({ urls: urls }, () => {
          if (changed) {
            showNotification(url);
          }
        });
      })
      .catch(error => {
        console.error(`Error checking ${url?.url}:`, error);
      });
  });
}

function showNotification(url) {
  const latestTitle = url.latestItems && url.latestItems[0] ? url.latestItems[0].title : 'Ada konten baru!';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/assets/icon.png',
    title: url.name,
    message: latestTitle,
    priority: 1
  });
}
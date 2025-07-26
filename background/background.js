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

// Helper: Hilangkan tag HTML sederhana
function stripHtmlTags(str) {
  return str.replace(/<[^>]+>/g, '').trim();
}

function parseXML(xmlText) {
  const items = [];
  const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;

  while ((entryMatch = atomEntryRegex.exec(xmlText)) !== null) {
    const entryContent = entryMatch[1];

    // Title
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(entryContent);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Link
    const linkMatch = /<link[^>]*href="([^"]*)"[^>]*>/i.exec(entryContent);
    const link = linkMatch ? linkMatch[1] : '';

    // PubDate
    const dateMatch = /<(updated|published)[^>]*>([\s\S]*?)<\/(updated|published)>/i.exec(entryContent);
    const pubDate = dateMatch ? dateMatch[2].trim() : '';

    // Blockquote from Blockquote
    let blockquote = '';
    const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(entryContent);
    if (summaryMatch) {
      // Cari <div class="blockquote">...</div>
      const blockquoteMatch = /<div class="blockquote[^>]*>([\s\S]*?)<\/div>/i.exec(summaryMatch[1]);
      if (blockquoteMatch) {
        blockquote = blockquoteMatch[1].replace(/<[^>]+>/g, '').trim();
      }
    }

    items.push({ title, link, pubDate, blockquote });

    if (items.length >= 3) break;
  }

  return items;
}

function checkUrl(urlId) {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    const url = urls.find(u => u.id === urlId);
    if (!url) return;

    fetch(url.url)
      .then(response => response.text())
      .then(xmlText => {
        const latestItems = parseXML(xmlText);

        let changed = false;
        if (latestItems.length > 0) {
          if (url.lastContent !== latestItems[0].title) {
            changed = !!url.lastContent;
            url.lastContent = latestItems[0].title;
          }
        }

        url.latestItems = latestItems;
        url.lastChecked = new Date().toISOString();

        chrome.storage.local.set({ urls: urls }, () => {
          if (changed) {
            showNotification(url);
          }
        });
      })
      .catch(error => {
        console.error('Error checking', url?.url, ':', error);
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
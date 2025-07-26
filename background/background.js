chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  if (message.action === 'scheduleCheck') {
    scheduleCheck(message.url);
  } else if (message.action === 'cancelCheck') {
    cancelCheck(message.id);
  } else if (message.action === 'manualCheck') {
    console.log('Manual check triggered for ID:', message.id);
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

function parseXML(xmlText) {
  // Simple XML parsing dengan regex
  const items = [];
  
  // Untuk Atom Feed (seperti contoh yang kamu berikan)
  const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;
  
  while ((entryMatch = atomEntryRegex.exec(xmlText)) !== null) {
    const entryContent = entryMatch[1];
    
    // Parse title
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(entryContent);
    const title = titleMatch ? titleMatch[1].trim() : '';
    
    // Parse link (Atom format)
    const linkMatch = /<link[^>]*href="([^"]*)"[^>]*>/i.exec(entryContent);
    const link = linkMatch ? linkMatch[1] : '';
    
    // Parse updated atau published
    const dateMatch = /<(updated|published)[^>]*>([\s\S]*?)<\/(updated|published)>/i.exec(entryContent);
    const pubDate = dateMatch ? dateMatch[2].trim() : '';
    
    items.push({ title, link, pubDate });
    
    // Batas 3 item
    if (items.length >= 3) break;
  }
  
  // Jika tidak ada entry (mungkin RSS), coba parse item RSS
  if (items.length === 0) {
    const rssItemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch;
    
    while ((itemMatch = rssItemRegex.exec(xmlText)) !== null) {
      const itemContent = itemMatch[1];
      
      // Parse title
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(itemContent);
      const title = titleMatch ? titleMatch[1].trim() : '';
      
      // Parse link (RSS format)
      const linkMatch = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(itemContent);
      const link = linkMatch ? linkMatch[1].trim() : '';
      
      // Parse pubDate
      const pubDateMatch = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(itemContent);
      const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
      
      items.push({ title, link, pubDate });
      
      // Batas 3 item
      if (items.length >= 3) break;
    }
  }
  
  console.log('Parsed items:', items);
  return items;
}

function checkUrl(urlId) {
  console.log('checkUrl called for id:', urlId);
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    const url = urls.find(u => u.id === urlId);
    if (!url) {
      console.warn('URL not found for id:', urlId);
      return;
    }

    console.log('Fetching:', url.url);
    fetch(url.url)
      .then(response => {
        console.log('Fetch response status:', response.status);
        return response.text();
      })
      .then(xmlText => {
        console.log('Fetched XML text length:', xmlText.length);
        
        // Menggunakan parser regex custom
        const latestItems = parseXML(xmlText);
        console.log('Parsed latest items:', latestItems);
        
        // Deteksi perubahan
        let changed = false;
        if (latestItems.length > 0) {
          if (url.lastContent !== latestItems[0].title) {
            changed = !!url.lastContent;
            url.lastContent = latestItems[0].title;
            console.log('Content changed:', changed);
          }
        }

        url.latestItems = latestItems;
        url.lastChecked = new Date().toISOString();

        chrome.storage.local.set({ urls: urls }, () => {
          console.log('Storage updated with new items');
          if (changed) {
            showNotification(url);
          }
        });
      })
      .catch(error => {
        console.error('Error checking', url.url, ':', error);
      });
  });
}

function showNotification(url) {
  const latestTitle = url.latestItems && url.latestItems[0] ? url.latestItems[0].title : 'Ada konten baru!';
  console.log('Showing notification:', url.name, latestTitle);
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/assets/icon.png',
    title: url.name,
    message: latestTitle,
    priority: 1
  });
}
// Initialize when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scheduleCheck') {
    scheduleCheck(message.url);
  } else if (message.action === 'cancelCheck') {
    cancelCheck(message.id);
  }
});

// Handle alarm events (triggered when it's time to check a URL)
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith('check_url_')) {
    const urlId = parseInt(alarm.name.split('_')[2]);
    checkUrl(urlId);
  }
});

// Set up alarms for all URLs in storage
function setupAlarms() {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    
    urls.forEach(url => {
      scheduleCheck(url);
    });
  });
}

// Schedule a check for a URL
function scheduleCheck(url) {
  const alarmName = `check_url_${url.id}`;
  
  chrome.alarms.create(alarmName, {
    delayInMinutes: url.interval,
    periodInMinutes: url.interval
  });
  
  // Also check immediately
  checkUrl(url.id);
}

// Cancel a check for a URL
function cancelCheck(id) {
  const alarmName = `check_url_${id}`;
  chrome.alarms.clear(alarmName);
}

// Check a URL for changes
function checkUrl(urlId) {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    const url = urls.find(u => u.id === urlId);
    
    if (!url) {
      return; // URL not found
    }
    
    // Fetch the URL content
    fetch(url.url)
      .then(response => response.text())
      .then(html => {
        let content = html;
        
        // If a selector is specified, extract only that content
        if (url.selector) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const selectedElement = doc.querySelector(url.selector);
          
          if (selectedElement) {
            content = selectedElement.textContent.trim();
          }
        }
        
        // Check if the content has changed
        if (url.lastContent && url.lastContent !== content) {
          showNotification(url);
        }
        
        // Update the URL data
        url.lastChecked = new Date().toISOString();
        url.lastContent = content;
        
        // Save back to storage
        chrome.storage.local.set({ urls: urls });
      })
      .catch(error => {
        console.error(`Error checking ${url.url}:`, error);
      });
  });
}

// Show a notification when content changes
function showNotification(url) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/assets/icon.png',
    title: 'Content Changed: ' + url.name,
    message: `The content at ${url.name} has changed.`,
    buttons: [
      { title: 'View' }
    ],
    priority: 0
  });
}

// Handle notification clicks
chrome.notifications.onClicked.addListener(notificationId => {
  // Open the URL in a new tab
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    const url = urls.find(u => notificationId.includes(u.id.toString()));
    
    if (url) {
      chrome.tabs.create({ url: url.url });
    }
  });
});
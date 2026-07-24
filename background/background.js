chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scheduleCheck') {
    scheduleCheck(message.url);
  } else if (message.action === 'cancelCheck') {
    cancelCheck(message.id);
  } else if (message.action === 'manualCheck') {
    checkUrl(message.id);
  } else if (message.action === 'pauseCheck') {
    cancelCheck(message.id);
  } else if (message.action === 'resumeCheck') {
    chrome.storage.local.get('urls', data => {
      const url = (data.urls || []).find(u => u.id === message.id);
      if (url) scheduleCheck(url);
    });
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name.startsWith('check_url_')) {
    const urlId = parseInt(alarm.name.split('_')[2], 10);
    checkUrl(urlId);
  }
});

// Handle notification clicks — open the latest article link
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith('rss_')) return;

  const urlId = parseInt(notificationId.split('_')[1], 10);
  if (isNaN(urlId)) return;

  chrome.storage.local.get('urls', (data) => {
    const urls = data.urls || [];
    const url = urls.find(u => u.id === urlId);
    const link = url?.latestItems?.[0]?.link;

    if (link && (link.startsWith('http://') || link.startsWith('https://'))) {
      chrome.tabs.create({ url: link });
    } else {
      // Fallback: open the feed source URL
      if (url?.url) chrome.tabs.create({ url: url.url });
    }
  });

  // Dismiss the notification after click
  chrome.notifications.clear(notificationId);
});

function setupAlarms() {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    urls.forEach(url => {
      if (!url.isPaused) {
        scheduleCheck(url);
      }
    });
  });
}

function scheduleCheck(url) {
  if (url.isPaused) return;
  const alarmName = `check_url_${url.id}`;
  chrome.alarms.create(alarmName, {
    delayInMinutes: url.interval,
    periodInMinutes: url.interval
  });
  // check immediately after scheduling
  checkUrl(url.id);
}

function cancelCheck(id) {
  const alarmName = `check_url_${id}`;
  chrome.alarms.clear(alarmName);
}

// Helper: Remove HTML tags and trim whitespace
function stripHtmlTags(str) {
  if (!str) return '';
  return str.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')  // Handle CDATA
           .replace(/&lt;/g, '<')
           .replace(/&gt;/g, '>')
           .replace(/&quot;/g, '"')
           .replace(/&amp;/g, '&')
           .replace(/<[^>]+>/g, '')
           .trim();
}

function parseXML(xmlText) {
  const items = [];

  // ── Format detection ────────────────────────────────────────────
  // Atom: has <feed ...> root OR <entry> elements
  const isAtom = /<feed[\s>]/i.test(xmlText) || xmlText.includes('<entry>');

  // RSS 1.0/RDF: has <rdf:RDF root (Steam Daily Deals, etc.)
  // Items are tagged <item rdf:about="..."> — NOT naked <item>
  const isRDF = /<rdf:RDF[\s>]/i.test(xmlText);

  // RSS 2.0: has <rss or naked <item> (and is not RDF/Atom)
  const isRSS2 = !isAtom && !isRDF && (/<rss[\s>]/i.test(xmlText) || xmlText.includes('<item>'));

  if (!isAtom && !isRDF && !isRSS2) {
    console.error('Unrecognized feed format: not Atom, RSS 2.0, or RSS 1.0/RDF');
    return items;
  }

  // ── Atom ────────────────────────────────────────────────────────
  if (isAtom) {
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    let match;

    while ((match = entryRegex.exec(xmlText)) !== null) {
      const c = match[1];

      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(c);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : '';

      // Atom link: prefer href attribute, fallback to text content
      const linkAttr = /<link[^>]*\bhref="([^"]*)"[^>]*>/i.exec(c);
      const linkText = !linkAttr ? /<link[^>]*>([\s\S]*?)<\/link>/i.exec(c) : null;
      const link = linkAttr ? linkAttr[1] : (linkText ? linkText[1].trim() : '');

      const dateMatch = /<(?:updated|published)[^>]*>([\s\S]*?)<\/(?:updated|published)>/i.exec(c);
      const pubDate = dateMatch ? dateMatch[1].trim() : '';

      const summaryMatch = /<summary[\s\S]*?>([\s\S]*?)<\/summary>/i.exec(c);
      let blockquote = summaryMatch ? stripHtmlTags(summaryMatch[1]) : '';

      const authorMatch = /<author[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i.exec(c);
      const author = authorMatch ? stripHtmlTags(authorMatch[1]) : '';

      items.push({ title, link, pubDate, author, blockquote });
      if (items.length >= 3) break;
    }
  }

  // ── RSS 1.0 / RDF ───────────────────────────────────────────────
  // Items use <item rdf:about="URL"> ... </item>
  else if (isRDF) {
    // Match <item ...> with any attributes (rdf:about etc.)
    const itemRegex = /<item[\s][^>]*>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const c = match[1];

      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(c);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : '';

      // RDF link is usually in <link> text content
      const linkMatch = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(c);
      const link = linkMatch ? linkMatch[1].trim() : '';

      const dateMatch = /<(?:dc:date|pubDate)[^>]*>([\s\S]*?)<\/(?:dc:date|pubDate)>/i.exec(c);
      const pubDate = dateMatch ? dateMatch[1].trim() : '';

      const descMatch = /<description[^>]*>([\s\S]*?)<\/description>/i.exec(c);
      const blockquote = descMatch ? stripHtmlTags(descMatch[1]) : '';

      const dcCreator = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(c);
      const author = dcCreator ? stripHtmlTags(dcCreator[1]) : '';

      items.push({ title, link, pubDate, author, blockquote });
      if (items.length >= 3) break;
    }
  }

  // ── RSS 2.0 ─────────────────────────────────────────────────────
  else if (isRSS2) {
    // Match both naked <item> and <item ...attributes...>
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const c = match[1];

      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(c);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : '';

      const linkMatch = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(c);
      const link = linkMatch ? linkMatch[1].trim() : '';

      const dateMatch = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(c);
      const pubDate = dateMatch ? dateMatch[1].trim() : '';

      const descMatch = /<description[^>]*>([\s\S]*?)<\/description>/i.exec(c);
      const blockquote = descMatch ? stripHtmlTags(descMatch[1]) : '';

      const dcCreatorMatch = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(c);
      const authorMatch    = /<author[^>]*>([\s\S]*?)<\/author>/i.exec(c);
      const author = dcCreatorMatch
        ? stripHtmlTags(dcCreatorMatch[1])
        : (authorMatch ? stripHtmlTags(authorMatch[1]) : '');

      items.push({ title, link, pubDate, author, blockquote });
      if (items.length >= 3) break;
    }
  }

  return items;
}

function checkUrl(urlId) {
  // Single storage read — no need for a double-read anti-pattern
  chrome.storage.local.get('urls', freshData => {
    const freshUrls = freshData.urls || [];
    const freshUrl = freshUrls.find(u => u.id === urlId);
    if (!freshUrl || freshUrl.isPaused) return;

      freshUrl.isChecking = true;
      chrome.storage.local.set({ urls: freshUrls }, () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        fetch(freshUrl.url, { signal: controller.signal })
          .then(response => {
            clearTimeout(timeoutId);
            return response.text();
          })
          .then(xmlText => {
            const latestItems = parseXML(xmlText);

            chrome.storage.local.get('urls', newestData => {
              const newestUrls = newestData.urls || [];
              const newestUrl = newestUrls.find(u => u.id === urlId);
              if (!newestUrl) return;

              let hasNewContent = false;

              if (latestItems.length > 0) {
                const newTitle = latestItems[0].title;
                const oldTitle = newestUrl.lastContent;

                if (oldTitle && newTitle && oldTitle !== newTitle) {
                  hasNewContent = true;
                  console.log('New content detected for:', newestUrl.name);
                  console.log('Old:', oldTitle);
                  console.log('New:', newTitle);
                }

                newestUrl.lastContent = newTitle;
              }

              newestUrl.latestItems = latestItems;
              newestUrl.lastChecked = new Date().toISOString();
              newestUrl.isChecking = false;
              newestUrl.hasNew = hasNewContent ? true : (newestUrl.hasNew || false);
              newestUrl.isError = false;

              chrome.storage.local.set({ urls: newestUrls }, () => {
                if (hasNewContent) {
                  showNotification(newestUrl);
                }
              });
            });
          })
          .catch(error => {
            clearTimeout(timeoutId);
            const isTimeout = error.name === 'AbortError';
            console.error('Error checking', freshUrl.url, ':', isTimeout ? 'Timeout (30s)' : error);

            chrome.storage.local.get('urls', errorData => {
              const errorUrls = errorData.urls || [];
              const errorUrl = errorUrls.find(u => u.id === urlId);
              if (errorUrl) {
                errorUrl.isChecking = false;
                errorUrl.isError = true;
                errorUrl.lastError = isTimeout ? 'Timeout' : error.message;
                chrome.storage.local.set({ urls: errorUrls });
              }
            });
          });
      });
  });
}

function showNotification(url) {
  const latestTitle = url.latestItems && url.latestItems[0] ? url.latestItems[0].title : 'Ada konten baru!';
  const notificationId = `rss_${url.id}_${Date.now()}`;
  
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: '/assets/icon48.png',
    title: `📰 ${url.name}`,
    message: latestTitle,
    priority: 1
  });

  updateBadgeCount();

  console.log('Notification shown for:', url.name, '- Title:', latestTitle);
}

function updateBadgeCount() {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    const newCount = urls.filter(u => u.hasNew).length;
    const badgeText = newCount > 0 ? String(newCount) : '';
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  });
}
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
  let isAtom = xmlText.includes('<entry>');
  let isRSS = xmlText.includes('<item>');
  
  if (!isAtom && !isRSS) {
    console.error('Format tidak dikenali: bukan RSS atau Atom');
    return items;
  }

  // if format is Atom
  if (isAtom) {
    const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let entryMatch;

    while ((entryMatch = atomEntryRegex.exec(xmlText)) !== null) {
      const entryContent = entryMatch[1];

      // Title
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(entryContent);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : '';

      // Link
      const linkMatch = /<link[^>]*href="([^"]*)"[^>]*>/i.exec(entryContent);
      const link = linkMatch ? linkMatch[1] : '';

      // PubDate
      const dateMatch = /<(updated|published)[^>]*>([\s\S]*?)<\/(updated|published)>/i.exec(entryContent);
      const pubDate = dateMatch ? dateMatch[2].trim() : '';

      // Author & Blockquote
      let blockquote = '';
      let author = '';
      const summaryMatch = /<summary[\s\S]*?>([\s\S]*?)<\/summary>/i.exec(entryContent);
      if (summaryMatch) {
        // looking for <div class="blockquote">...</div>
        const blockquoteMatch = /<div class="blockquote[^>]*>([\s\S]*?)<\/div>/i.exec(summaryMatch[1]);
        if (blockquoteMatch) {
          blockquote = stripHtmlTags(blockquoteMatch[1]);

          // Take <strong>...</strong>
          const strongMatch = /<strong[^>]*>(.*?)<\/strong>/i.exec(summaryMatch[1]);
          if (strongMatch) {
            author = stripHtmlTags(strongMatch[1]);
          }
        }
      }

      // If author is not found in blockquote, try to find it in author tag
      if (!author) {
        const authorMatch = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i.exec(entryContent);
        if (authorMatch) {
          author = stripHtmlTags(authorMatch[1]);
        }
      }

      items.push({ title, link, pubDate, author, blockquote });

      if (items.length >= 3) break;
    }
  }

  // If format is RSS
  else if (isRSS) {
    const rssItemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch;

    while ((itemMatch = rssItemRegex.exec(xmlText)) !== null) {
      const itemContent = itemMatch[1];

      // Title
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(itemContent);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : '';

      // Link
      const linkMatch = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(itemContent);
      const link = linkMatch ? linkMatch[1].trim() : '';

      // PubDate - RSS using format RFC 822
      const dateMatch = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(itemContent);
      const pubDate = dateMatch ? dateMatch[1].trim() : '';

      // Description as blockquote
      let blockquote = '';
      const descMatch = /<description[^>]*>([\s\S]*?)<\/description>/i.exec(itemContent);
      if (descMatch) {
        blockquote = stripHtmlTags(descMatch[1]);
      }

      // Author - RSS can use <dc:creator> or <author>
      let author = '';
      const dcCreatorMatch = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(itemContent);
      if (dcCreatorMatch) {
        author = stripHtmlTags(dcCreatorMatch[1]);
      } else {
        const authorMatch = /<author[^>]*>([\s\S]*?)<\/author>/i.exec(itemContent);
        if (authorMatch) {
          author = stripHtmlTags(authorMatch[1]);
        }
      }

      items.push({ title, link, pubDate, author, blockquote });

      if (items.length >= 3) break;
    }
  }

  return items;
}

function checkUrl(urlId) {
  chrome.storage.local.get('urls', data => {
    const urls = data.urls || [];
    const url = urls.find(u => u.id === urlId);
    if (!url) return;

    // Prevent multiple simultaneous checks for same URL using atomic update
    chrome.storage.local.get('urls', freshData => {
      const freshUrls = freshData.urls || [];
      const freshUrl = freshUrls.find(u => u.id === urlId);
      if (!freshUrl) return;

      if (freshUrl.isChecking) {
        console.log('Check already in progress for URL:', freshUrl.name);
        return;
      }

      // Mark as checking
      freshUrl.isChecking = true;
      chrome.storage.local.set({ urls: freshUrls }, () => {
        fetch(freshUrl.url)
          .then(response => response.text())
          .then(xmlText => {
            const latestItems = parseXML(xmlText);

            // Get fresh data to avoid race conditions
            chrome.storage.local.get('urls', newestData => {
              const newestUrls = newestData.urls || [];
              const newestUrl = newestUrls.find(u => u.id === urlId);
              if (!newestUrl) return;

              let hasNewContent = false;

              if (latestItems.length > 0) {
                const newTitle = latestItems[0].title;
                const oldTitle = newestUrl.lastContent;

                // Only trigger notification if:
                // 1. We have a previous title to compare with
                // 2. The new title is different from the old one
                // 3. The new title is not empty
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
              newestUrl.isChecking = false; // Clear checking flag

              chrome.storage.local.set({ urls: newestUrls }, () => {
                if (hasNewContent) {
                  showNotification(newestUrl);
                }
              });
            });
          })
          .catch(error => {
            console.error('Error checking', freshUrl.url, ':', error);

            // Clear checking flag on error
            chrome.storage.local.get('urls', errorData => {
              const errorUrls = errorData.urls || [];
              const errorUrl = errorUrls.find(u => u.id === urlId);
              if (errorUrl) {
                errorUrl.isChecking = false;
                chrome.storage.local.set({ urls: errorUrls });
              }
            });
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

  console.log('Notification shown for:', url.name, '- Title:', latestTitle);
}
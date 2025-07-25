document.addEventListener('DOMContentLoaded', function() {
  const addUrlForm = document.getElementById('add-url-form');
  const urlsList = document.getElementById('urls-list');
  
  // Load existing URLs
  loadUrls();
  
  // Add URL form submission
  addUrlForm.addEventListener('submit', function(event) {
    event.preventDefault();
    
    const url = document.getElementById('url-input').value;
    const name = document.getElementById('name-input').value;
    const interval = parseInt(document.getElementById('interval-input').value);
    const selector = document.getElementById('selector-input').value;
    
    if (url && name && interval) {
      addUrl(url, name, interval, selector);
      addUrlForm.reset();
    }
  });
  
  // Load URLs from storage
  function loadUrls() {
    chrome.storage.local.get('urls', function(data) {
      const urls = data.urls || [];
      displayUrls(urls);
    });
  }
  
  // Add a URL to storage
  function addUrl(url, name, interval, selector) {
    chrome.storage.local.get('urls', function(data) {
      const urls = data.urls || [];
      
      // Create a new URL object
      const newUrl = {
        id: Date.now(),
        url: url,
        name: name,
        interval: interval,
        selector: selector,
        lastChecked: null,
        lastContent: null
      };
      
      // Add it to the array
      urls.push(newUrl);
      
      // Save back to storage
      chrome.storage.local.set({ urls: urls }, function() {
        // Update the display
        displayUrls(urls);
        
        // Schedule the check
        chrome.runtime.sendMessage({ 
          action: 'scheduleCheck', 
          url: newUrl 
        });
      });
    });
  }
  
  // Delete a URL from storage
  function deleteUrl(id) {
    chrome.storage.local.get('urls', function(data) {
      const urls = data.urls || [];
      
      // Find the URL with this ID
      const updatedUrls = urls.filter(item => item.id !== id);
      
      // Save back to storage
      chrome.storage.local.set({ urls: updatedUrls }, function() {
        // Update the display
        displayUrls(updatedUrls);
        
        // Cancel the check
        chrome.runtime.sendMessage({ 
          action: 'cancelCheck', 
          id: id 
        });
      });
    });
  }
  
  // Display URLs in the UI
  function displayUrls(urls) {
    urlsList.innerHTML = '';
    
    if (urls.length === 0) {
      urlsList.innerHTML = '<div class="no-urls">No URLs added yet.</div>';
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
        <div class="url-details">Check every ${item.interval} minutes</div>
        <div class="url-details">Last checked: ${lastCheckedText}</div>
        <button class="delete-btn">Delete</button>
      `;
      
      const deleteBtn = urlItem.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', function() {
        deleteUrl(item.id);
      });
      
      urlsList.appendChild(urlItem);
    });
  }
});
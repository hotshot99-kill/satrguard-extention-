class PopupManager {
  constructor() {
    this.currentTab = null;
    this.settings = {};
    this.temporaryPermissions = new Map();
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.getCurrentTab();
    this.setupEventListeners();
    this.updateUI();
    this.loadRecentActivity();
    setInterval(() => this.updateUI(), 1000); // Update every second
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get({
      webcamBlocked: true,
      micBlocked: true,
      showNotifications: true,
      logActivity: true,
      autoBlockBackground: true,
      fakeMediaEnabled: false
    });
    this.settings = result;
  }

  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    this.currentTab = tab;
    this.updateSiteInfo();
  }

  updateSiteInfo() {
    if (!this.currentTab) return;
    
    const url = new URL(this.currentTab.url);
    const siteName = url.hostname;
    
    document.getElementById('siteName').textContent = siteName;
    
    // Check if site has temporary permissions
    const sitePerms = this.temporaryPermissions.get(siteName);
    if (sitePerms && sitePerms.expiry > Date.now()) {
      const devices = [];
      if (sitePerms.webcam) devices.push('Webcam');
      if (sitePerms.microphone) devices.push('Microphone');
      document.getElementById('sitePermissions').textContent = 
        `Temporary access: ${devices.join(', ')} (${this.formatTimeRemaining(sitePerms.expiry)})`;
    } else {
      document.getElementById('sitePermissions').textContent = 'No active permissions';
    }
  }

  formatTimeRemaining(expiry) {
    const remaining = Math.max(0, expiry - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  setupEventListeners() {
    // Toggle switches
    document.getElementById('webcamToggle').addEventListener('change', (e) => {
      this.settings.webcamBlocked = !e.target.checked;
      this.saveSettings();
      this.updateUI();
    });

    document.getElementById('micToggle').addEventListener('change', (e) => {
      this.settings.micBlocked = !e.target.checked;
      this.saveSettings();
      this.updateUI();
    });

    // Quick action buttons
    document.getElementById('temporaryAccessBtn').addEventListener('click', () => {
      this.showTemporaryAccessModal();
    });

    document.getElementById('fakeMediaBtn').addEventListener('click', () => {
      this.toggleFakeMedia();
    });

    // Footer buttons
    document.getElementById('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    document.getElementById('logsBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('logs.html') });
    });

    document.getElementById('siteSettingsBtn').addEventListener('click', () => {
      this.showSiteSettings();
    });

    // Modal event listeners
    this.setupModalListeners();
  }

  setupModalListeners() {
    const modal = document.getElementById('tempAccessModal');
    const closeBtn = document.getElementById('closeTempModal');
    const cancelBtn = document.getElementById('cancelTemp');
    const grantBtn = document.getElementById('grantTemp');

    closeBtn.addEventListener('click', () => this.hideModal());
    cancelBtn.addEventListener('click', () => this.hideModal());
    grantBtn.addEventListener('click', () => this.grantTemporaryAccess());

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hideModal();
    });
  }

  async saveSettings() {
    await chrome.storage.sync.set(this.settings);
    // Notify content script of changes
    if (this.currentTab) {
      chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'updateSettings',
        settings: this.settings
      }).catch(() => {}); // Ignore errors if content script not ready
    }
  }

  updateUI() {
    // Update toggle states
    document.getElementById('webcamToggle').checked = !this.settings.webcamBlocked;
    document.getElementById('micToggle').checked = !this.settings.micBlocked;

    // Update device status
    document.getElementById('webcamStatus').textContent = 
      this.settings.webcamBlocked ? 'Blocked' : 'Allowed';
    document.getElementById('micStatus').textContent = 
      this.settings.micBlocked ? 'Blocked' : 'Allowed';

    // Update overall status
    const isProtected = this.settings.webcamBlocked && this.settings.micBlocked;
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const statusDot = statusIndicator.querySelector('.status-dot');

    if (isProtected) {
      statusText.textContent = 'Protected';
      statusDot.className = 'status-dot protected';
    } else if (!this.settings.webcamBlocked && !this.settings.micBlocked) {
      statusText.textContent = 'Unprotected';
      statusDot.className = 'status-dot danger';
    } else {
      statusText.textContent = 'Partial';
      statusDot.className = 'status-dot warning';
    }

    // Update fake media button
    const fakeBtn = document.getElementById('fakeMediaBtn');
    if (this.settings.fakeMediaEnabled) {
      fakeBtn.style.background = 'var(--gradient-secondary)';
      fakeBtn.style.color = 'white';
    } else {
      fakeBtn.style.background = '';
      fakeBtn.style.color = '';
    }

    this.updateSiteInfo();
  }

  async loadRecentActivity() {
    const result = await chrome.storage.local.get(['activityLog']);
    const activities = result.activityLog || [];
    
    const activityList = document.getElementById('activityList');
    
    if (activities.length === 0) {
      activityList.innerHTML = `
        <div class="activity-item">
          <div class="activity-icon">ℹ️</div>
          <div class="activity-details">
            <div class="activity-text">No recent activity</div>
            <div class="activity-time">-</div>
          </div>
        </div>
      `;
      return;
    }

    // Show last 3 activities
    const recentActivities = activities.slice(-3).reverse();
    activityList.innerHTML = recentActivities.map(activity => {
      const timeAgo = this.getTimeAgo(activity.timestamp);
      const iconMap = {
        'blocked': '🔒',
        'allowed': '✅',
        'fake': '🎭'
      };
      
      return `
        <div class="activity-item ${activity.action}">
          <div class="activity-icon">${iconMap[activity.action] || '📱'}</div>
          <div class="activity-details">
            <div class="activity-text">${activity.site} requested ${activity.device}</div>
            <div class="activity-time">${timeAgo}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  showTemporaryAccessModal() {
    document.getElementById('tempAccessModal').classList.add('show');
  }

  hideModal() {
    document.getElementById('tempAccessModal').classList.remove('show');
  }

  async grantTemporaryAccess() {
    const webcamChecked = document.getElementById('tempWebcam').checked;
    const micChecked = document.getElementById('tempMic').checked;
    const duration = parseInt(document.getElementById('tempDuration').value);

    if (!webcamChecked && !micChecked) {
      alert('Please select at least one device to grant access to.');
      return;
    }

    if (!this.currentTab) return;

    const url = new URL(this.currentTab.url);
    const siteName = url.hostname;
    const expiry = Date.now() + (duration * 60 * 1000);

    // Store temporary permission
    this.temporaryPermissions.set(siteName, {
      webcam: webcamChecked,
      microphone: micChecked,
      expiry: expiry
    });

    // Save to storage
    const tempPermsObject = Object.fromEntries(this.temporaryPermissions);
    await chrome.storage.local.set({ temporaryPermissions: tempPermsObject });

    // Notify content script
    chrome.tabs.sendMessage(this.currentTab.id, {
      action: 'temporaryAccess',
      permissions: {
        webcam: webcamChecked,
        microphone: micChecked,
        expiry: expiry
      }
    }).catch(() => {});

    // Log activity
    await this.logActivity(siteName, 'allowed', webcamChecked ? 'webcam' : 'microphone');

    this.hideModal();
    this.updateUI();

    // Set timer to update UI when permission expires
    setTimeout(() => this.updateUI(), duration * 60 * 1000);
  }

  async toggleFakeMedia() {
    this.settings.fakeMediaEnabled = !this.settings.fakeMediaEnabled;
    await this.saveSettings();
    this.updateUI();

    // Notify content script
    if (this.currentTab) {
      chrome.tabs.sendMessage(this.currentTab.id, {
        action: 'toggleFakeMedia',
        enabled: this.settings.fakeMediaEnabled
      }).catch(() => {});
    }
  }

  async logActivity(site, action, device) {
    const result = await chrome.storage.local.get(['activityLog']);
    const activities = result.activityLog || [];
    
    activities.push({
      timestamp: Date.now(),
      site: site,
      action: action,
      device: device
    });

    // Keep only last 100 activities
    if (activities.length > 100) {
      activities.splice(0, activities.length - 100);
    }

    await chrome.storage.local.set({ activityLog: activities });
    this.loadRecentActivity();
  }

  showSiteSettings() {
    if (!this.currentTab) return;
    
    const url = new URL(this.currentTab.url);
    const siteName = url.hostname;
    
    // For now, just show an alert. In a full implementation, 
    // this would open a detailed site settings modal
    alert(`Site-specific settings for ${siteName} would open here. This feature can be expanded to include per-site permissions, whitelist/blacklist management, etc.`);
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'accessAttempt') {
    // Refresh activity when new access attempt is logged
    setTimeout(() => {
      const popup = document.querySelector('.popup');
      if (popup) {
        // Reload recent activity
        window.location.reload();
      }
    }, 100);
  }
});
class BackgroundManager {
  constructor() {
    this.settings = {};
    this.temporaryPermissions = new Map();
    this.activePermissions = new Map();
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadTemporaryPermissions();
    this.setupEventListeners();
    this.setupAlarms();
    
    // Clean up expired permissions on startup
    this.cleanupExpiredPermissions();
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get({
      webcamBlocked: true,
      micBlocked: true,
      showNotifications: true,
      logActivity: true,
      autoBlockBackground: true,
      fakeMediaEnabled: false,
      notificationSound: true
    });
    this.settings = result;
  }

  async loadTemporaryPermissions() {
    const result = await chrome.storage.local.get(['temporaryPermissions']);
    if (result.temporaryPermissions) {
      this.temporaryPermissions = new Map(Object.entries(result.temporaryPermissions));
      this.cleanupExpiredPermissions();
    }
  }

  setupEventListeners() {
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep the message channel open for async responses
    });

    // Listen for tab updates to inject content script
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        this.injectContentScript(tabId, tab.url);
      }
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync') {
        this.loadSettings();
      }
    });

    // Listen for tab activation to check background tab access
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      if (this.settings.autoBlockBackground) {
        await this.blockBackgroundTabAccess(activeInfo.tabId);
      }
    });
  }

  setupAlarms() {
    // Set up periodic cleanup alarm
    chrome.alarms.create('cleanupPermissions', { periodInMinutes: 5 });
    
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'cleanupPermissions') {
        this.cleanupExpiredPermissions();
      }
    });
  }

  async injectContentScript(tabId, url) {
    try {
      // Skip non-http(s) URLs
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });

      // Send current settings to the newly injected script
      chrome.tabs.sendMessage(tabId, {
        action: 'updateSettings',
        settings: this.settings
      }).catch(() => {}); // Ignore errors if tab is closed

    } catch (error) {
      console.log('Failed to inject content script:', error);
    }
  }

  async handleMessage(message, sender, sendResponse) {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url;
    const hostname = url ? new URL(url).hostname : 'unknown';

    switch (message.action) {
      case 'accessAttempt':
        await this.handleAccessAttempt(message, hostname, tabId);
        break;
      
      case 'checkPermissions':
        const permissions = await this.checkSitePermissions(hostname, message.isBackground);
        sendResponse(permissions);
        break;
      
      case 'logActivity':
        await this.logActivity(hostname, message.actionType, message.device);
        break;
      
      case 'getSettings':
        sendResponse(this.settings);
        break;
    }
  }

  async handleAccessAttempt(message, hostname, tabId) {
    const isBackground = message.isBackground;
    const device = message.device;
    const action = message.actionType;

    // Log the attempt
    await this.logActivity(hostname, action, device);

    // Show notification if enabled
    if (this.settings.showNotifications) {
      await this.showNotification(hostname, device, action, isBackground);
    }

    // Update badge if this is an active tab
    this.updateBadge(tabId, action);

    // Notify popup to refresh if open
    try {
      await chrome.runtime.sendMessage({
        action: 'accessAttempt',
        site: hostname,
        device: device,
        actionType: action
      });
    } catch (error) {
      // Popup not open, ignore
    }
  }

  async checkSitePermissions(hostname, isBackground) {
    // Check if auto-block background tabs is enabled
    if (isBackground && this.settings.autoBlockBackground) {
      return {
        webcamAllowed: false,
        microphoneAllowed: false,
        reason: 'backgroundTab'
      };
    }

    // Check temporary permissions
    const tempPerms = this.temporaryPermissions.get(hostname);
    if (tempPerms && tempPerms.expiry > Date.now()) {
      return {
        webcamAllowed: tempPerms.webcam && !this.settings.webcamBlocked,
        microphoneAllowed: tempPerms.microphone && !this.settings.micBlocked,
        reason: 'temporary',
        expiry: tempPerms.expiry
      };
    }

    // Check global settings
    return {
      webcamAllowed: !this.settings.webcamBlocked,
      microphoneAllowed: !this.settings.micBlocked,
      reason: 'global'
    };
  }

  async showNotification(hostname, device, action, isBackground) {
    const icons = {
      blocked: '🔒',
      allowed: '✅',
      fake: '🎭'
    };

    const messages = {
      blocked: `${icons.blocked} ${hostname} was blocked from accessing your ${device}`,
      allowed: `${icons.allowed} ${hostname} was granted access to your ${device}`,
      fake: `${icons.fake} ${hostname} is receiving fake ${device} data`
    };

    let message = messages[action] || `${hostname} attempted to access your ${device}`;
    
    if (isBackground) {
      message += ' (background tab)';
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Privacy Guard',
      message: message,
      priority: action === 'blocked' ? 2 : 1
    });
  }

  updateBadge(tabId, action) {
    const badgeConfig = {
      blocked: { text: '🔒', color: '#ef4444' },
      allowed: { text: '✅', color: '#10b981' },
      fake: { text: '🎭', color: '#f59e0b' }
    };

    const config = badgeConfig[action];
    if (config) {
      chrome.action.setBadgeText({ text: config.text, tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: config.color, tabId: tabId });
      
      // Clear badge after 3 seconds
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId: tabId });
      }, 3000);
    }
  }

  async logActivity(hostname, action, device) {
    if (!this.settings.logActivity) return;

    const result = await chrome.storage.local.get(['activityLog']);
    const activities = result.activityLog || [];
    
    activities.push({
      timestamp: Date.now(),
      site: hostname,
      action: action,
      device: device,
      userAgent: navigator.userAgent
    });

    // Keep only last 1000 activities
    if (activities.length > 1000) {
      activities.splice(0, activities.length - 1000);
    }

    await chrome.storage.local.set({ activityLog: activities });
  }

  async blockBackgroundTabAccess(activeTabId) {
    try {
      const tabs = await chrome.tabs.query({});
      const backgroundTabs = tabs.filter(tab => tab.id !== activeTabId && 
        (tab.url.startsWith('http://') || tab.url.startsWith('https://')));
      
      for (const tab of backgroundTabs) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'setBackground',
          isBackground: true
        }).catch(() => {}); // Ignore errors for tabs without content script
      }

      // Mark active tab as foreground
      chrome.tabs.sendMessage(activeTabId, {
        action: 'setBackground',
        isBackground: false
      }).catch(() => {});

    } catch (error) {
      console.log('Error managing background tab access:', error);
    }
  }

  cleanupExpiredPermissions() {
    const now = Date.now();
    let hasExpired = false;

    for (const [site, perms] of this.temporaryPermissions.entries()) {
      if (perms.expiry <= now) {
        this.temporaryPermissions.delete(site);
        hasExpired = true;
      }
    }

    if (hasExpired) {
      // Save updated permissions
      const tempPermsObject = Object.fromEntries(this.temporaryPermissions);
      chrome.storage.local.set({ temporaryPermissions: tempPermsObject });
    }
  }

  // Advanced feature: Detect suspicious patterns
  async detectSuspiciousActivity() {
    const result = await chrome.storage.local.get(['activityLog']);
    const activities = result.activityLog || [];
    
    // Look for patterns in the last hour
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentActivities = activities.filter(a => a.timestamp > oneHourAgo);
    
    // Check for multiple rapid requests from same site
    const siteCounts = {};
    for (const activity of recentActivities) {
      siteCounts[activity.site] = (siteCounts[activity.site] || 0) + 1;
    }
    
    // Alert if any site has made more than 10 requests in an hour
    for (const [site, count] of Object.entries(siteCounts)) {
      if (count > 10) {
        this.showSuspiciousActivityAlert(site, count);
      }
    }
  }

  async showSuspiciousActivityAlert(site, count) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '⚠️ Privacy Guard - Suspicious Activity',
      message: `${site} has made ${count} access attempts in the last hour. This might indicate tracking behavior.`,
      priority: 2,
      buttons: [
        { title: 'Block Site' },
        { title: 'Ignore' }
      ]
    });
  }
}

// Initialize background manager
const backgroundManager = new BackgroundManager();

// Export for testing purposes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BackgroundManager;
}
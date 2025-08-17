class MediaGuard {
  constructor() {
    this.settings = {};
    this.isBackground = false;
    this.fakeMediaEnabled = false;
    this.temporaryPermissions = null;
    this.originalGetUserMedia = null;
    this.fakeStreams = new Map();
    
    this.init();
  }

  async init() {
    // Inject our script before any other scripts can run
    this.injectInterceptor();
    
    // Get initial settings
    await this.loadSettings();
    
    // Setup message listeners
    this.setupMessageListeners();
    
    // Check if this is a background tab
    this.checkBackgroundStatus();
    
    // Monitor iframe creation for background blocking
    this.monitorIframes();
  }

  injectInterceptor() {
    // Inject our interceptor script into the page context
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  async loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getSettings'
      });
      this.settings = response || {};
    } catch (error) {
      console.log('Failed to load settings:', error);
      // Use default settings
      this.settings = {
        webcamBlocked: true,
        micBlocked: true,
        autoBlockBackground: true,
        fakeMediaEnabled: false
      };
    }
  }

  setupMessageListeners() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    // Listen for messages from injected script
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data.source !== 'media-guard-inject') return;
      
      this.handleInjectedMessage(event.data);
    });
  }

  async handleMessage(message, sender, sendResponse) {
    switch (message.action) {
      case 'updateSettings':
        this.settings = message.settings;
        this.sendSettingsToPage();
        break;
      
      case 'setBackground':
        this.isBackground = message.isBackground;
        this.sendSettingsToPage();
        break;
      
      case 'temporaryAccess':
        this.temporaryPermissions = message.permissions;
        this.sendSettingsToPage();
        break;
      
      case 'toggleFakeMedia':
        this.fakeMediaEnabled = message.enabled;
        this.sendSettingsToPage();
        break;
    }
  }

  async handleInjectedMessage(data) {
    switch (data.action) {
      case 'accessAttempt':
        await this.handleAccessAttempt(data.device, data.constraints);
        break;
      
      case 'requestPermissions':
        const permissions = await this.getPermissions();
        window.postMessage({
          source: 'media-guard-content',
          action: 'permissionsResponse',
          permissions: permissions,
          fakeMediaEnabled: this.fakeMediaEnabled
        }, '*');
        break;
    }
  }

  async handleAccessAttempt(device, constraints) {
    const hostname = window.location.hostname;
    const permissions = await this.getPermissions();
    
    let action = 'blocked';
    let deviceAllowed = false;
    
    if (device === 'video' || device === 'webcam') {
      deviceAllowed = permissions.webcamAllowed;
    } else if (device === 'audio' || device === 'microphone') {
      deviceAllowed = permissions.microphoneAllowed;
    }
    
    if (deviceAllowed) {
      action = this.fakeMediaEnabled ? 'fake' : 'allowed';
    }
    
    // Log the attempt
    chrome.runtime.sendMessage({
      action: 'accessAttempt',
      device: device,
      actionType: action,
      isBackground: this.isBackground,
      constraints: constraints
    });
  }

  async getPermissions() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'checkPermissions',
        isBackground: this.isBackground
      });
      return response || { webcamAllowed: false, microphoneAllowed: false };
    } catch (error) {
      console.log('Failed to check permissions:', error);
      return { webcamAllowed: false, microphoneAllowed: false };
    }
  }

  sendSettingsToPage() {
    window.postMessage({
      source: 'media-guard-content',
      action: 'settingsUpdate',
      settings: this.settings,
      isBackground: this.isBackground,
      fakeMediaEnabled: this.fakeMediaEnabled,
      temporaryPermissions: this.temporaryPermissions
    }, '*');
  }

  checkBackgroundStatus() {
    // Check if tab is currently active
    this.isBackground = document.hidden || !document.hasFocus();
    
    // Listen for visibility changes
    document.addEventListener('visibilitychange', () => {
      this.isBackground = document.hidden;
      this.sendSettingsToPage();
    });
    
    window.addEventListener('focus', () => {
      this.isBackground = false;
      this.sendSettingsToPage();
    });
    
    window.addEventListener('blur', () => {
      this.isBackground = true;
      this.sendSettingsToPage();
    });
  }

  monitorIframes() {
    // Monitor for dynamically created iframes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node is an iframe or contains iframes
            const iframes = node.tagName === 'IFRAME' ? [node] : node.querySelectorAll('iframe');
            
            iframes.forEach((iframe) => {
              this.setupIframeMonitoring(iframe);
            });
          }
        });
      });
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Also monitor existing iframes
    document.querySelectorAll('iframe').forEach(iframe => {
      this.setupIframeMonitoring(iframe);
    });
  }

  setupIframeMonitoring(iframe) {
    try {
      // Try to access iframe content (will fail for cross-origin)
      iframe.addEventListener('load', () => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          if (iframeDoc) {
            // Inject our script into the iframe
            const script = iframeDoc.createElement('script');
            script.src = chrome.runtime.getURL('inject.js');
            (iframeDoc.head || iframeDoc.documentElement).appendChild(script);
          }
        } catch (e) {
          // Cross-origin iframe, can't inject script
          console.log('Cannot monitor cross-origin iframe:', iframe.src);
        }
      });
    } catch (e) {
      console.log('Error setting up iframe monitoring:', e);
    }
  }

  // Advanced feature: Detect tracking attempts
  detectTrackingAttempts() {
    const trackingIndicators = [
      // Common tracking domains
      'google-analytics.com',
      'facebook.com',
      'doubleclick.net',
      'amazon-adsystem.com',
      // Audio fingerprinting attempts
      () => document.querySelector('canvas[style*="display:none"]'),
      () => document.querySelector('audio[style*="display:none"]'),
      // WebRTC fingerprinting
      () => window.RTCPeerConnection || window.webkitRTCPeerConnection
    ];
    
    let suspicionLevel = 0;
    const hostname = window.location.hostname;
    
    trackingIndicators.forEach(indicator => {
      if (typeof indicator === 'string') {
        if (hostname.includes(indicator)) suspicionLevel++;
      } else if (typeof indicator === 'function') {
        if (indicator()) suspicionLevel++;
      }
    });
    
    if (suspicionLevel > 2) {
      chrome.runtime.sendMessage({
        action: 'logActivity',
        actionType: 'suspicious',
        device: 'tracking-detected',
        suspicionLevel: suspicionLevel
      });
    }
  }
}

// Initialize MediaGuard when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new MediaGuard();
  });
} else {
  new MediaGuard();
}
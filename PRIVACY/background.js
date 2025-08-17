// Background script for Privacy Analyzer
class PrivacyAnalyzer {
  constructor() {
    this.trackerDomains = new Set([
      'google-analytics.com', 'googletagmanager.com', 'facebook.com',
      'doubleclick.net', 'googlesyndication.com', 'amazon-adsystem.com',
      'scorecardresearch.com', 'quantserve.com', 'outbrain.com',
      'taboola.com', 'addthis.com', 'sharethis.com'
    ]);
    
    this.fingerprintingScripts = new Set([
      'canvas', 'webgl', 'audio', 'font', 'screen'
    ]);
    
    this.siteData = new Map();
    this.init();
  }
  
  init() {
    this.setupWebRequestListeners();
    this.setupTabListeners();
    this.setupNotifications();
  }
  
  setupWebRequestListeners() {
    // Monitor all web requests
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.analyzeRequest(details),
      { urls: ["<all_urls>"] },
      ["requestBody"]
    );
    
    chrome.webRequest.onResponseStarted.addListener(
      (details) => this.analyzeResponse(details),
      { urls: ["<all_urls>"] },
      ["responseHeaders"]
    );
  }
  
  setupTabListeners() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'loading' && tab.url) {
        this.initializeSiteAnalysis(tabId, tab.url);
      }
    });
    
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.siteData.delete(tabId);
    });
  }
  
  setupNotifications() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
    });
  }
  
  initializeSiteAnalysis(tabId, url) {
    const urlObj = new URL(url);
    const isHTTPS = urlObj.protocol === 'https:';
    
    this.siteData.set(tabId, {
      url: url,
      domain: urlObj.hostname,
      isHTTPS: isHTTPS,
      trackers: new Set(),
      cookies: new Map(),
      scripts: new Set(),
      securityHeaders: new Map(),
      fingerprintingAttempts: [],
      privacyScore: isHTTPS ? 70 : 30,
      lastUpdated: Date.now()
    });
    
    this.updateBadge(tabId);
  }
  
  analyzeRequest(details) {
    const { tabId, url, type } = details;
    if (tabId < 0) return;
    
    const siteData = this.siteData.get(tabId);
    if (!siteData) return;
    
    const requestUrl = new URL(url);
    const domain = requestUrl.hostname;
    
    // Check for trackers
    if (this.isTracker(domain)) {
      siteData.trackers.add(domain);
      this.showNotification(tabId, `Tracker detected: ${domain}`);
    }
    
    // Analyze script requests
    if (type === 'script') {
      siteData.scripts.add(url);
      if (this.isPotentialFingerprinting(url)) {
        siteData.fingerprintingAttempts.push({
          url: url,
          timestamp: Date.now(),
          type: 'script'
        });
        this.showNotification(tabId, 'Potential fingerprinting detected');
      }
    }
    
    this.updatePrivacyScore(tabId);
  }
  
  analyzeResponse(details) {
    const { tabId, responseHeaders } = details;
    if (tabId < 0 || !responseHeaders) return;
    
    const siteData = this.siteData.get(tabId);
    if (!siteData) return;
    
    // Analyze security headers
    responseHeaders.forEach(header => {
      const name = header.name.toLowerCase();
      if (this.isSecurityHeader(name)) {
        siteData.securityHeaders.set(name, header.value);
      }
      
      // Check for cookies
      if (name === 'set-cookie') {
        const cookieData = this.parseCookie(header.value);
        siteData.cookies.set(cookieData.name, cookieData);
      }
    });
    
    this.updatePrivacyScore(tabId);
  }
  
  isTracker(domain) {
    return Array.from(this.trackerDomains).some(tracker => 
      domain.includes(tracker)
    );
  }
  
  isPotentialFingerprinting(url) {
    const fingerprintingKeywords = ['fingerprint', 'canvas', 'webgl', 'audio'];
    return fingerprintingKeywords.some(keyword => 
      url.toLowerCase().includes(keyword)
    );
  }
  
  isSecurityHeader(headerName) {
    const securityHeaders = [
      'strict-transport-security',
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy'
    ];
    return securityHeaders.includes(headerName);
  }
  
  parseCookie(cookieString) {
    const parts = cookieString.split(';');
    const [nameValue] = parts;
    const [name, value] = nameValue.split('=');
    
    const cookie = {
      name: name.trim(),
      value: value,
      secure: cookieString.includes('Secure'),
      httpOnly: cookieString.includes('HttpOnly'),
      sameSite: cookieString.includes('SameSite')
    };
    
    return cookie;
  }
  
  updatePrivacyScore(tabId) {
    const siteData = this.siteData.get(tabId);
    if (!siteData) return;
    
    let score = 100;
    
    // Deduct points for trackers
    score -= siteData.trackers.size * 10;
    
    // Deduct points for insecure cookies
    Array.from(siteData.cookies.values()).forEach(cookie => {
      if (!cookie.secure) score -= 5;
      if (!cookie.httpOnly) score -= 3;
    });
    
    // Deduct points for missing HTTPS
    if (!siteData.isHTTPS) score -= 30;
    
    // Deduct points for fingerprinting attempts
    score -= siteData.fingerprintingAttempts.length * 15;
    
    // Add points for security headers
    score += siteData.securityHeaders.size * 5;
    
    siteData.privacyScore = Math.max(0, Math.min(100, score));
    siteData.lastUpdated = Date.now();
    
    this.updateBadge(tabId);
    this.notifyContentScript(tabId, siteData);
  }
  
  updateBadge(tabId) {
    const siteData = this.siteData.get(tabId);
    if (!siteData) return;
    
    const score = siteData.privacyScore;
    let badgeColor, badgeText;
    
    if (score >= 70) {
      badgeColor = '#4CAF50';
      badgeText = 'SAFE';
    } else if (score >= 40) {
      badgeColor = '#FF9800';
      badgeText = 'WARN';
    } else {
      badgeColor = '#F44336';
      badgeText = 'RISK';
    }
    
    chrome.action.setBadgeText({
      tabId: tabId,
      text: Math.round(score).toString()
    });
    
    chrome.action.setBadgeBackgroundColor({
      tabId: tabId,
      color: badgeColor
    });
  }
  
  notifyContentScript(tabId, siteData) {
    chrome.tabs.sendMessage(tabId, {
      type: 'PRIVACY_UPDATE',
      data: {
        score: siteData.privacyScore,
        trackers: Array.from(siteData.trackers),
        cookieCount: siteData.cookies.size,
        isHTTPS: siteData.isHTTPS,
        fingerprintingAttempts: siteData.fingerprintingAttempts.length
      }
    }).catch(() => {
      // Content script might not be ready
    });
  }
  
  showNotification(tabId, message) {
    chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_NOTIFICATION',
      message: message
    }).catch(() => {
      // Content script might not be ready
    });
  }
  
  handleMessage(message, sender, sendResponse) {
    const { type, data } = message;
    const tabId = sender.tab?.id || message.tabId;
    
    switch (type) {
      case 'GET_SITE_DATA':
        const siteData = this.siteData.get(tabId);
        sendResponse({ siteData: siteData || null });
        return true; // Keep message channel open for async response
        
      case 'BLOCK_ALL_TRACKERS':
        this.blockAllTrackers(tabId);
        sendResponse({ success: true });
        break;
        
      case 'BLOCK_TRACKER':
        this.blockSpecificTracker(tabId, data.domain);
        sendResponse({ success: true });
        break;
        
      case 'FINGERPRINTING_DETECTED':
        if (tabId && this.siteData.has(tabId)) {
          const site = this.siteData.get(tabId);
          site.fingerprintingAttempts.push({
            type: data.type,
            details: data.details,
            timestamp: Date.now()
          });
          this.updatePrivacyScore(tabId);
          sendResponse({ success: true });
        }
        break;
        
      case 'USER_FEEDBACK':
        this.handleUserFeedback(tabId, data);
        sendResponse({ success: true });
        break;
        
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }
  
  blockAllTrackers(tabId) {
    const siteData = this.siteData.get(tabId);
    if (!siteData) return;
    
    // Clear trackers from current data
    const blockedCount = siteData.trackers.size;
    siteData.trackers.clear();
    
    // Improve privacy score
    siteData.privacyScore = Math.min(100, siteData.privacyScore + (blockedCount * 10));
    
    // Store blocked trackers preference
    chrome.storage.local.set({
      [`blocked_all_trackers_${siteData.domain}`]: true
    });
    
    this.updateBadge(tabId);
    this.notifyContentScript(tabId, siteData);
    
    // Show notification
    chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_NOTIFICATION',
      message: `🛡️ Blocked ${blockedCount} trackers`
    }).catch(() => {
      // Content script might not be ready
    });
  }
  
  blockSpecificTracker(tabId, domain) {
    const siteData = this.siteData.get(tabId);
    if (!siteData) return;
    
    // Remove tracker from current data
    siteData.trackers.delete(domain);
    
    // Improve privacy score
    siteData.privacyScore = Math.min(100, siteData.privacyScore + 10);
    
    // Store blocked tracker preference
    chrome.storage.local.set({
      [`blocked_tracker_${domain}`]: true
    });
    
    this.updateBadge(tabId);
    this.notifyContentScript(tabId, siteData);
  }
  
  handleUserFeedback(tabId, feedback) {
    // Store user feedback for improving detection
    chrome.storage.local.get(['userFeedback'], (result) => {
      const feedbackData = result.userFeedback || [];
      feedbackData.push({
        tabId,
        feedback,
        timestamp: Date.now()
      });
      
      chrome.storage.local.set({ userFeedback: feedbackData });
    });
  }
}

// Initialize the privacy analyzer
new PrivacyAnalyzer();
// Privacy Analyzer Popup Script
class PrivacyPopup {
  constructor() {
    this.currentTab = null;
    this.siteData = null;
    this.privacyHistory = [];
    this.updateInterval = null;
    this.init();
  }
  
  async init() {
    await this.getCurrentTab();
    this.setupEventListeners();
    this.setupTabs();
    this.setupThemeDetection();
    await this.loadSiteData();
    this.loadPrivacyHistory();
    this.startRealTimeUpdates();
    this.updateUI();
  }
  
  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
      
      if (tab && tab.url) {
        const url = new URL(tab.url);
        document.getElementById('currentSite').textContent = url.hostname;
        
        // Add security indicator
        const isSecure = url.protocol === 'https:';
        const siteElement = document.getElementById('currentSite');
        siteElement.innerHTML = `
          <span class="security-icon">${isSecure ? '🔒' : '⚠️'}</span>
          ${url.hostname}
        `;
        siteElement.className = `current-site ${isSecure ? 'secure' : 'insecure'}`;
      }
    } catch (error) {
      console.error('Error getting current tab:', error);
      document.getElementById('currentSite').textContent = 'Error loading site';
    }
  }
  
  setupThemeDetection() {
    // Detect system theme preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    this.updateTheme(prefersDark.matches);
    
    // Listen for theme changes
    prefersDark.addEventListener('change', (e) => {
      this.updateTheme(e.matches);
    });
  }
  
  updateTheme(isDark) {
    document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }
  
  setupEventListeners() {
    // Quick action buttons with improved feedback
    document.getElementById('blockAllTrackers').addEventListener('click', () => {
      this.blockAllTrackers();
    });
    
    document.getElementById('clearCookies').addEventListener('click', () => {
      this.clearCookies();
    });
    
    document.getElementById('enableHttps').addEventListener('click', () => {
      this.enableHttps();
    });
    
    document.getElementById('reportSite').addEventListener('click', () => {
      this.reportSite();
    });
    
    // Feedback buttons with animation
    document.getElementById('feedbackPositive').addEventListener('click', (e) => {
      this.animateButton(e.target);
      this.sendFeedback('positive');
    });
    
    document.getElementById('feedbackNegative').addEventListener('click', (e) => {
      this.animateButton(e.target);
      this.sendFeedback('negative');
    });
    
    // Clear history with confirmation
    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      if (confirm('Clear all privacy history?')) {
        this.clearHistory();
      }
    });
    
    // Cookie controls with immediate feedback
    document.getElementById('blockThirdPartyCookies').addEventListener('change', (e) => {
      this.toggleThirdPartyCookies(e.target.checked);
    });
    
    // Footer links
    document.getElementById('settingsLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openSettings();
    });
    
    document.getElementById('helpLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openHelp();
    });
    
    document.getElementById('aboutLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openAbout();
    });
  }
  
  animateButton(button) {
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
      button.style.transform = 'scale(1)';
    }, 150);
  }
  
  setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetTab = button.dataset.tab;
        
        // Add slide animation
        tabButtons.forEach(btn => {
          btn.classList.remove('active');
          btn.style.transform = 'scale(1)';
        });
        tabPanels.forEach(panel => {
          panel.classList.remove('active');
          panel.style.opacity = '0';
        });
        
        // Activate selected tab with animation
        button.classList.add('active');
        button.style.transform = 'scale(1.05)';
        setTimeout(() => {
          button.style.transform = 'scale(1)';
        }, 200);
        
        const targetPanel = document.getElementById(targetTab);
        setTimeout(() => {
          targetPanel.classList.add('active');
          targetPanel.style.opacity = '1';
        }, 150);
      });
    });
  }
  
  startRealTimeUpdates() {
    // Update data every 2 seconds for real-time monitoring
    this.updateInterval = setInterval(async () => {
      await this.loadSiteData();
      this.updateUI();
    }, 2000);
    
    // Clear interval when popup closes
    window.addEventListener('beforeunload', () => {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
    });
  }
  
  async loadSiteData() {
    if (!this.currentTab) return;
    
    try {
      // Get site data from background script
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SITE_DATA',
        tabId: this.currentTab.id
      });
      
      if (response && response.siteData) {
        this.siteData = response.siteData;
        
        // Save to privacy history
        this.saveToHistory();
      } else {
        // Initialize empty data if none exists
        this.siteData = {
          url: this.currentTab.url,
          domain: new URL(this.currentTab.url).hostname,
          isHTTPS: this.currentTab.url.startsWith('https:'),
          trackers: [],
          cookies: new Map(),
          securityHeaders: new Map(),
          fingerprintingAttempts: [],
          privacyScore: this.currentTab.url.startsWith('https:') ? 70 : 30,
          lastUpdated: Date.now()
        };
      }
    } catch (error) {
      console.error('Error loading site data:', error);
      this.showLoadingState();
    }
  }
  
  saveToHistory() {
    if (!this.siteData) return;
    
    const historyEntry = {
      url: this.siteData.url,
      domain: this.siteData.domain,
      score: this.siteData.privacyScore,
      timestamp: Date.now()
    };
    
    // Update local history
    const existingIndex = this.privacyHistory.findIndex(entry => entry.domain === historyEntry.domain);
    if (existingIndex >= 0) {
      this.privacyHistory[existingIndex] = historyEntry;
    } else {
      this.privacyHistory.push(historyEntry);
    }
    
    // Keep only last 50 entries
    if (this.privacyHistory.length > 50) {
      this.privacyHistory = this.privacyHistory.slice(-50);
    }
    
    // Save to storage
    chrome.storage.local.set({
      privacyHistory: this.privacyHistory
    });
  }
  
  updateUI() {
    if (!this.siteData) {
      this.showLoadingState();
      return;
    }
    
    this.updateScoreDisplay();
    this.updateBreakdown();
    this.updateRecommendations();
    this.updateTrackersTab();
    this.updateCookiesTab();
    this.updateSecurityTab();
    this.updateHistoryDisplay();
  }
  
  showLoadingState() {
    document.getElementById('scoreText').textContent = '--';
    document.getElementById('scoreStatus').textContent = 'Analyzing...';
    document.getElementById('trackerCount').textContent = '0';
    document.getElementById('cookieCount').textContent = '0';
    document.getElementById('securityLevel').textContent = '--';
    
    // Add loading animation
    document.querySelector('.score-circle').classList.add('loading');
  }
  
  updateScoreDisplay() {
    const score = this.siteData.privacyScore || 0;
    const scoreText = document.getElementById('scoreText');
    const scoreCircle = document.getElementById('scoreCircle');
    const scoreStatus = document.getElementById('scoreStatus');
    
    // Remove loading state
    document.querySelector('.score-circle').classList.remove('loading');
    
    // Animate score change
    const currentScore = parseInt(scoreText.textContent) || 0;
    this.animateScore(currentScore, Math.round(score), scoreText);
    
    // Update circle progress with animation
    const circumference = 2 * Math.PI * 45;
    const progress = (score / 100) * circumference;
    scoreCircle.style.strokeDashoffset = circumference - progress;
    
    // Update color and status based on score
    let color, status, bgColor;
    if (score >= 80) {
      color = '#10b981';
      bgColor = 'rgba(16, 185, 129, 0.1)';
      status = 'Excellent Privacy';
    } else if (score >= 60) {
      color = '#f59e0b';
      bgColor = 'rgba(245, 158, 11, 0.1)';
      status = 'Good Privacy';
    } else if (score >= 40) {
      color = '#ef4444';
      bgColor = 'rgba(239, 68, 68, 0.1)';
      status = 'Poor Privacy';
    } else {
      color = '#dc2626';
      bgColor = 'rgba(220, 38, 38, 0.1)';
      status = 'Very Poor Privacy';
    }
    
    scoreCircle.style.stroke = color;
    scoreText.style.color = color;
    scoreStatus.textContent = status;
    scoreStatus.style.color = color;
    
    // Update score section background
    document.querySelector('.score-section').style.background = bgColor;
  }
  
  animateScore(from, to, element) {
    const duration = 1000;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const currentScore = Math.round(from + (to - from) * this.easeOutQuad(progress));
      element.textContent = currentScore;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  easeOutQuad(t) {
    return t * (2 - t);
  }
  
  updateBreakdown() {
    const trackerCount = Array.isArray(this.siteData.trackers) ? this.siteData.trackers.length : 0;
    const cookieCount = this.siteData.cookies ? this.siteData.cookies.size : 0;
    
    // Animate count changes
    this.animateCount(document.getElementById('trackerCount'), trackerCount);
    this.animateCount(document.getElementById('cookieCount'), cookieCount);
    
    const securityLevel = document.getElementById('securityLevel');
    if (this.siteData.isHTTPS) {
      securityLevel.textContent = 'Secure';
      securityLevel.style.color = '#10b981';
      securityLevel.innerHTML = '🔒 Secure';
    } else {
      securityLevel.textContent = 'Insecure';
      securityLevel.style.color = '#ef4444';
      securityLevel.innerHTML = '⚠️ Insecure';
    }
  }
  
  animateCount(element, targetCount) {
    const currentCount = parseInt(element.textContent) || 0;
    if (currentCount === targetCount) return;
    
    const duration = 500;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const count = Math.round(currentCount + (targetCount - currentCount) * progress);
      element.textContent = count;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  updateRecommendations() {
    const recommendationsList = document.getElementById('recommendationsList');
    const recommendations = this.generateRecommendations();
    
    recommendationsList.innerHTML = '';
    
    recommendations.forEach((rec, index) => {
      const item = document.createElement('div');
      item.className = `recommendation-item ${rec.priority}`;
      item.innerHTML = `
        <div class="recommendation-icon">${rec.icon}</div>
        <div class="recommendation-content">
          <div class="recommendation-text">${rec.text}</div>
          ${rec.action ? `<button class="recommendation-action" onclick="privacyPopup.${rec.action}()">${rec.actionText}</button>` : ''}
        </div>
      `;
      
      // Add staggered animation
      item.style.animationDelay = `${index * 100}ms`;
      item.classList.add('fade-in');
      
      recommendationsList.appendChild(item);
    });
  }
  
  generateRecommendations() {
    const recommendations = [];
    
    if (!this.siteData.isHTTPS) {
      recommendations.push({
        text: 'This site is not using HTTPS. Your data may be intercepted.',
        priority: 'high-priority',
        icon: '🔓',
        action: 'enableHttps',
        actionText: 'Force HTTPS'
      });
    }
    
    const trackerCount = Array.isArray(this.siteData.trackers) ? this.siteData.trackers.length : 0;
    if (trackerCount > 5) {
      recommendations.push({
        text: `${trackerCount} trackers detected. Consider blocking them for better privacy.`,
        priority: 'high-priority',
        icon: '🕵️',
        action: 'blockAllTrackers',
        actionText: 'Block All'
      });
    } else if (trackerCount > 0) {
      recommendations.push({
        text: `${trackerCount} tracker${trackerCount > 1 ? 's' : ''} detected. Your browsing is being monitored.`,
        priority: 'medium-priority',
        icon: '👀'
      });
    }
    
    if (this.siteData.fingerprintingAttempts && this.siteData.fingerprintingAttempts.length > 0) {
      recommendations.push({
        text: 'Fingerprinting attempts detected. Enable fingerprint protection.',
        priority: 'high-priority',
        icon: '🔍'
      });
    }
    
    const cookieCount = this.siteData.cookies ? this.siteData.cookies.size : 0;
    if (cookieCount > 10) {
      recommendations.push({
        text: `Many cookies (${cookieCount}) found. Consider clearing them periodically.`,
        priority: 'low-priority',
        icon: '🍪',
        action: 'clearCookies',
        actionText: 'Clear Cookies'
      });
    }
    
    if (recommendations.length === 0) {
      recommendations.push({
        text: 'This site appears to respect your privacy. Great job staying safe online!',
        priority: 'success',
        icon: '✅'
      });
    }
    
    return recommendations;
  }
  
  updateTrackersTab() {
    const trackersList = document.getElementById('trackersList');
    const trackerCount = document.getElementById('trackerPanelCount');
    
    const trackers = Array.isArray(this.siteData.trackers) ? this.siteData.trackers : [];
    trackerCount.textContent = trackers.length;
    
    trackersList.innerHTML = '';
    
    if (trackers.length === 0) {
      trackersList.innerHTML = '<div class="no-items">🎉 No trackers detected</div>';
      return;
    }
    
    trackers.forEach((tracker, index) => {
      const item = document.createElement('div');
      item.className = 'item tracker-item';
      item.style.animationDelay = `${index * 50}ms`;
      item.innerHTML = `
        <div class="item-header">
          <div class="item-info">
            <span class="item-name">${tracker}</span>
            <span class="item-type">Tracker</span>
          </div>
          <button class="item-action" onclick="privacyPopup.blockTracker('${tracker}')">Block</button>
        </div>
        <div class="item-details">
          <span class="detail-badge danger">Data Collection</span>
          <span class="detail-text">This domain is collecting your browsing data</span>
        </div>
      `;
      trackersList.appendChild(item);
    });
  }
  
  updateCookiesTab() {
    const cookiesList = document.getElementById('cookiesList');
    const cookieCount = document.getElementById('cookiePanelCount');
    
    const cookies = this.siteData.cookies || new Map();
    cookieCount.textContent = cookies.size;
    
    cookiesList.innerHTML = '';
    
    if (cookies.size === 0) {
      cookiesList.innerHTML = '<div class="no-items">🍪 No cookies found</div>';
      return;
    }
    
    const cookieArray = Array.from(cookies.entries());
    cookieArray.forEach(([name, cookie], index) => {
      const item = document.createElement('div');
      item.className = 'item cookie-item';
      item.style.animationDelay = `${index * 50}ms`;
      
      const securityFlags = [];
      if (cookie.secure) securityFlags.push('Secure');
      if (cookie.httpOnly) securityFlags.push('HttpOnly');
      if (cookie.sameSite) securityFlags.push('SameSite');
      
      const isSecure = securityFlags.length > 1;
      
      item.innerHTML = `
        <div class="item-header">
          <div class="item-info">
            <span class="item-name">${name}</span>
            <span class="item-type">Cookie</span>
          </div>
          <button class="item-action" onclick="privacyPopup.deleteCookie('${name}')">Delete</button>
        </div>
        <div class="item-details">
          <span class="detail-badge ${isSecure ? 'success' : 'warning'}">
            ${isSecure ? '✓ Secure' : '⚠️ Insecure'}
          </span>
          <span class="detail-text">
            ${securityFlags.length > 0 ? securityFlags.join(', ') : 'No security flags set'}
          </span>
        </div>
      `;
      cookiesList.appendChild(item);
    });
  }
  
  updateSecurityTab() {
    const securityHeaders = this.siteData.securityHeaders || new Map();
    
    this.updateSecurityCheck('httpsCheck', this.siteData.isHTTPS, 'HTTPS Connection');
    this.updateSecurityCheck('cspCheck', securityHeaders.has('content-security-policy'), 'Content Security Policy');
    this.updateSecurityCheck('hstsCheck', securityHeaders.has('strict-transport-security'), 'HSTS Header');
    
    const fingerprintingAttempts = this.siteData.fingerprintingAttempts || [];
    this.updateSecurityCheck('fingerprintingCheck', fingerprintingAttempts.length === 0, 'Fingerprinting Protection');
    
    // Update security details
    const securityDetails = document.getElementById('securityDetails');
    const headersList = Array.from(securityHeaders.keys());
    
    if (headersList.length > 0) {
      securityDetails.innerHTML = `
        <div class="security-headers">
          <h4>Security Headers Found:</h4>
          ${headersList.map(header => `
            <div class="header-item">
              <span class="header-name">${header}</span>
              <span class="header-status">✓</span>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      securityDetails.innerHTML = `
        <div class="security-warning">
          <span class="warning-icon">⚠️</span>
          <span>No security headers detected. This site may be vulnerable to attacks.</span>
        </div>
      `;
    }
  }
  
  updateSecurityCheck(elementId, passed, description) {
    const element = document.getElementById(elementId);
    const icon = element.querySelector('.check-icon');
    const status = element.querySelector('.check-status');
    
    element.classList.remove('passed', 'failed', 'checking');
    
    if (passed) {
      element.classList.add('passed');
      icon.textContent = '✅';
      status.textContent = 'Passed';
    } else {
      element.classList.add('failed');
      icon.textContent = '❌';
      status.textContent = 'Failed';
    }
    
    // Add animation
    element.style.transform = 'scale(1.02)';
    setTimeout(() => {
      element.style.transform = 'scale(1)';
    }, 200);
  }
  
  loadPrivacyHistory() {
    chrome.storage.local.get(['privacyHistory'], (result) => {
      this.privacyHistory = result.privacyHistory || [];
      this.updateHistoryDisplay();
    });
  }
  
  updateHistoryDisplay() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';
    
    if (this.privacyHistory.length === 0) {
      historyList.innerHTML = '<div class="no-items">📊 No history available</div>';
      return;
    }
    
    const recentHistory = this.privacyHistory.slice(-5);
    recentHistory.reverse().forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.style.animationDelay = `${index * 50}ms`;
      
      const scoreColor = entry.score >= 70 ? '#10b981' : entry.score >= 40 ? '#f59e0b' : '#ef4444';
      
      item.innerHTML = `
        <div class="history-info">
          <span class="history-site">${entry.domain}</span>
          <span class="history-time">${this.formatTimeAgo(entry.timestamp)}</span>
        </div>
        <div class="history-score" style="color: ${scoreColor}">
          ${Math.round(entry.score)}%
        </div>
      `;
      historyList.appendChild(item);
    });
  }
  
  formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
  
  // Action Methods with improved feedback
  async blockAllTrackers() {
    try {
      await chrome.runtime.sendMessage({
        type: 'BLOCK_ALL_TRACKERS',
        tabId: this.currentTab.id
      });
      
      this.showNotification('🛡️ All trackers blocked for this site', 'success');
      
      // Update UI immediately
      if (this.siteData) {
        this.siteData.trackers = [];
        this.siteData.privacyScore = Math.min(100, this.siteData.privacyScore + 20);
        this.updateUI();
      }
    } catch (error) {
      console.error('Error blocking trackers:', error);
      this.showNotification('❌ Failed to block trackers', 'error');
    }
  }
  
  async blockTracker(domain) {
    try {
      await chrome.runtime.sendMessage({
        type: 'BLOCK_TRACKER',
        domain: domain,
        tabId: this.currentTab.id
      });
      
      this.showNotification(`🚫 Blocked tracker: ${domain}`, 'success');
      
      // Update UI
      if (this.siteData && this.siteData.trackers) {
        const index = this.siteData.trackers.indexOf(domain);
        if (index > -1) {
          this.siteData.trackers.splice(index, 1);
          this.siteData.privacyScore = Math.min(100, this.siteData.privacyScore + 10);
          this.updateUI();
        }
      }
    } catch (error) {
      console.error('Error blocking tracker:', error);
      this.showNotification('❌ Failed to block tracker', 'error');
    }
  }
  
  async clearCookies() {
    if (!this.currentTab) return;
    
    try {
      const url = new URL(this.currentTab.url);
      const cookies = await chrome.cookies.getAll({ domain: url.hostname });
      
      const deletePromises = cookies.map(cookie => 
        chrome.cookies.remove({
          url: `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`,
          name: cookie.name
        })
      );
      
      await Promise.all(deletePromises);
      
      this.showNotification(`🍪 Cleared ${cookies.length} cookies`, 'success');
      
      // Update UI
      if (this.siteData) {
        this.siteData.cookies.clear();
        this.siteData.privacyScore = Math.min(100, this.siteData.privacyScore + 5);
        this.updateUI();
      }
    } catch (error) {
      console.error('Error clearing cookies:', error);
      this.showNotification('❌ Failed to clear cookies', 'error');
    }
  }
  
  async deleteCookie(name) {
    if (!this.currentTab) return;
    
    try {
      await chrome.cookies.remove({
        url: this.currentTab.url,
        name: name
      });
      
      this.showNotification(`🗑️ Deleted cookie: ${name}`, 'success');
      
      // Update UI
      if (this.siteData && this.siteData.cookies) {
        this.siteData.cookies.delete(name);
        this.updateUI();
      }
    } catch (error) {
      console.error('Error deleting cookie:', error);
      this.showNotification('❌ Failed to delete cookie', 'error');
    }
  }
  
  async enableHttps() {
    if (!this.currentTab) return;
    
    const currentUrl = new URL(this.currentTab.url);
    if (currentUrl.protocol === 'http:') {
      const httpsUrl = currentUrl.toString().replace('http:', 'https:');
      try {
        await chrome.tabs.update(this.currentTab.id, { url: httpsUrl });
        this.showNotification('🔒 Redirecting to HTTPS version', 'success');
      } catch (error) {
        this.showNotification('❌ HTTPS not available for this site', 'error');
      }
    } else {
      this.showNotification('✅ This site is already using HTTPS', 'info');
    }
  }
  
  async reportSite() {
    try {
      await chrome.runtime.sendMessage({
        type: 'USER_FEEDBACK',
        data: {
          type: 'report',
          url: this.currentTab.url,
          reason: 'user_reported',
          timestamp: Date.now(),
          privacyScore: this.siteData?.privacyScore || 0
        }
      });
      
      this.showNotification('📝 Site reported. Thank you for helping improve privacy protection!', 'success');
    } catch (error) {
      console.error('Error reporting site:', error);
      this.showNotification('❌ Failed to report site', 'error');
    }
  }
  
  async sendFeedback(type) {
    try {
      await chrome.runtime.sendMessage({
        type: 'USER_FEEDBACK',
        data: {
          type: 'score_feedback',
          feedback: type,
          score: this.siteData?.privacyScore || 0,
          url: this.currentTab.url,
          timestamp: Date.now()
        }
      });
      
      const message = type === 'positive' ? 
        '👍 Thanks for the feedback! This helps us improve.' : 
        '👎 Thanks for the feedback. We\'ll work on improving our detection.';
      
      this.showNotification(message, 'success');
    } catch (error) {
      console.error('Error sending feedback:', error);
      this.showNotification('❌ Failed to send feedback', 'error');
    }
  }
  
  async toggleThirdPartyCookies(enabled) {
    try {
      await chrome.storage.sync.set({
        blockThirdPartyCookies: enabled
      });
      
      const message = enabled ? 
        '🛡️ Third-party cookies will be blocked' : 
        '🍪 Third-party cookies allowed';
      
      this.showNotification(message, 'info');
    } catch (error) {
      console.error('Error updating cookie settings:', error);
      this.showNotification('❌ Failed to update settings', 'error');
    }
  }
  
  async clearHistory() {
    try {
      await chrome.storage.local.set({ privacyHistory: [] });
      this.privacyHistory = [];
      this.updateHistoryDisplay();
      this.showNotification('🗑️ Privacy history cleared', 'success');
    } catch (error) {
      console.error('Error clearing history:', error);
      this.showNotification('❌ Failed to clear history', 'error');
    }
  }
  
  openSettings() {
    chrome.tabs.create({
      url: 'chrome://extensions/?id=' + chrome.runtime.id
    });
  }
  
  openHelp() {
    chrome.tabs.create({ 
      url: 'https://github.com/privacy-analyzer/help' 
    });
  }
  
  openAbout() {
    this.showNotification('🛡️ Privacy Analyzer Pro v1.0.0 - Protecting your privacy online', 'info');
  }
  
  showNotification(message, type = 'info') {
    // Remove existing notifications
    document.querySelectorAll('.popup-notification').forEach(n => n.remove());
    
    // Create notification
    const notification = document.createElement('div');
    notification.className = `popup-notification ${type}`;
    
    const icon = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    }[type] || 'ℹ️';
    
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">${icon}</span>
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Add show class for animation
    setTimeout(() => notification.classList.add('show'), 10);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
      }
    }, 4000);
  }
}

// Initialize the popup
const privacyPopup = new PrivacyPopup();
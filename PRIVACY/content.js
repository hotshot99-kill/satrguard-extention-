// Content script for Privacy Analyzer
class PrivacyWidget {
  constructor() {
    this.widget = null;
    this.notifications = [];
    this.privacyData = null;
    this.isVisible = true;
    this.init();
  }
  
  init() {
    this.createWidget();
    this.setupMessageListener();
    this.monitorDeviceAccess();
    this.detectFingerprinting();
    this.loadUserPreferences();
  }
  
  createWidget() {
    // Create the privacy widget container
    this.widget = document.createElement('div');
    this.widget.id = 'privacy-analyzer-widget';
    this.widget.className = 'privacy-widget';
    
    this.widget.innerHTML = `
      <div class="privacy-score-container">
        <div class="privacy-score-circle">
          <div class="score-text">--</div>
          <svg class="score-ring" width="60" height="60">
            <circle cx="30" cy="30" r="25" class="score-ring-bg"></circle>
            <circle cx="30" cy="30" r="25" class="score-ring-fill"></circle>
          </svg>
        </div>
        <div class="privacy-controls">
          <button class="toggle-details" title="Toggle Details">📊</button>
          <button class="toggle-visibility" title="Hide Widget">👁️</button>
        </div>
      </div>
      
      <div class="privacy-details" style="display: none;">
        <div class="detail-section">
          <div class="section-header">
            <span class="section-title">Trackers</span>
            <span class="section-count tracker-count">0</span>
          </div>
          <div class="section-content tracker-list"></div>
        </div>
        
        <div class="detail-section">
          <div class="section-header">
            <span class="section-title">Cookies</span>
            <span class="section-count cookie-count">0</span>
          </div>
          <div class="section-content cookie-list"></div>
        </div>
        
        <div class="detail-section">
          <div class="section-header">
            <span class="section-title">Security</span>
            <span class="section-status security-status">--</span>
          </div>
          <div class="section-content security-details"></div>
        </div>
        
        <div class="action-buttons">
          <button class="action-btn block-trackers">Block Trackers</button>
          <button class="action-btn disable-js">Disable JS</button>
          <button class="action-btn report-site">Report Site</button>
        </div>
        
        <div class="feedback-section">
          <span>Was this score accurate?</span>
          <button class="feedback-btn thumbs-up">👍</button>
          <button class="feedback-btn thumbs-down">👎</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.widget);
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    const toggleDetails = this.widget.querySelector('.toggle-details');
    const toggleVisibility = this.widget.querySelector('.toggle-visibility');
    const details = this.widget.querySelector('.privacy-details');
    
    toggleDetails.addEventListener('click', () => {
      const isVisible = details.style.display !== 'none';
      details.style.display = isVisible ? 'none' : 'block';
      toggleDetails.textContent = isVisible ? '📊' : '📈';
    });
    
    toggleVisibility.addEventListener('click', () => {
      this.isVisible = !this.isVisible;
      this.widget.style.display = this.isVisible ? 'block' : 'none';
      toggleVisibility.textContent = this.isVisible ? '👁️' : '👁️‍🗨️';
    });
    
    // Action button listeners
    this.widget.querySelector('.block-trackers').addEventListener('click', () => {
      this.blockTrackers();
    });
    
    this.widget.querySelector('.disable-js').addEventListener('click', () => {
      this.toggleJavaScript();
    });
    
    this.widget.querySelector('.report-site').addEventListener('click', () => {
      this.reportSite();
    });
    
    // Feedback listeners
    this.widget.querySelector('.thumbs-up').addEventListener('click', () => {
      this.sendFeedback('accurate');
    });
    
    this.widget.querySelector('.thumbs-down').addEventListener('click', () => {
      this.sendFeedback('inaccurate');
    });
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'PRIVACY_UPDATE':
          this.updatePrivacyData(message.data);
          break;
        case 'SHOW_NOTIFICATION':
          this.showNotification(message.message);
          break;
      }
    });
  }
  
  updatePrivacyData(data) {
    this.privacyData = data;
    this.updateWidget();
  }
  
  updateWidget() {
    if (!this.privacyData) return;
    
    const { score, trackers, cookieCount, isHTTPS, fingerprintingAttempts } = this.privacyData;
    
    // Update score circle
    this.updateScoreCircle(score);
    
    // Update tracker information
    this.widget.querySelector('.tracker-count').textContent = trackers.length;
    this.updateTrackerList(trackers);
    
    // Update cookie information
    this.widget.querySelector('.cookie-count').textContent = cookieCount;
    
    // Update security status
    const securityStatus = this.widget.querySelector('.security-status');
    securityStatus.textContent = isHTTPS ? '🔒 HTTPS' : '⚠️ HTTP';
    securityStatus.className = `section-status security-status ${isHTTPS ? 'secure' : 'insecure'}`;
    
    // Update security details
    this.updateSecurityDetails(isHTTPS, fingerprintingAttempts);
  }
  
  updateScoreCircle(score) {
    const scoreText = this.widget.querySelector('.score-text');
    const scoreRingFill = this.widget.querySelector('.score-ring-fill');
    
    scoreText.textContent = Math.round(score);
    
    // Calculate circle progress
    const circumference = 2 * Math.PI * 25;
    const progress = (score / 100) * circumference;
    
    scoreRingFill.style.strokeDasharray = circumference;
    scoreRingFill.style.strokeDashoffset = circumference - progress;
    
    // Color based on score
    let color;
    if (score >= 70) color = '#4CAF50';
    else if (score >= 40) color = '#FF9800';
    else color = '#F44336';
    
    scoreRingFill.style.stroke = color;
    scoreText.style.color = color;
  }
  
  updateTrackerList(trackers) {
    const trackerList = this.widget.querySelector('.tracker-list');
    trackerList.innerHTML = '';
    
    trackers.forEach(tracker => {
      const trackerItem = document.createElement('div');
      trackerItem.className = 'tracker-item';
      trackerItem.innerHTML = `
        <span class="tracker-domain">${tracker}</span>
        <button class="block-tracker-btn" data-domain="${tracker}">Block</button>
      `;
      trackerList.appendChild(trackerItem);
    });
    
    // Add click listeners for individual tracker blocking
    trackerList.querySelectorAll('.block-tracker-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const domain = e.target.dataset.domain;
        this.blockSpecificTracker(domain);
      });
    });
  }
  
  updateSecurityDetails(isHTTPS, fingerprintingAttempts) {
    const securityDetails = this.widget.querySelector('.security-details');
    securityDetails.innerHTML = `
      <div class="security-item">
        <span>HTTPS: ${isHTTPS ? '✓' : '✗'}</span>
      </div>
      <div class="security-item">
        <span>Fingerprinting Attempts: ${fingerprintingAttempts}</span>
      </div>
    `;
  }
  
  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'privacy-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-text">${message}</span>
        <button class="notification-close">×</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 5000);
    
    // Manual close
    notification.querySelector('.notification-close').addEventListener('click', () => {
      notification.remove();
    });
    
    // Animate in
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);
  }
  
  monitorDeviceAccess() {
    // Monitor camera and microphone access
    const originalGetUserMedia = navigator.mediaDevices?.getUserMedia;
    if (originalGetUserMedia) {
      navigator.mediaDevices.getUserMedia = function(...args) {
        this.showNotification('🎥 Site accessing camera/microphone!');
        return originalGetUserMedia.apply(this, args);
      }.bind(this);
    }
  }
  
  detectFingerprinting() {
    // Monitor canvas fingerprinting
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type) {
      if (type === '2d' || type === 'webgl' || type === 'webgl2') {
        chrome.runtime.sendMessage({
          type: 'FINGERPRINTING_DETECTED',
          data: {
            type: 'canvas',
            details: `${type} context requested`
          }
        });
      }
      return originalGetContext.call(this, type);
    };
    
    // Monitor font enumeration
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      if (text && text.length > 20) {
        chrome.runtime.sendMessage({
          type: 'FINGERPRINTING_DETECTED',
          data: {
            type: 'font',
            details: 'Font measurement detected'
          }
        });
      }
      return originalMeasureText.call(this, text);
    };
  }
  
  blockTrackers() {
    this.showNotification('🛡️ Tracker blocking activated');
    // Implementation would involve CSS injection or script blocking
  }
  
  blockSpecificTracker(domain) {
    this.showNotification(`🚫 Blocked tracker: ${domain}`);
    // Implementation would block specific domain
  }
  
  toggleJavaScript() {
    this.showNotification('⚠️ JavaScript toggle requires page reload');
    // Implementation would require extension permissions
  }
  
  reportSite() {
    const siteUrl = window.location.href;
    chrome.runtime.sendMessage({
      type: 'USER_FEEDBACK',
      data: {
        type: 'report',
        url: siteUrl,
        reason: 'user_reported'
      }
    });
    this.showNotification('📝 Site reported. Thank you for your feedback!');
  }
  
  sendFeedback(type) {
    chrome.runtime.sendMessage({
      type: 'USER_FEEDBACK',
      data: {
        type: 'score_feedback',
        feedback: type,
        score: this.privacyData?.score || 0,
        url: window.location.href
      }
    });
    
    this.showNotification(
      type === 'accurate' ? '👍 Thanks for the feedback!' : '👎 We\'ll improve our detection'
    );
  }
  
  loadUserPreferences() {
    // Load user preferences for widget position, visibility, etc.
    chrome.storage.sync.get(['widgetPreferences'], (result) => {
      if (result.widgetPreferences) {
        // Apply saved preferences
        const prefs = result.widgetPreferences;
        if (prefs.position) {
          this.widget.style.bottom = prefs.position.bottom || '20px';
          this.widget.style.right = prefs.position.right || '20px';
        }
        if (prefs.visible === false) {
          this.isVisible = false;
          this.widget.style.display = 'none';
        }
      }
    });
  }
}

// Initialize the privacy widget when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new PrivacyWidget();
  });
} else {
  new PrivacyWidget();
}
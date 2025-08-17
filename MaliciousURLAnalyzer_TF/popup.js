// Popup script for SecureGuard Extension

class SecureGuardPopup {
  constructor() {
    this.currentTab = null;
    this.scanHistory = [];
    this.settings = {
      realtimeScanning: true,
      downloadProtection: true,
      scriptAnalysis: true
    };
    this.init();
  }

  async init() {
    await this.loadCurrentTab();
    await this.loadSettings();
    await this.loadStats();
    await this.loadRecentActivity();
    this.setupEventListeners();
    this.updateCurrentPageStatus();
  }

  async loadCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
    } catch (error) {
      console.error('Error loading current tab:', error);
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['settings']);
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
      this.updateSettingsUI();
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async loadStats() {
    try {
      const result = await chrome.storage.local.get(['stats']);
      const stats = result.stats || {
        threatsBlocked: 0,
        sitesScanned: 0,
        filesChecked: 0
      };
      this.updateStatsUI(stats);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  async loadRecentActivity() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SCAN_HISTORY'
      });
      
      if (response) {
        this.scanHistory = response.slice(-5); // Last 5 activities
        this.updateActivityUI();
      }
    } catch (error) {
      console.error('Error loading recent activity:', error);
    }
  }

  setupEventListeners() {
    // Scan page button
    const scanBtn = document.getElementById('scanPageBtn');
    scanBtn.addEventListener('click', () => this.scanCurrentPage());

    // Settings toggles
    document.getElementById('realtimeScanning').addEventListener('change', (e) => {
      this.updateSetting('realtimeScanning', e.target.checked);
    });

    document.getElementById('downloadProtection').addEventListener('change', (e) => {
      this.updateSetting('downloadProtection', e.target.checked);
    });

    document.getElementById('scriptAnalysis').addEventListener('change', (e) => {
      this.updateSetting('scriptAnalysis', e.target.checked);
    });

    // Quick action buttons
    document.getElementById('viewHistoryBtn').addEventListener('click', () => {
      this.showHistoryModal();
    });

    document.getElementById('reportIssueBtn').addEventListener('click', () => {
      this.showReportModal();
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Modal event listeners
    this.setupModalListeners();
  }

  setupModalListeners() {
    // History modal
    const historyModal = document.getElementById('historyModal');
    const closeHistoryModal = document.getElementById('closeHistoryModal');
    
    closeHistoryModal.addEventListener('click', () => {
      historyModal.classList.remove('show');
    });

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.filterHistory(e.target.dataset.filter);
      });
    });

    // Report modal
    const reportModal = document.getElementById('reportModal');
    const closeReportModal = document.getElementById('closeReportModal');
    const cancelReport = document.getElementById('cancelReport');
    const reportForm = document.getElementById('reportForm');

    closeReportModal.addEventListener('click', () => {
      reportModal.classList.remove('show');
    });

    cancelReport.addEventListener('click', () => {
      reportModal.classList.remove('show');
    });

    reportForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitReport();
    });

    // Close modals when clicking outside
    [historyModal, reportModal].forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
        }
      });
    });
  }

  updateCurrentPageStatus() {
    const urlElement = document.getElementById('currentUrl');
    const statusElement = document.getElementById('pageStatus');

    if (this.currentTab) {
      const url = new URL(this.currentTab.url);
      urlElement.textContent = url.hostname + url.pathname;
      
      // Check if current page has been scanned
      const recentScan = this.scanHistory.find(scan => scan.url === this.currentTab.url);
      
      if (recentScan) {
        if (recentScan.isMalicious) {
          statusElement.innerHTML = `
            <span class="status-icon">⚠️</span>
            <span class="status-text">Threats Detected</span>
          `;
          statusElement.style.color = '#f44336';
        } else {
          statusElement.innerHTML = `
            <span class="status-icon">✅</span>
            <span class="status-text">Safe</span>
          `;
          statusElement.style.color = '#4CAF50';
        }
      } else {
        statusElement.innerHTML = `
          <span class="status-icon">🔍</span>
          <span class="status-text">Ready to scan</span>
        `;
        statusElement.style.color = '#666';
      }
    }
  }

  async scanCurrentPage() {
    if (!this.currentTab) return;

    const scanBtn = document.getElementById('scanPageBtn');
    const statusElement = document.getElementById('pageStatus');

    // Update UI to show scanning
    scanBtn.classList.add('scanning');
    scanBtn.innerHTML = `
      <span class="scan-icon">⏳</span>
      Scanning...
    `;
    
    statusElement.innerHTML = `
      <span class="status-icon">⏳</span>
      <span class="status-text">Scanning...</span>
    `;
    statusElement.style.color = '#ff9800';

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'SCAN_URL',
        url: this.currentTab.url
      });

      // Update stats
      await this.incrementStat('sitesScanned');
      if (result.isMalicious) {
        await this.incrementStat('threatsBlocked');
      }

      // Update UI based on results
      if (result.isMalicious) {
        statusElement.innerHTML = `
          <span class="status-icon">⚠️</span>
          <span class="status-text">Threats Detected</span>
        `;
        statusElement.style.color = '#f44336';
        
        this.showThreatDetails(result);
      } else {
        statusElement.innerHTML = `
          <span class="status-icon">✅</span>
          <span class="status-text">Safe</span>
        `;
        statusElement.style.color = '#4CAF50';
      }

      // Add to activity
      this.addActivity({
        type: 'scan',
        url: this.currentTab.url,
        result: result.isMalicious ? 'threat' : 'safe',
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('Error scanning page:', error);
      statusElement.innerHTML = `
        <span class="status-icon">❌</span>
        <span class="status-text">Scan failed</span>
      `;
      statusElement.style.color = '#f44336';
    } finally {
      // Reset scan button
      scanBtn.classList.remove('scanning');
      scanBtn.innerHTML = `
        <span class="scan-icon">🔍</span>
        Scan This Page
      `;
    }
  }

  showThreatDetails(result) {
    const threatList = result.threats.join(', ');
    const notification = document.createElement('div');
    notification.className = 'threat-notification';
    notification.innerHTML = `
      <div class="notification-header">⚠️ Threats Detected</div>
      <div class="notification-body">${threatList}</div>
    `;
    
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 5000);
  }

  updateStatsUI(stats) {
    const elements = {
      threatsBlocked: document.getElementById('threatsBlocked'),
      sitesScanned: document.getElementById('sitesScanned'),
      filesChecked: document.getElementById('filesChecked')
    };

    Object.keys(stats).forEach(key => {
      if (elements[key]) {
        this.animateNumber(elements[key], stats[key]);
      }
    });
  }

  animateNumber(element, targetNumber) {
    const currentNumber = parseInt(element.textContent) || 0;
    const increment = Math.ceil((targetNumber - currentNumber) / 10);
    
    if (currentNumber < targetNumber) {
      element.classList.add('updating');
      setTimeout(() => {
        element.textContent = currentNumber + increment;
        this.animateNumber(element, targetNumber);
      }, 50);
    } else {
      element.textContent = targetNumber;
      element.classList.remove('updating');
    }
  }

  updateActivityUI() {
    const activityList = document.getElementById('activityList');
    
    if (this.scanHistory.length === 0) {
      activityList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-text">No recent activity</div>
        </div>
      `;
      return;
    }

    activityList.innerHTML = this.scanHistory
      .slice(-5)
      .reverse()
      .map(activity => this.createActivityItem(activity))
      .join('');
  }

  createActivityItem(activity) {
    const timeAgo = this.getTimeAgo(activity.timestamp || activity.scanTime);
    const icon = activity.isMalicious || activity.result === 'threat' ? '⚠️' : '✅';
    const url = new URL(activity.url).hostname;
    
    return `
      <div class="activity-item">
        <div class="activity-icon">${icon}</div>
        <div class="activity-text">Scanned ${url}</div>
        <div class="activity-time">${timeAgo}</div>
      </div>
    `;
  }

  updateSettingsUI() {
    document.getElementById('realtimeScanning').checked = this.settings.realtimeScanning;
    document.getElementById('downloadProtection').checked = this.settings.downloadProtection;
    document.getElementById('scriptAnalysis').checked = this.settings.scriptAnalysis;
  }

  async updateSetting(key, value) {
    this.settings[key] = value;
    try {
      await chrome.storage.sync.set({ settings: this.settings });
      // Send message to background script to update settings
      chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: this.settings
      });
    } catch (error) {
      console.error('Error updating setting:', error);
    }
  }

  async incrementStat(statName) {
    try {
      const result = await chrome.storage.local.get(['stats']);
      const stats = result.stats || {
        threatsBlocked: 0,
        sitesScanned: 0,
        filesChecked: 0
      };
      
      stats[statName]++;
      await chrome.storage.local.set({ stats });
      this.updateStatsUI(stats);
    } catch (error) {
      console.error('Error incrementing stat:', error);
    }
  }

  addActivity(activity) {
    this.scanHistory.unshift(activity);
    if (this.scanHistory.length > 50) {
      this.scanHistory = this.scanHistory.slice(0, 50);
    }
    this.updateActivityUI();
  }

  async showHistoryModal() {
    const modal = document.getElementById('historyModal');
    modal.classList.add('show');
    
    // Load full history
    try {
      const fullHistory = await chrome.runtime.sendMessage({
        type: 'GET_SCAN_HISTORY'
      });
      
      this.fullHistory = fullHistory || [];
      this.renderHistoryList(this.fullHistory);
    } catch (error) {
      console.error('Error loading full history:', error);
    }
  }

  renderHistoryList(history) {
    const historyList = document.getElementById('historyList');
    
    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No scan history available</div>
        </div>
      `;
      return;
    }

    historyList.innerHTML = history
      .sort((a, b) => (b.timestamp || b.scanTime) - (a.timestamp || a.scanTime))
      .map(item => this.createHistoryItem(item))
      .join('');
  }

  createHistoryItem(item) {
    const timeAgo = this.getTimeAgo(item.timestamp || item.scanTime);
    const url = new URL(item.url).hostname;
    const status = item.isMalicious ? 'threat' : 'safe';
    const statusText = item.isMalicious ? 'Threat' : 'Safe';
    const icon = item.isMalicious ? '⚠️' : '✅';
    const threats = item.threats ? item.threats.length : 0;

    return `
      <div class="history-item">
        <div class="history-icon">${icon}</div>
        <div class="history-info">
          <div class="history-url" title="${item.url}">${url}</div>
          <div class="history-details">
            ${threats > 0 ? `${threats} threat${threats > 1 ? 's' : ''} detected` : 'No threats found'}
          </div>
        </div>
        <div class="history-time">${timeAgo}</div>
        <div class="history-status ${status}">${statusText}</div>
      </div>
    `;
  }

  filterHistory(filter) {
    if (!this.fullHistory) return;
    
    let filteredHistory = this.fullHistory;
    
    if (filter === 'threats') {
      filteredHistory = this.fullHistory.filter(item => item.isMalicious);
    } else if (filter === 'safe') {
      filteredHistory = this.fullHistory.filter(item => !item.isMalicious);
    }
    
    this.renderHistoryList(filteredHistory);
  }

  showReportModal() {
    const modal = document.getElementById('reportModal');
    modal.classList.add('show');
    
    // Pre-fill URL if available
    if (this.currentTab) {
      document.getElementById('issueUrl').value = this.currentTab.url;
    }
  }

  async submitReport() {
    const formData = {
      issueType: document.getElementById('issueType').value,
      url: document.getElementById('issueUrl').value,
      description: document.getElementById('issueDescription').value,
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    };

    try {
      // Store report locally
      const result = await chrome.storage.local.get(['reports']);
      const reports = result.reports || [];
      reports.push(formData);
      await chrome.storage.local.set({ reports });

      // Show success message
      this.showSuccessMessage('Report submitted successfully! Thank you for your feedback.');
      
      // Close modal and reset form
      document.getElementById('reportModal').classList.remove('show');
      document.getElementById('reportForm').reset();
      
    } catch (error) {
      console.error('Error submitting report:', error);
      this.showErrorMessage('Failed to submit report. Please try again.');
    }
  }

  showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    
    document.querySelector('.popup-container').insertBefore(
      successDiv, 
      document.querySelector('.stats-grid')
    );
    
    setTimeout(() => successDiv.remove(), 3000);
  }

  showErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    
    document.querySelector('.popup-container').insertBefore(
      errorDiv, 
      document.querySelector('.stats-grid')
    );
    
    setTimeout(() => errorDiv.remove(), 3000);
  }

  getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SecureGuardPopup();
});
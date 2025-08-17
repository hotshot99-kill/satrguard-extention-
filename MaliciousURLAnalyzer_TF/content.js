// Content script for SecureGuard Extension

class SecureGuardContent {
  constructor() {
    this.alertContainer = null;
    this.scanningBadges = new Map();
    this.scriptAnalyzer = new ScriptAnalyzer();
    this.init();
  }

  init() {
    this.setupMessageListener();
    this.scanPageScripts();
    this.monitorDOMChanges();
    this.addDownloadBadges();
    this.interceptLinks();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'SHOW_THREAT_ALERT':
          this.showThreatAlert(message.alert);
          break;
        case 'SCAN_CURRENT_PAGE':
          this.scanCurrentPage();
          break;
      }
    });
  }

  showThreatAlert(alert) {
    // Create alert container if it doesn't exist
    if (!this.alertContainer) {
      this.createAlertContainer();
    }

    const alertElement = this.createAlertElement(alert);
    this.alertContainer.appendChild(alertElement);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (alertElement.parentNode) {
        alertElement.remove();
      }
    }, 10000);
  }

  createAlertContainer() {
    this.alertContainer = document.createElement('div');
    this.alertContainer.id = 'secureguard-alert-container';
    this.alertContainer.className = 'secureguard-alert-container';
    document.body.appendChild(this.alertContainer);
  }

  createAlertElement(alert) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'secureguard-alert';
    
    const iconType = alert.type === 'download' ? '📁' : '🌐';
    const title = alert.type === 'download' ? 'Dangerous Download Blocked' : 'Suspicious Link Detected';
    
    alertDiv.innerHTML = `
      <div class="alert-header">
        <span class="alert-icon">⚠️</span>
        <span class="alert-title">${title}</span>
        <button class="alert-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="alert-body">
        <div class="alert-url">${iconType} ${this.truncateUrl(alert.url)}</div>
        <div class="alert-threats">
          <strong>Detected threats:</strong>
          <ul>
            ${alert.threats.map(threat => `<li>${threat}</li>`).join('')}
          </ul>
        </div>
        ${alert.details ? `<div class="alert-details">${alert.details}</div>` : ''}
      </div>
      <div class="alert-actions">
        <button class="btn btn-secondary" onclick="this.showPreview('${alert.url}')">Why blocked?</button>
        <button class="btn btn-secondary" onclick="this.reportFalsePositive('${alert.url}')">Report False Positive</button>
        ${alert.type === 'download' ? '<button class="btn btn-primary" onclick="this.scanAgain()">Scan Again</button>' : ''}
      </div>
    `;

    // Add event listeners
    alertDiv.querySelector('.btn').addEventListener('click', () => this.showPreview(alert));
    
    return alertDiv;
  }

  showPreview(alert) {
    const modal = document.createElement('div');
    modal.className = 'secureguard-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Threat Analysis: ${this.truncateUrl(alert.url)}</h3>
          <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
        </div>
        <div class="modal-body">
          <h4>Risk Indicators:</h4>
          <div class="risk-indicators">
            ${alert.threats.map(threat => `
              <div class="risk-item">
                <span class="risk-icon">🚨</span>
                <span class="risk-text">${threat}</span>
              </div>
            `).join('')}
          </div>
          <div class="risk-explanation">
            <h4>What this means:</h4>
            <p>This URL has been flagged because it matches known patterns of malicious websites or has been reported by security databases.</p>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.reportFalsePositive('${alert.url}')">Report as Safe</button>
          <button class="btn btn-primary" onclick="this.parentElement.parentElement.parentElement.remove()">Close</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }

  reportFalsePositive(url) {
    chrome.runtime.sendMessage({
      type: 'REPORT_FALSE_POSITIVE',
      data: {
        url: url,
        userAgent: navigator.userAgent,
        timestamp: Date.now()
      }
    });
    
    this.showNotification('Report submitted. Thank you for helping improve SecureGuard!');
  }

  showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'secureguard-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
  }

  scanPageScripts() {
    const scripts = document.querySelectorAll('script');
    scripts.forEach(script => {
      if (script.src) {
        this.analyzeExternalScript(script.src);
      } else if (script.textContent) {
        this.analyzeInlineScript(script.textContent);
      }
    });
  }

  analyzeExternalScript(src) {
    // Check if script is from suspicious domain
    const suspiciousDomains = [
      'suspicious-ads.com',
      'malware-host.net',
      'phishing-site.org'
    ];
    
    const domain = new URL(src).hostname;
    if (suspiciousDomains.some(suspicious => domain.includes(suspicious))) {
      this.flagScript(src, 'External script from suspicious domain');
    }
  }

  analyzeInlineScript(content) {
    const suspiciousPatterns = [
      /document\.write\(/i,
      /eval\(/i,
      /innerHTML\s*=/i,
      /location\.href\s*=/i,
      /window\.open\(/i,
      /document\.cookie/i,
      /localStorage/i,
      /sessionStorage/i
    ];

    const detectedPatterns = [];
    suspiciousPatterns.forEach(pattern => {
      if (pattern.test(content)) {
        detectedPatterns.push(pattern.toString());
      }
    });

    if (detectedPatterns.length > 2) {
      this.flagScript('inline', `Suspicious patterns detected: ${detectedPatterns.length} patterns`);
    }
  }

  flagScript(source, reason) {
    console.warn(`SecureGuard: Suspicious script detected - ${source}: ${reason}`);
    
    // Show subtle warning
    const warning = document.createElement('div');
    warning.className = 'secureguard-script-warning';
    warning.innerHTML = `⚠️ Suspicious script detected: ${reason}`;
    document.body.appendChild(warning);
    
    setTimeout(() => warning.remove(), 5000);
  }

  addDownloadBadges() {
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = link.href;
      const fileExtensionMatch = href.match(/\.([^./?#]+)(\?|#|$)/);
      
      if (fileExtensionMatch) {
        const extension = fileExtensionMatch[1].toLowerCase();
        const downloadableExtensions = [
          'exe', 'zip', 'rar', 'pdf', 'doc', 'docx', 
          'xls', 'xlsx', 'ppt', 'pptx', 'dmg', 'pkg'
        ];
        
        if (downloadableExtensions.includes(extension)) {
          this.addSafetyBadge(link, extension);
        }
      }
    });
  }

  addSafetyBadge(link, extension) {
    const badge = document.createElement('span');
    badge.className = 'secureguard-safety-badge';
    badge.innerHTML = `<span class="badge-icon">🔍</span>`;
    badge.title = `Click to scan ${extension.toUpperCase()} file`;
    
    // Add click handler for manual scan
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.scanDownloadLink(link.href);
    });
    
    link.appendChild(badge);
    
    // Auto-scan the link
    this.scanDownloadLink(link.href, badge);
  }

  async scanDownloadLink(url, badge) {
    if (badge) {
      badge.className = 'secureguard-safety-badge scanning';
      badge.innerHTML = `<span class="badge-icon">⏳</span>`;
    }
    
    try {
      const result = await this.sendMessage({
        type: 'SCAN_URL',
        url: url
      });
      
      if (badge) {
        if (result.isMalicious) {
          badge.className = 'secureguard-safety-badge dangerous';
          badge.innerHTML = `<span class="badge-icon">❌</span>`;
          badge.title = `Dangerous file detected: ${result.threats.join(', ')}`;
        } else {
          badge.className = 'secureguard-safety-badge safe';
          badge.innerHTML = `<span class="badge-icon">✅</span>`;
          badge.title = 'File appears safe';
        }
      }
    } catch (error) {
      console.error('Error scanning download link:', error);
      if (badge) {
        badge.className = 'secureguard-safety-badge error';
        badge.innerHTML = `<span class="badge-icon">⚠️</span>`;
        badge.title = 'Scan error - click to retry';
      }
    }
  }

  interceptLinks() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link && this.isExternalLink(link.href)) {
        e.preventDefault();
        this.checkLinkSafety(link.href, () => {
          window.location.href = link.href;
        });
      }
    });
  }

  isExternalLink(url) {
    try {
      const linkDomain = new URL(url).hostname;
      return linkDomain !== window.location.hostname;
    } catch {
      return false;
    }
  }

  async checkLinkSafety(url, callback) {
    try {
      const result = await this.sendMessage({
        type: 'SCAN_URL',
        url: url
      });
      
      if (result.isMalicious) {
        if (confirm(`⚠️ This link has been flagged as potentially dangerous.\n\nThreats detected:\n${result.threats.join('\n')}\n\nDo you still want to continue?`)) {
          callback();
        }
      } else {
        callback();
      }
    } catch (error) {
      console.error('Error checking link safety:', error);
      callback(); // Proceed if scan fails
    }
  }

  monitorDOMChanges() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) { // Element node
              // Check for new scripts
              const scripts = node.querySelectorAll ? node.querySelectorAll('script') : [];
              scripts.forEach(script => {
                if (script.src) {
                  this.analyzeExternalScript(script.src);
                } else if (script.textContent) {
                  this.analyzeInlineScript(script.textContent);
                }
              });
              
              // Check for new download links
              const links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
              links.forEach(link => {
                const href = link.href;
                const fileExtensionMatch = href.match(/\.([^./?#]+)(\?|#|$)/);
                if (fileExtensionMatch) {
                  const extension = fileExtensionMatch[1].toLowerCase();
                  const downloadableExtensions = [
                    'exe', 'zip', 'rar', 'pdf', 'doc', 'docx', 
                    'xls', 'xlsx', 'ppt', 'pptx', 'dmg', 'pkg'
                  ];
                  
                  if (downloadableExtensions.includes(extension)) {
                    this.addSafetyBadge(link, extension);
                  }
                }
              });
            }
          });
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  truncateUrl(url) {
    return url.length > 50 ? url.substring(0, 47) + '...' : url;
  }

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }
}

// Script analyzer class
class ScriptAnalyzer {
  constructor() {
    this.suspiciousPatterns = [
      { pattern: /document\.cookie/gi, threat: 'Cookie access detected' },
      { pattern: /localStorage|sessionStorage/gi, threat: 'Local storage access' },
      { pattern: /window\.location.*=/gi, threat: 'Redirection attempt' },
      { pattern: /eval\(/gi, threat: 'Dynamic code execution' },
      { pattern: /new Function\(/gi, threat: 'Dynamic function creation' },
      { pattern: /document\.write/gi, threat: 'DOM manipulation' },
      { pattern: /iframe.*src/gi, threat: 'Iframe injection' },
      { pattern: /XMLHttpRequest|fetch/gi, threat: 'Network request' }
    ];
  }

  analyze(script) {
    const threats = [];
    this.suspiciousPatterns.forEach(({ pattern, threat }) => {
      if (pattern.test(script)) {
        threats.push(threat);
      }
    });
    return threats;
  }
}

// Initialize the content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new SecureGuardContent());
} else {
  new SecureGuardContent();
}
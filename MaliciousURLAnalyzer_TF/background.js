// Background service worker for SecureGuard Extension

class SecureGuardService {
  constructor() {
    this.safeBrowsingCache = new Map();
    this.virusTotalCache = new Map();
    this.quarantinedFiles = new Set();
    this.init();
  }

  init() {
    this.setupWebRequestListeners();
    this.setupDownloadListeners();
    this.setupMessageListeners();
  }

  // Google Safe Browsing API integration
  async checkSafeBrowsing(urls) {
    const API_KEY = 'YOUR_GOOGLE_SAFE_BROWSING_API_KEY'; // Replace with your actual API key
    const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`;
    
    const requestBody = {
      client: {
        clientId: 'secureguard-extension',
        clientVersion: '1.0.0'
      },
      threatInfo: {
        threatTypes: [
          'MALWARE',
          'SOCIAL_ENGINEERING',
          'UNWANTED_SOFTWARE',
          'POTENTIALLY_HARMFUL_APPLICATION'
        ],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: urls.map(url => ({ url }))
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      return await response.json();
    } catch (error) {
      console.error('Safe Browsing API error:', error);
      return null;
    }
  }

  // VirusTotal API integration
  async checkVirusTotal(url) {
    const API_KEY = '2d13550ab8bc011a923bacbdc578affe35e35e4f9959a4ca47c675083894948d'; // Replace with your actual API key
    const encodedUrl = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const endpoint = `https://www.virustotal.com/api/v3/urls/${encodedUrl}`;
    
    try {
      const response = await fetch(endpoint, {
        headers: { 'x-apikey': API_KEY }
      });
      
      return await response.json();
    } catch (error) {
      console.error('VirusTotal API error:', error);
      return null;
    }
  }

  // Analyze URL for suspicious patterns
  analyzeUrlPattern(url) {
    const suspiciousPatterns = [
      /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/, // IP addresses
      /[a-z0-9]{20,}\./, // Very long subdomains
      /-(secure|bank|login|account|verify|update)\./, // Suspicious keywords
      /\.(tk|ml|ga|cf)$/, // Suspicious TLDs
      /[0-9]{4,}/, // Long number sequences
      /[a-zA-Z]\.bit/, // Suspicious extensions
    ];

    const risks = [];
    suspiciousPatterns.forEach((pattern, index) => {
      if (pattern.test(url)) {
        const riskTypes = [
          'Uses IP address instead of domain',
          'Unusually long subdomain',
          'Contains banking/security keywords',
          'Uses suspicious top-level domain',
          'Contains unusual number sequences',
          'Uses suspicious extension'
        ];
        risks.push(riskTypes[index]);
      }
    });

    return risks;
  }

  setupWebRequestListeners() {
    chrome.webRequest.onBeforeRequest.addListener(
      async (details) => {
        if (details.type === 'main_frame') {
          await this.scanUrl(details.url, details.tabId);
        }
      },
      { urls: ['<all_urls>'] },
      ['requestBody']
    );
  }

  setupDownloadListeners() {
    chrome.downloads.onDeterminingFilename.addListener(async (downloadItem, suggest) => {
      const scanResult = await this.scanDownload(downloadItem);
      
      if (scanResult.isMalicious) {
        this.quarantinedFiles.add(downloadItem.id);
        suggest({ filename: `QUARANTINED_${downloadItem.filename}` });
        
        this.showThreatAlert({
          type: 'download',
          url: downloadItem.url,
          filename: downloadItem.filename,
          threats: scanResult.threats
        });
        
        chrome.downloads.cancel(downloadItem.id);
      }
    });
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'SCAN_URL':
          this.scanUrl(message.url, sender.tab?.id).then(sendResponse);
          return true;
        case 'REPORT_FALSE_POSITIVE':
          this.reportFalsePositive(message.data);
          break;
        case 'REPORT_FALSE_NEGATIVE':
          this.reportFalseNegative(message.data);
          break;
        case 'GET_SCAN_HISTORY':
          this.getScanHistory().then(sendResponse);
          return true;
      }
    });
  }

  async scanUrl(url, tabId) {
    try {
      // Quick pattern analysis first
      const patternRisks = this.analyzeUrlPattern(url);
      
      // Check cache first
      if (this.safeBrowsingCache.has(url)) {
        const cachedResult = this.safeBrowsingCache.get(url);
        if (Date.now() - cachedResult.timestamp < 300000) { // 5 minutes
          return cachedResult.data;
        }
      }

      // Primary scan with Google Safe Browsing
      const safeBrowsingResult = await this.checkSafeBrowsing([url]);
      
      let isMalicious = false;
      let threats = [];
      
      if (safeBrowsingResult?.matches?.length > 0) {
        isMalicious = true;
        threats = safeBrowsingResult.matches.map(match => match.threatType);
      }

      if (patternRisks.length > 0) {
        threats = threats.concat(patternRisks);
        if (patternRisks.length > 2) isMalicious = true;
      }

      const result = {
        url,
        isMalicious,
        threats,
        scanTime: Date.now(),
        source: 'safe_browsing'
      };

      // Cache the result
      this.safeBrowsingCache.set(url, {
        data: result,
        timestamp: Date.now()
      });

      // If suspicious but not confirmed malicious, do deeper scan
      if (!isMalicious && (threats.length > 0 || patternRisks.length > 0)) {
        setTimeout(() => this.deepScanUrl(url, tabId), 1000);
      }

      if (isMalicious && tabId) {
        this.showThreatAlert({ type: 'url', url, threats }, tabId);
      }

      return result;
    } catch (error) {
      console.error('Error scanning URL:', error);
      return { url, isMalicious: false, threats: [], error: error.message };
    }
  }

  async deepScanUrl(url, tabId) {
    const virusTotalResult = await this.checkVirusTotal(url);
    
    if (virusTotalResult?.data?.attributes) {
      const stats = virusTotalResult.data.attributes.last_analysis_stats;
      const maliciousCount = stats.malicious || 0;
      const suspiciousCount = stats.suspicious || 0;
      
      if (maliciousCount > 0 || suspiciousCount > 2) {
        this.showThreatAlert({
          type: 'deep_scan',
          url,
          threats: ['Deep scan detected threats'],
          details: `${maliciousCount} engines flagged as malicious, ${suspiciousCount} as suspicious`
        }, tabId);
      }
    }
  }

  async scanDownload(downloadItem) {
    const fileExtensions = downloadItem.filename.split('.');
    const extension = fileExtensions[fileExtensions.length - 1].toLowerCase();
    
    const dangerousExtensions = [
      'exe', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'js',
      'jar', 'msi', 'app', 'dmg', 'pkg', 'deb', 'rpm'
    ];

    let isMalicious = false;
    let threats = [];

    if (dangerousExtensions.includes(extension)) {
      threats.push(`Potentially dangerous file type: .${extension}`);
    }

    // Check download URL
    const urlScan = await this.scanUrl(downloadItem.url);
    if (urlScan.isMalicious) {
      isMalicious = true;
      threats = threats.concat(urlScan.threats);
    }

    return { isMalicious, threats };
  }

  async showThreatAlert(alert, tabId) {
    // Send message to content script to show alert
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_THREAT_ALERT',
          alert
        });
      } catch (error) {
        console.error('Error sending alert to content script:', error);
      }
    }

    // Also show browser notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png',
      title: 'SecureGuard - Threat Detected',
      message: `⚠️ ${alert.type === 'url' ? 'Suspicious URL' : 'Dangerous Download'}: ${alert.url}`
    });
  }

  async reportFalsePositive(data) {
    // Store false positive report
    const reports = await chrome.storage.local.get('falsePositives') || { falsePositives: [] };
    reports.falsePositives.push({
      ...data,
      timestamp: Date.now(),
      type: 'false_positive'
    });
    await chrome.storage.local.set({ falsePositives: reports.falsePositives });
  }

  async reportFalseNegative(data) {
    // Store false negative report
    const reports = await chrome.storage.local.get('falseNegatives') || { falseNegatives: [] };
    reports.falseNegatives.push({
      ...data,
      timestamp: Date.now(),
      type: 'false_negative'
    });
    await chrome.storage.local.set({ falseNegatives: reports.falseNegatives });
  }

  async getScanHistory() {
    const history = await chrome.storage.local.get('scanHistory') || { scanHistory: [] };
    return history.scanHistory.slice(-100); // Return last 100 scans
  }
}

// Initialize the service
new SecureGuardService();

chrome.sidePanel.setOptions({
  path: "panel.html",
  enabled: true
});

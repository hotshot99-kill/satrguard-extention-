# SecureGuard - Malicious URL & Phishing Detector Chrome Extension

A comprehensive Chrome extension that provides real-time protection against malicious URLs, phishing attempts, and dangerous downloads using Google Safe Browsing API and VirusTotal API.

## 🛡️ Features

### Real-time URL Protection
- **Primary Defense**: Google Safe Browsing API for fast, reliable threat detection
- **Deep Scanning**: VirusTotal API for comprehensive analysis
- **Pattern Analysis**: Static analysis of suspicious URL patterns
- **Real-time Alerts**: Instant notifications with friendly animations

### Advanced Script Monitoring
- **Inline Script Analysis**: Monitor page scripts for malicious patterns
- **Third-party Script Scanning**: Check external script sources
- **Behavior Analysis**: Flag scripts attempting DOM manipulation, session hijacking, or drive-by downloads
- **Dynamic + Static Analysis**: Code pattern detection with sandbox simulation

### Download Protection
- **File Safety Badges**: Visual indicators next to download links
- **Quarantine Feature**: Block suspicious downloads automatically
- **File Type Analysis**: Enhanced scanning for executable and document files
- **User Control**: "Scan Again" and "Why blocked?" options

### User Experience
- **Friendly Notifications**: Corner pop-ups with smooth animations
- **Preview Panels**: Detailed threat analysis with explanations
- **False Positive Reporting**: Allow users to report incorrect detections
- **Comprehensive Dashboard**: View scan history, statistics, and settings

## 📁 File Structure

```
SecureGuard-Extension/
├── manifest.json          # Extension configuration
├── background.js          # Service worker with API integrations
├── content.js            # Content script for page monitoring
├── content.css           # Styles for alerts and badges
├── popup.html            # Extension popup interface
├── popup.css             # Popup styling
├── popup.js              # Popup functionality
├── alert.html            # Threat warning page
├── icons/                # Extension icons (16x16, 32x32, 48x48, 128x128)
└── README.md             # This file
```

## 🚀 Installation & Setup

### Step 1: Get API Keys

1. **Google Safe Browsing API**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable the Safe Browsing API
   - Create credentials and get your API key
   - Replace `YOUR_GOOGLE_SAFE_BROWSING_API_KEY` in `background.js`

2. **VirusTotal API**:
   - Sign up at [VirusTotal](https://www.virustotal.com/)
   - Go to your profile and get your API key
   - Replace `YOUR_VIRUSTOTAL_API_KEY` in `background.js`

### Step 2: Prepare Extension Files

1. Create a new folder called `SecureGuard-Extension`
2. Copy all the provided files into this folder
3. Create an `icons` folder and add extension icons:
   - `icon-16.png` (16x16 pixels)
   - `icon-32.png` (32x32 pixels)
   - `icon-48.png` (48x48 pixels)
   - `icon-128.png` (128x128 pixels)

### Step 3: Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select your `SecureGuard-Extension` folder
5. The extension should now appear in your extensions list

### Step 4: Configure Extension

1. Click the SecureGuard icon in your browser toolbar
2. Review and adjust protection settings:
   - Real-time Scanning
   - Download Protection  
   - Script Analysis
3. Test the extension on a safe website

## ⚙️ Configuration Options

### Protection Settings
- **Real-time Scanning**: Automatically scan all URLs as you browse
- **Download Protection**: Scan files before allowing downloads
- **Script Analysis**: Monitor page scripts for suspicious behavior

### Advanced Settings
- **API Rate Limiting**: Automatically manages API request limits
- **Cache Duration**: Controls how long scan results are cached (default: 5 minutes)
- **Threat Thresholds**: Customize sensitivity levels for different threat types

## 🔧 Customization

### Adding New Threat Patterns
Edit the `analyzeUrlPattern()` function in `background.js`:

```javascript
const suspiciousPatterns = [
  /your-new-pattern-here/,
  // Add more patterns...
];
```

### Modifying Alert Styles
Update `content.css` to customize alert appearance:

```css
.secureguard-alert {
  /* Your custom styles */
}
```

### Extending Script Analysis
Add new suspicious patterns to the `ScriptAnalyzer` class in `content.js`:

```javascript
this.suspiciousPatterns = [
  { pattern: /your-pattern/, threat: 'Your threat description' },
  // Add more patterns...
];
```

## 🔍 How It Works

### URL Scanning Process
1. **Primary Scan**: Google Safe Browsing API checks URL against known threat databases
2. **Pattern Analysis**: Local analysis for suspicious URL characteristics
3. **Cache Check**: Avoid duplicate API calls for recently scanned URLs
4. **Deep Scan**: VirusTotal API for additional verification if needed
5. **User Alert**: Display results with actionable options

### Script Monitoring
1. **DOM Monitoring**: Watch for new scripts added to pages
2. **Pattern Matching**: Check script content against known malicious patterns
3. **Behavior Analysis**: Monitor script actions like cookie access, redirections
4. **Real-time Alerts**: Warn users of suspicious script activity

### Download Protection
1. **Link Analysis**: Scan download URLs before file access
2. **File Type Check**: Enhanced security for executable files
3. **Safety Badges**: Visual indicators showing scan status
4. **Quarantine System**: Block dangerous downloads automatically

## 🐛 Troubleshooting

### Common Issues

**Extension not loading:**
- Check that all files are in the correct directory
- Verify manifest.json syntax is valid
- Ensure you have Developer Mode enabled

**API errors:**
- Verify API keys are correctly set in background.js
- Check API quotas and billing settings
- Ensure APIs are enabled in your Google Cloud project

**Alerts not appearing:**
- Check if content script permissions are granted
- Verify the website allows content script injection
- Look for browser console errors

**False positives:**
- Use the "Report False Positive" feature in alerts
- Adjust threat sensitivity in settings
- Add trusted domains to whitelist (custom implementation needed)

### Debug Mode
To enable debug logging, add this to background.js:

```javascript
const DEBUG_MODE = true;
if (DEBUG_MODE) {
  console.log('SecureGuard Debug:', message);
}
```

## 📊 Performance Considerations

- **API Rate Limits**: Google Safe Browsing allows 10,000 requests/day (free tier)
- **VirusTotal Limits**: 4 requests/minute (free tier)
- **Caching**: Results cached for 5 minutes to reduce API calls
- **Background Processing**: Minimal impact on page loading times

## 🔒 Privacy & Security

- **No Data Collection**: Extension doesn't store personal browsing data
- **Local Processing**: Pattern analysis performed locally
- **Secure API Calls**: All API communications use HTTPS
- **User Control**: Users can disable features and report false positives

## 📈 Future Enhancements

- **Machine Learning**: AI-powered threat detection
- **Community Database**: User-contributed threat intelligence
- **Mobile Support**: Extension for mobile browsers
- **Enterprise Features**: Centralized management and reporting
- **Additional APIs**: Integration with more security services

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and bug reports:
1. Check the troubleshooting section above
2. Review browser console for errors
3. Use the extension's "Report Issue" feature
4. Create an issue in the project repository

## 📝 Changelog

### Version 1.0.0
- Initial release
- Google Safe Browsing API integration
- VirusTotal API integration
- Real-time URL scanning
- Download protection
- Script analysis
- User reporting system
- Comprehensive UI/UX

---

**⚠️ Security Notice**: This extension is designed to enhance your browsing security but should not be your only line of defense. Always keep your browser and operating system updated, use reputable antivirus software, and exercise caution when browsing unknown websites.

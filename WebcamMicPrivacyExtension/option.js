// options.js

// This script implements the logic for the Privacy Guard extension's options page.
// It uses a class-based structure for better organization and leverages the
// chrome.storage.sync API to manage settings across the user's devices.

class OptionsManager {
    constructor() {
        this.settings = {};
        this.elements = {};
        this.init();
    }

    /**
     * Initializes the application. This is the main entry point of the script.
     * It loads settings, sets up UI elements, and attaches event listeners.
     */
    async init() {
        this.getDOMElements();
        await this.loadSettings();
        this.setupEventListeners();
        this.updateUI();
        this.loadStatistics();
    }

    /**
     * Gathers all the necessary DOM elements and stores them in a map.
     * This method is called once on initialization to avoid repeated DOM queries.
     */
    getDOMElements() {
        this.elements = {
            // Checkboxes
            webcamBlocked: document.getElementById('webcamBlocked'),
            micBlocked: document.getElementById('micBlocked'),
            autoBlockBackground: document.getElementById('autoBlockBackground'),
            fakeMediaEnabled: document.getElementById('fakeMediaEnabled'),
            detectSuspicious: document.getElementById('detectSuspicious'),
            showNotifications: document.getElementById('showNotifications'),
            notificationSound: document.getElementById('notificationSound'),
            highPriorityAlerts: document.getElementById('highPriorityAlerts'),
            logActivity: document.getElementById('logActivity'),
            logTechnicalDetails: document.getElementById('logTechnicalDetails'),
            // Dropdown
            logRetention: document.getElementById('logRetention'),
            // Buttons
            saveSettingsBtn: document.getElementById('saveSettings'),
            viewLogsBtn: document.getElementById('viewLogs'),
            manageTrustedSitesBtn: document.getElementById('manageTrustedSites'),
            manageBlockedSitesBtn: document.getElementById('manageBlockedSites'),
            resetPermissionsBtn: document.getElementById('resetPermissions'),
            exportLogsBtn: document.getElementById('exportLogs'),
            clearLogsBtn: document.getElementById('clearLogs'),
            resetExtensionBtn: document.getElementById('resetExtension'),
            // Statistics
            totalBlocked: document.getElementById('totalBlocked'),
            totalAllowed: document.getElementById('totalAllowed'),
            sitesProtected: document.getElementById('sitesProtected'),
            fakeStreams: document.getElementById('fakeStreams'),
            // Modal elements
            siteModal: document.getElementById('siteModal'),
            siteModalTitle: document.getElementById('siteModalTitle'),
            closeSiteModalBtn: document.getElementById('closeSiteModal'),
            siteInput: document.getElementById('siteInput'),
            addSiteBtn: document.getElementById('addSite'),
            siteList: document.getElementById('siteList')
        };
    }

    /**
     * Loads settings from Chrome's synchronized storage and sets default values if
     * no settings are found.
     */
    async loadSettings() {
        this.settings = await new Promise(resolve => {
            chrome.storage.sync.get({
                webcamBlocked: true,
                micBlocked: true,
                autoBlockBackground: true,
                fakeMediaEnabled: false,
                detectSuspicious: true,
                showNotifications: true,
                notificationSound: true,
                highPriorityAlerts: true,
                logActivity: true,
                logTechnicalDetails: true,
                logRetention: '30',
                trustedSites: ['google.com', 'zoom.us'],
                blockedSites: []
            }, (items) => {
                resolve(items);
            });
        });
    }

    /**
     * Updates the UI elements to reflect the current settings loaded from storage.
     */
    updateUI() {
        // Populate checkboxes
        this.elements.webcamBlocked.checked = this.settings.webcamBlocked;
        this.elements.micBlocked.checked = this.settings.micBlocked;
        this.elements.autoBlockBackground.checked = this.settings.autoBlockBackground;
        this.elements.fakeMediaEnabled.checked = this.settings.fakeMediaEnabled;
        this.elements.detectSuspicious.checked = this.settings.detectSuspicious;
        this.elements.showNotifications.checked = this.settings.showNotifications;
        this.elements.notificationSound.checked = this.settings.notificationSound;
        this.elements.highPriorityAlerts.checked = this.settings.highPriorityAlerts;
        this.elements.logActivity.checked = this.settings.logActivity;
        this.elements.logTechnicalDetails.checked = this.settings.logTechnicalDetails;
        // Populate dropdown
        this.elements.logRetention.value = this.settings.logRetention;
    }

    /**
     * Saves all current UI settings back to Chrome's synchronized storage.
     */
    async saveSettings() {
        const settingsToSave = {
            webcamBlocked: this.elements.webcamBlocked.checked,
            micBlocked: this.elements.micBlocked.checked,
            autoBlockBackground: this.elements.autoBlockBackground.checked,
            fakeMediaEnabled: this.elements.fakeMediaEnabled.checked,
            detectSuspicious: this.elements.detectSuspicious.checked,
            showNotifications: this.elements.showNotifications.checked,
            notificationSound: this.elements.notificationSound.checked,
            highPriorityAlerts: this.elements.highPriorityAlerts.checked,
            logActivity: this.elements.logActivity.checked,
            logTechnicalDetails: this.elements.logTechnicalDetails.checked,
            logRetention: this.elements.logRetention.value,
        };

        // Update settings in the class instance and storage
        Object.assign(this.settings, settingsToSave);
        await new Promise(resolve => {
            chrome.storage.sync.set(settingsToSave, () => {
                resolve();
            });
        });
        console.log('Settings saved:', this.settings);
        this.showMessage('Settings saved successfully!');
    }

    /**
     * Displays dummy statistics on the page. In a real extension, this would
     * fetch real data from storage.
     */
    loadStatistics() {
        // Placeholder data. In a real-world scenario, you would fetch this
        // data from chrome.storage.local or chrome.storage.sync.
        const stats = {
            totalBlocked: 145,
            totalAllowed: 23,
            sitesProtected: 12,
            fakeStreams: 5,
        };
        this.elements.totalBlocked.textContent = stats.totalBlocked;
        this.elements.totalAllowed.textContent = stats.totalAllowed;
        this.elements.sitesProtected.textContent = stats.sitesProtected;
        this.elements.fakeStreams.textContent = stats.fakeStreams;
    }

    /**
     * Populates the site list in the modal with sites from storage.
     * @param {string} listType - 'trusted' or 'blocked'.
     */
    async populateSiteList(listType) {
        const sites = this.settings[listType + 'Sites'];
        this.elements.siteList.innerHTML = '';
        if (sites.length === 0) {
            this.elements.siteList.innerHTML = '<p class="text-gray-500 text-center py-4">No sites added yet.</p>';
            return;
        }

        sites.forEach(site => {
            const siteItem = document.createElement('div');
            siteItem.className = 'site-item flex justify-between items-center bg-gray-100 p-2 rounded-lg my-2';
            siteItem.innerHTML = `
                <span>${site}</span>
                <button class="remove-site-btn text-red-500 hover:text-red-700 transition-colors duration-200" data-site="${site}" data-list-type="${listType}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            `;
            this.elements.siteList.appendChild(siteItem);
        });

        // Add event listeners for remove buttons
        this.elements.siteList.querySelectorAll('.remove-site-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                const siteToRemove = event.currentTarget.dataset.site;
                const listType = event.currentTarget.dataset.listType;
                this.removeSite(siteToRemove, listType);
            });
        });
    }

    /**
     * Adds a new site to the specified list in storage.
     * @param {string} listType - 'trusted' or 'blocked'.
     */
    async addSite(listType) {
        const newSite = this.elements.siteInput.value.trim();
        if (!newSite) return;

        let sites = this.settings[listType + 'Sites'];
        if (!sites.includes(newSite)) {
            sites.push(newSite);
            await new Promise(resolve => {
                chrome.storage.sync.set({ [listType + 'Sites']: sites }, () => {
                    this.settings[listType + 'Sites'] = sites;
                    this.populateSiteList(listType);
                    this.elements.siteInput.value = '';
                    resolve();
                });
            });
        } else {
            this.showMessage(`"${newSite}" is already in the list.`);
        }
    }

    /**
     * Removes a site from the specified list in storage.
     * @param {string} siteToRemove - The site to remove.
     * @param {string} listType - 'trusted' or 'blocked'.
     */
    async removeSite(siteToRemove, listType) {
        let sites = this.settings[listType + 'Sites'];
        sites = sites.filter(site => site !== siteToRemove);
        await new Promise(resolve => {
            chrome.storage.sync.set({ [listType + 'Sites']: sites }, () => {
                this.settings[listType + 'Sites'] = sites;
                this.populateSiteList(listType);
                this.showMessage(`Removed ${siteToRemove} from the list.`);
                resolve();
            });
        });
    }

    /**
     * Clears all activity logs.
     */
    async clearLogs() {
        // In a real extension, this would clear log data in storage.
        console.log('Clearing activity logs...');
        this.showMessage('Activity logs cleared.');
        this.loadStatistics();
    }

    /**
     * Resets all extension settings to default values.
     */
    async resetExtension() {
        await new Promise(resolve => {
            chrome.storage.sync.clear(() => {
                console.log('Extension settings have been reset to defaults.');
                this.loadSettings().then(() => {
                    this.updateUI();
                    this.loadStatistics();
                    this.showMessage('All settings have been reset.');
                    resolve();
                });
            });
        });
    }

    /**
     * Sets up all event listeners for the interactive elements.
     */
    setupEventListeners() {
        // Listen for changes on checkboxes and the dropdown to trigger a save.
        ['webcamBlocked', 'micBlocked', 'autoBlockBackground', 'fakeMediaEnabled', 'detectSuspicious', 'showNotifications', 'notificationSound', 'highPriorityAlerts', 'logActivity', 'logTechnicalDetails'].forEach(id => {
            this.elements[id].addEventListener('change', () => this.saveSettings());
        });
        this.elements.logRetention.addEventListener('change', () => this.saveSettings());

        // Handle button clicks
        this.elements.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
        this.elements.viewLogsBtn.addEventListener('click', () => {
            console.log('Opening activity log page...');
        });
        this.elements.manageTrustedSitesBtn.addEventListener('click', () => this.openSiteModal('trusted'));
        this.elements.manageBlockedSitesBtn.addEventListener('click', () => this.openSiteModal('blocked'));
        this.elements.resetPermissionsBtn.addEventListener('click', () => this.resetPermissions());
        this.elements.exportLogsBtn.addEventListener('click', () => {
            console.log('Exporting activity logs...');
            this.showMessage('Logs are being exported. Check your downloads.');
        });
        this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        this.elements.resetExtensionBtn.addEventListener('click', () => this.resetExtension());

        // Modal event listeners
        this.elements.closeSiteModalBtn.addEventListener('click', () => this.elements.siteModal.style.display = 'none');
        this.elements.addSiteBtn.addEventListener('click', (event) => {
            const listType = this.elements.siteModalTitle.textContent.includes('Trusted') ? 'trusted' : 'blocked';
            this.addSite(listType);
        });
    }
    
    /**
     * Helper to open the site management modal and populate it.
     * @param {string} listType - 'trusted' or 'blocked'.
     */
    openSiteModal(listType) {
        this.elements.siteModalTitle.textContent = `Manage ${listType === 'trusted' ? 'Trusted' : 'Blocked'} Sites`;
        this.populateSiteList(listType);
        this.elements.siteModal.style.display = 'flex';
    }

    /**
     * Clears trusted and blocked site permissions.
     */
    async resetPermissions() {
        await new Promise(resolve => {
            chrome.storage.sync.set({
                trustedSites: [],
                blockedSites: []
            }, () => {
                this.settings.trustedSites = [];
                this.settings.blockedSites = [];
                this.showMessage('All site permissions have been reset.');
                resolve();
            });
        });
    }

    /**
     * A utility function to display a temporary message.
     * @param {string} message - The message to display.
     */
    showMessage(message) {
        console.log(message); // For debugging
        // You would typically implement a visible message box here.
    }
}

// Instantiate the class to start the application
new OptionsManager();

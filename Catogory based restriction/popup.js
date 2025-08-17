// popup.js
document.addEventListener("DOMContentLoaded", () => {
  // Helper to read DOM elements once
  const el = id => document.getElementById(id);

  // Load saved preferences
  chrome.storage.local.get(["preferences", "schedule", "browsingProfile", "parentalPin", "blockedCategories"], (data) => {
    const prefs = data.preferences || data.blockedCategories || {};
    el("adultContent").checked = !!prefs.adultContent;
    el("gambling").checked = !!prefs.gambling;
    el("datingSites").checked = !!prefs.datingSites;
    el("socialMedia").checked = !!prefs.socialMedia;
    el("violentContent").checked = !!prefs.violentContent;
    el("politicalMisinformation").checked = !!prefs.politicalMisinformation;
    el("jobScams").checked = !!prefs.jobScams;

    if (data.schedule) {
      el("scheduleStart").value = data.schedule.start || "";
      el("scheduleEnd").value = data.schedule.end || "";
      const daysSelect = el("scheduleDays");
      [...daysSelect.options].forEach(option => {
        option.selected = data.schedule.days?.includes(option.value);
      });
    }

    if (data.browsingProfile) {
      el("profileSelect").value = data.browsingProfile;
    }
    if (data.parentalPin) {
      el("setPin").value = "";
    }
  });

  // Save preferences
  el("saveButton").addEventListener("click", () => {
    const preferences = {
      adultContent: el("adultContent").checked,
      gambling: el("gambling").checked,
      datingSites: el("datingSites").checked,
      socialMedia: el("socialMedia").checked,
      violentContent: el("violentContent").checked,
      politicalMisinformation: el("politicalMisinformation").checked,
      jobScams: el("jobScams").checked
    };

    // Save under both 'preferences' and 'blockedCategories' for compatibility
    chrome.storage.local.set({ preferences, blockedCategories: preferences }, () => {
      // Notify background to update immediately
      chrome.runtime.sendMessage({ action: "updatePreferences", data: preferences }, (res) => {
        // simple UI feedback
        alert("Preferences saved!");
      });
    });
  });

  // Reset button
  el("resetButton").addEventListener("click", () => {
    if (!confirm("Reset to default (unblock all)?")) return;
    const defaults = {
      adultContent: false,
      gambling: false,
      datingSites: false,
      socialMedia: false,
      violentContent: false,
      politicalMisinformation: false,
      jobScams: false
    };
    chrome.storage.local.set({ preferences: defaults, blockedCategories: defaults }, () => {
      chrome.runtime.sendMessage({ action: "updatePreferences", data: defaults });
      // update UI
      for (const key in defaults) {
        const elKey = document.getElementById(key);
        if (elKey) elKey.checked = defaults[key];
      }
      alert("Reset applied.");
    });
  });

  // Apply Profile Mode
  el("profileSelect").addEventListener("change", (e) => {
    const mode = e.target.value;
    chrome.storage.local.set({ browsingProfile: mode });

    const prefs = {
      adultContent: false,
      gambling: false,
      datingSites: false,
      socialMedia: false,
      violentContent: false,
      politicalMisinformation: false,
      jobScams: false
    };

    if (mode === "child") {
      prefs.adultContent = true;
      prefs.gambling = true;
      prefs.datingSites = true;
      prefs.socialMedia = true;
    } else if (mode === "work") {
      prefs.socialMedia = true;
      prefs.jobScams = true;
    } else if (mode === "full") {
      for (let k in prefs) prefs[k] = true;
    }

    // Set UI and save
    for (let key in prefs) {
      const node = document.getElementById(key);
      if (node) node.checked = prefs[key];
    }

    chrome.storage.local.set({ preferences: prefs, blockedCategories: prefs }, () => {
      chrome.runtime.sendMessage({ action: "updatePreferences", data: prefs });
      alert("Profile applied.");
    });
  });

  // Set Schedule
  el("applyScheduleBtn").addEventListener("click", () => {
    const start = el("scheduleStart").value;
    const end = el("scheduleEnd").value;
    const days = [...el("scheduleDays").selectedOptions].map(opt => opt.value);

    const schedule = { start, end, days };
    // In this simplified UI we just save one schedule rule per popup. For extended rules, use a settings page.
    chrome.storage.local.set({ schedule }, () => {
      alert("Schedule saved.");
    });
  });

  // Set Parental Control PIN
  el("setPinBtn").addEventListener("click", () => {
    const pin = el("setPin").value.trim();
    if (pin.length < 4) {
      alert("PIN must be at least 4 characters.");
      return;
    }
    chrome.storage.local.set({ parentalPin: pin }, () => {
      alert("PIN saved.");
      el("setPin").value = "";
      // ensure background reloads settings
      chrome.runtime.sendMessage({ action: "reloadSettings" });
    });
  });
});

chrome.runtime.onInstalled.addListener(() => {
    console.log("Ultimate Privacy Ad Blocker Installed & Active!");
});

// Intercept network requests and block trackers
chrome.webRequest.onBeforeRequest.addListener(
    function (details) {
        return { cancel: true };
    },
    { urls: [
        "*://*.google-analytics.com/*",
        "*://*.hotjar.com/*",
        "*://*.sentry.io/*",
        "*://*.bugsnag.com/*",
        "*://*.doubleclick.net/*",
        "*://*.googlesyndication.com/*"
    ] },
    ["blocking"]
);

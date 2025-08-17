(function () {
    // Override tracking functions
    const originalGtag = window.gtag;
    window.gtag = function() {
        const args = Array.from(arguments);
        if (args[0] === "event" && args[1] === "page_view") {
            // Allow legitimate page view tracking
            originalGtag.apply(this, args);
        } else {
            console.log("Blocked gtag event:", args);
        }
    };

    const originalGa = window.ga;
    window.ga = function() {
        console.log("Blocked ga event:", arguments);
    };

    const originalGaTracker = window.__gaTracker;
    window.__gaTracker = function() {
        console.log("Blocked __gaTracker event:", arguments);
    };

    console.log("Google Analytics Blocked");

    // Hotjar Override
    Object.defineProperty(window, "hj", { get: function() { return function() {}; } });
    console.log("Hotjar Blocked");

    // Sentry & Bugsnag Override
    window.Sentry = { init: function() {} };
    window.Bugsnag = { start: function() {} };
    console.log("Sentry & Bugsnag Blocked");

    // Block static image ads
    const blockImage = img => {
        const src = img.src.toLowerCase();
        if (src.includes("adserver") || src.includes("doubleclick") || src.includes("advertisement")) {
            img.style.display = "none";
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll("img").forEach(blockImage);
    });

    // Use MutationObserver for dynamic content
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.tagName === "IMG") {
                    blockImage(node);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
// Import the chrome namespace.  This is necessary because the original code was missing this import.
// Without this import, the chrome variable is undeclared, leading to an error.
import chrome from "chrome"

chrome.runtime.onInstalled.addListener(() => {
  console.log("Password Strength Analyzer installed")
})


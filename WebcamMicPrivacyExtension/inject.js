// This script runs in the page context to intercept getUserMedia calls
(function() {
  'use strict';
  
  // Store original functions
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
  
  // Settings from content script
  let settings = {
    webcamBlocked: true,
    micBlocked: true,
    fakeMediaEnabled: false
  };
  
  let isBackground = false;
  let temporaryPermissions = null;
  
  // Fake media generation
  class FakeMediaGenerator {
    static createFakeVideoTrack(constraints) {
      const canvas = document.createElement('canvas');
      canvas.width = constraints.width || 640;
      canvas.height = constraints.height || 480;
      
      const ctx = canvas.getContext('2d');
      
      // Create animated fake video
      const animate = () => {
        // Create gradient background
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, `hsl(${Date.now() / 50 % 360}, 70%, 60%)`);
        gradient.addColorStop(1, `hsl(${(Date.now() / 50 + 180) % 360}, 70%, 40%)`);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Add privacy message
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('PRIVACY PROTECTED', canvas.width / 2, canvas.height / 2 - 20);
        
        ctx.font = '16px Arial';
        ctx.fillText('Fake Camera Feed', canvas.width / 2, canvas.height / 2 + 20);
        
        // Add timestamp
        ctx.font = '12px monospace';
        ctx.fillText(new Date().toLocaleTimeString(), canvas.width / 2, canvas.height - 20);
        
        requestAnimationFrame(animate);
      };
      
      animate();
      
      return canvas.captureStream(30).getVideoTracks()[0];
    }
    
    static createFakeAudioTrack(constraints) {
      // Create audio context for fake audio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();
      
      // Create very quiet pink noise for fake audio
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.001, audioContext.currentTime); // Very quiet
      
      oscillator.connect(gainNode);
      gainNode.connect(destination);
      oscillator.start();
      
      return destination.stream.getAudioTracks()[0];
    }
  }
  
  // Custom getUserMedia implementation
  async function interceptedGetUserMedia(constraints) {
    // Notify about access attempt
    window.postMessage({
      source: 'media-guard-inject',
      action: 'accessAttempt',
      device: constraints.video ? 'video' : 'audio',
      constraints: constraints
    }, '*');
    
    // Get current permissions
    const permissions = await new Promise((resolve) => {
      window.postMessage({
        source: 'media-guard-inject',
        action: 'requestPermissions'
      }, '*');
      
      const handler = (event) => {
        if (event.data.source === 'media-guard-content' && 
            event.data.action === 'permissionsResponse') {
          window.removeEventListener('message', handler);
          resolve(event.data.permissions);
        }
      };
      
      window.addEventListener('message', handler);
      
      // Timeout after 1 second
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ webcamAllowed: false, microphoneAllowed: false });
      }, 1000);
    });
    
    // Check permissions and decide what to do
    let videoAllowed = !constraints.video || permissions.webcamAllowed;
    let audioAllowed = !constraints.audio || permissions.microphoneAllowed;
    
    // Handle temporary permissions
    if (temporaryPermissions && temporaryPermissions.expiry > Date.now()) {
      if (constraints.video && temporaryPermissions.webcam) {
        videoAllowed = true;
      }
      if (constraints.audio && temporaryPermissions.microphone) {
        audioAllowed = true;
      }
    }
    
    // If blocked, throw permission denied error
    if (!videoAllowed || !audioAllowed) {
      const error = new DOMException(
        'Permission denied by Privacy Guard extension',
        'NotAllowedError'
      );
      throw error;
    }
    
    // If fake media is enabled, return fake streams
    if (settings.fakeMediaEnabled) {
      const tracks = [];
      
      if (constraints.video) {
        const fakeVideoTrack = FakeMediaGenerator.createFakeVideoTrack(
          typeof constraints.video === 'object' ? constraints.video : {}
        );
        tracks.push(fakeVideoTrack);
      }
      
      if (constraints.audio) {
        const fakeAudioTrack = FakeMediaGenerator.createFakeAudioTrack(
          typeof constraints.audio === 'object' ? constraints.audio : {}
        );
        tracks.push(fakeAudioTrack);
      }
      
      const fakeStream = new MediaStream(tracks);
      
      // Add metadata to indicate this is a fake stream
      Object.defineProperty(fakeStream, '__privacyGuardFake', {
        value: true,
        writable: false,
        enumerable: false
      });
      
      return fakeStream;
    }
    
    // Otherwise, allow real access
    return originalGetUserMedia(constraints);
  }
  
  // Custom getDisplayMedia implementation
  async function interceptedGetDisplayMedia(constraints) {
    // Always log screen sharing attempts
    window.postMessage({
      source: 'media-guard-inject',
      action: 'accessAttempt',
      device: 'screen',
      constraints: constraints
    }, '*');
    
    // Screen sharing is typically intentional, so we allow it but log it
    if (originalGetDisplayMedia) {
      return originalGetDisplayMedia(constraints);
    } else {
      throw new DOMException('getDisplayMedia not supported', 'NotSupportedError');
    }
  }
  
  // Override the native functions
  navigator.mediaDevices.getUserMedia = interceptedGetUserMedia;
  if (navigator.mediaDevices.getDisplayMedia) {
    navigator.mediaDevices.getDisplayMedia = interceptedGetDisplayMedia;
  }
  
  // Also override legacy getUserMedia methods
  const legacyGetUserMedia = navigator.getUserMedia || 
                           navigator.webkitGetUserMedia || 
                           navigator.mozGetUserMedia;
                           
  if (legacyGetUserMedia) {
    const legacyWrapper = function(constraints, successCallback, errorCallback) {
      interceptedGetUserMedia(constraints)
        .then(successCallback)
        .catch(errorCallback);
    };
    
    navigator.getUserMedia = legacyWrapper;
    navigator.webkitGetUserMedia = legacyWrapper;
    navigator.mozGetUserMedia = legacyWrapper;
  }
  
  // Listen for settings updates from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.source !== 'media-guard-content') return;
    
    if (event.data.action === 'settingsUpdate') {
      settings = event.data.settings;
      isBackground = event.data.isBackground;
      temporaryPermissions = event.data.temporaryPermissions;
    }
  });
  
  // Advanced feature: Monitor WebRTC connections for privacy
  if (window.RTCPeerConnection) {
    const OriginalRTCPeerConnection = window.RTCPeerConnection;
    
    window.RTCPeerConnection = function(configuration, constraints) {
      const pc = new OriginalRTCPeerConnection(configuration, constraints);
      
      // Monitor ICE candidates to detect potential IP leaks
      const originalAddIceCandidate = pc.addIceCandidate.bind(pc);
      pc.addIceCandidate = function(candidate) {
        // Log WebRTC activity
        window.postMessage({
          source: 'media-guard-inject',
          action: 'accessAttempt',
          device: 'webrtc',
          constraints: { candidate: candidate }
        }, '*');
        
        return originalAddIceCandidate(candidate);
      };
      
      return pc;
    };
    
    // Copy static methods and properties
    Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection);
    Object.defineProperty(window.RTCPeerConnection, 'prototype', {
      value: OriginalRTCPeerConnection.prototype,
      writable: false
    });
  }
  
  // Monitor for audio context creation (potential audio fingerprinting)
  if (window.AudioContext) {
    const OriginalAudioContext = window.AudioContext;
    
    window.AudioContext = function() {
      // Log audio context creation
      window.postMessage({
        source: 'media-guard-inject',
        action: 'accessAttempt',
        device: 'audiocontext',
        constraints: {}
      }, '*');
      
      return new OriginalAudioContext();
    };
    
    Object.setPrototypeOf(window.AudioContext, OriginalAudioContext);
  }
  
  // Monitor canvas fingerprinting attempts
  if (HTMLCanvasElement.prototype.toDataURL) {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    
    HTMLCanvasElement.prototype.toDataURL = function() {
      // Check if this might be fingerprinting
      if (this.width * this.height > 10000 || 
          (this.style.display === 'none' || this.style.visibility === 'hidden')) {
        
        window.postMessage({
          source: 'media-guard-inject',
          action: 'accessAttempt',
          device: 'canvas-fingerprint',
          constraints: { dimensions: `${this.width}x${this.height}` }
        }, '*');
      }
      
      return originalToDataURL.apply(this, arguments);
    };
  }
  
  console.log('Privacy Guard: Media protection active');
})();
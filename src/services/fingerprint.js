// Browser fingerprinting for anti-rigging (no external package needed)
// Combines multiple browser signals into a unique-ish hash

export async function generateFingerprint() {
  const components = [];

  // Screen
  components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
  components.push(screen.pixelDepth);

  // Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
  components.push(new Date().getTimezoneOffset());

  // Language
  components.push(navigator.language);
  components.push((navigator.languages || []).join(','));

  // Platform
  components.push(navigator.platform);
  components.push(navigator.hardwareConcurrency || 'unknown');
  components.push(navigator.maxTouchPoints || 0);

  // Canvas fingerprint
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Harmies Arena Design', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Harmies Arena Design', 4, 17);
    components.push(canvas.toDataURL());
  } catch {
    components.push('canvas-unavailable');
  }

  // WebGL renderer
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        components.push(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
        components.push(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      }
    }
  } catch {
    components.push('webgl-unavailable');
  }

  // Audio fingerprint (simplified)
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    components.push(audioCtx.sampleRate);
    audioCtx.close();
  } catch {
    components.push('audio-unavailable');
  }

  // Combine and hash
  const raw = components.join('|||');
  const hash = await sha256(raw);
  return hash;
}

async function sha256(str) {
  const buffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

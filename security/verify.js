// Native security widget only. Account forms and the private verification key
// never enter this page. The API still redeems every proof server-side.
(async () => {
  'use strict';
  const PAGE = 'https://rummit.app/security/verify.html';
  const CONFIG = 'https://loyuycskaazphwztyvwb.supabase.co/functions/v1/rack-api/v1/auth/challenge/config';
  const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const ACTIONS = new Set(['login', 'register', 'password_request', 'password_confirm']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const CONFIG_KEYS = new Set(['version', 'provider', 'enabled', 'requiredFor', 'configurationPath', 'challengePath', 'challengeURL', 'siteKey']);
  const status = document.getElementById('status'), check = document.getElementById('check');
  const unavailable = () => { if (status) status.textContent = 'Couldn’t finish verification. Close this check and try again.'; };
  if (!status || !check) return;
  let action, nonce, bridge;
  try {
    const url = new URL(window.location.href);
    if (window.top !== window || url.origin + url.pathname !== PAGE || url.username || url.password || url.href.includes('#')) throw new Error();
    const keys = [...url.searchParams.keys()];
    action = url.searchParams.get('action'); nonce = url.searchParams.get('nonce');
    if (keys.length !== 2 || keys.filter(key => key === 'action').length !== 1 || keys.filter(key => key === 'nonce').length !== 1
      || !ACTIONS.has(action) || !UUID.test(nonce ?? '')
      || ![`?action=${action}&nonce=${nonce}`, `?nonce=${nonce}&action=${action}`].includes(url.search)) throw new Error();
    bridge = window.webkit?.messageHandlers?.rummitVerification;
    if (typeof bridge?.postMessage !== 'function') throw new Error();
  } catch { unavailable(); return; }

  let active = true, finished = false, rendered = false, widgetID, scriptTimer;
  const controller = new AbortController();
  function finish(kind, value) {
    if (!active || finished) return;
    finished = true; clearTimeout(scriptTimer);
    if (kind === 'token') status.textContent = 'Check complete. Returning to the app…';
    else unavailable();
    try { bridge.postMessage({ kind, value, action, nonce }); } catch { unavailable(); }
  }
  window.addEventListener('pagehide', () => {
    active = false; controller.abort(); clearTimeout(scriptTimer);
    if (rendered && typeof window.turnstile?.remove === 'function') {
      try { window.turnstile.remove(widgetID); } catch { /* No provider details leave this page. */ }
    }
  }, { once: true });

  async function configuration() {
    const response = await fetch(CONFIG, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error',
      referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok || response.redirected || response.url !== CONFIG || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
      void response.body?.cancel().catch(() => {}); throw new Error();
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > 8192)) { void response.body.cancel().catch(() => {}); throw new Error(); }
    const reader = response.body.getReader(), parts = []; let length = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        if (controller.signal.aborted) throw new Error();
        const item = await reader.read(); if (item.done) break;
        length += item.value.byteLength; if (length > 8192) throw new Error(); parts.push(item.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { controller.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
  }

  let config, timeout;
  try {
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error()); }, 8000); });
    config = await Promise.race([configuration(), deadline]);
    if (!active || controller.signal.aborted) return;
    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !CONFIG_KEYS.has(key))
      || config.version !== 1 || config.provider !== 'turnstile' || config.enabled !== true || config.challengeURL !== PAGE
      || config.configurationPath !== undefined && config.configurationPath !== 'auth/challenge/config'
      || config.challengePath !== undefined && config.challengePath !== 'auth/challenge'
      || !Array.isArray(config.requiredFor) || config.requiredFor.length < 1 || config.requiredFor.length > 4
      || config.requiredFor.some(value => !ACTIONS.has(value)) || new Set(config.requiredFor).size !== config.requiredFor.length || !config.requiredFor.includes(action)
      || typeof config.siteKey !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(config.siteKey) || /^[123]x0{10}/.test(config.siteKey)) throw new Error();
  } catch { if (active) finish('error', 'unavailable'); return; }
  finally { clearTimeout(timeout); }

  const script = document.createElement('script');
  script.src = SCRIPT; script.async = true; script.referrerPolicy = 'no-referrer';
  script.addEventListener('load', () => {
    if (!active || finished || rendered) return;
    if (typeof window.turnstile?.render !== 'function') { finish('error', 'unavailable'); return; }
    try {
      rendered = true; clearTimeout(scriptTimer);
      widgetID = window.turnstile.render(check, { sitekey: config.siteKey, action, cData: nonce, theme: 'dark',
        callback(token) {
          if (typeof token !== 'string' || token.length < 20 || token.length > 2048 || !/^[!-~]+$/.test(token) || token.includes(',')) { finish('error', 'unavailable'); return; }
          finish('token', token);
        },
        'error-callback'() { finish('error', 'unavailable'); },
        'expired-callback'() { finish('error', 'expired'); },
        'timeout-callback'() { finish('error', 'timeout'); },
      });
      if (!finished) status.textContent = 'Complete the security check to continue.';
    } catch { finish('error', 'unavailable'); }
  }, { once: true });
  script.addEventListener('error', () => finish('error', 'unavailable'), { once: true });
  scriptTimer = setTimeout(() => finish('error', 'unavailable'), 15000);
  document.head.appendChild(script);
})();

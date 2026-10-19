(() => {
  'use strict';
  const PAGE = 'https://rummit.app/share/';
  const API = 'https://loyuycskaazphwztyvwb.supabase.co/functions/v1/rack-api';
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const nodes = Object.fromEntries(['status','preview','cover','title','description','shopName','handle','kind','retry'].map(id => [id, document.getElementById(id)]));
  let active = true, generation = 0, busy = false, activeLoad = null;
  const clearPreview = () => {
    nodes.preview.hidden = true; nodes.cover.hidden = true; nodes.cover.removeAttribute('src');
    for (const id of ['title','description','shopName','handle','kind']) nodes[id].textContent = '';
  };
  const fail = (invalid = false) => {
    clearPreview();
    nodes.status.textContent = invalid ? 'This shared link isn’t available. Ask the seller for a new link.' : 'We couldn’t load this preview. Try again, or find the shop in Rummit.';
    nodes.retry.hidden = invalid; nodes.retry.disabled = false;
  };
  let kind, id, endpoint;
  try {
    const url = new URL(window.location.href);
    kind = url.searchParams.get('kind'); id = url.searchParams.get('id');
    if (window.top !== window || !['shop','drop'].includes(kind) || !new RegExp('^' + UUID + '$').test(id ?? '')
        || url.href !== PAGE + '?kind=' + kind + '&id=' + id) throw new Error();
    endpoint = API + '/v1/public-share/' + kind + '/' + id;
  } catch { fail(true); return; }
  const keysAre = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const text = (value, maximum, required = true) => typeof value === 'string' && value.length <= maximum
    && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  function validate(value) {
    if (!keysAre(value, ['version','kind','id','title','description','shop','imageUrl']) || value.version !== 1 || value.kind !== kind || value.id !== id
        || !text(value.title, 120) || !text(value.description, 300, false) || !keysAre(value.shop, ['name','handle'])
        || !text(value.shop.name, 80) || typeof value.shop.handle !== 'string' || !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(value.shop.handle)) throw new Error();
    if (value.imageUrl !== null && (typeof value.imageUrl !== 'string'
        || !new RegExp('^' + API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/v1/media/' + UUID + '\\?variant=card$').test(value.imageUrl))) throw new Error();
    return value;
  }
  async function boundedJSON(response, owner) {
    if (!response.ok || response.redirected || response.url !== endpoint || !response.body
        || response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') { await response.body?.cancel().catch(() => {}); throw new Error(); }
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192)) { await response.body.cancel().catch(() => {}); throw new Error(); }
    const currentReader = response.body.getReader(); owner.reader = currentReader; const chunks = []; let total = 0;
    try {
      for (;;) {
        const part = await currentReader.read(); if (part.done) break;
        total += part.value.byteLength; if (total > 8192) throw new Error(); chunks.push(part.value);
      }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    } finally { void currentReader.cancel().catch(() => {}); currentReader.releaseLock(); if (owner.reader === currentReader) owner.reader = null; }
  }
  async function load() {
    if (!active || busy) return;
    busy = true; const ownGeneration = ++generation, ownController = new AbortController();
    const ownLoad = {controller:ownController,reader:null}; activeLoad = ownLoad;
    clearPreview(); nodes.status.textContent = 'Opening the shared find…'; nodes.retry.hidden = true; nodes.retry.disabled = true;
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      ownController.abort(); void ownLoad.reader?.cancel().catch(() => {}); reject(new Error());
    }, 8000); });
    try {
      const value = validate(await Promise.race([fetch(endpoint, {method:'GET', credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer',
        mode:'cors', redirect:'error', headers:{Accept:'application/json'}, signal:ownController.signal}).then(response => {
          if (!active || ownGeneration !== generation || ownController.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error(); }
          return boundedJSON(response, ownLoad);
        }), deadline]));
      if (!active || ownGeneration !== generation || ownController.signal.aborted) return;
      nodes.kind.textContent = kind === 'shop' ? 'SHOP PREVIEW' : 'DROP PREVIEW';
      nodes.title.textContent = value.title; nodes.description.textContent = value.description;
      nodes.shopName.textContent = value.shop.name; nodes.handle.textContent = '@' + value.shop.handle;
      if (value.imageUrl) { nodes.cover.referrerPolicy = 'no-referrer'; nodes.cover.alt = 'A publicly shared find from this shop'; nodes.cover.src = value.imageUrl; nodes.cover.hidden = false; }
      nodes.status.textContent = ''; nodes.preview.hidden = false;
    } catch { if (active && ownGeneration === generation) fail(); }
    finally { clearTimeout(timer); if (ownGeneration === generation) busy = false; }
  }
  nodes.cover.addEventListener('error', () => { nodes.cover.hidden = true; nodes.cover.removeAttribute('src'); });
  nodes.retry.addEventListener('click', () => { void load(); });
  window.addEventListener('pagehide', () => {
    active = false; generation++; activeLoad?.controller.abort(); void activeLoad?.reader?.cancel().catch(() => {}); clearPreview();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { active = true; busy = false; void load(); } });
  return load();
})();

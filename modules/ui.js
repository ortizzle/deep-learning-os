// ui.js — tiny shared DOM helpers so view modules stay DRY.
// (Small addition beyond the spec'd file list; keeps the views readable.)

// Create an element: el('div', { class: 'card', onclick: fn }, [children|strings]).
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else {
      node.setAttribute(k, v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function escapeHtml(s = '') {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render text with **key term** markers as highlighted spans. Escapes HTML
// first, so the only markup that can reach innerHTML is ours.
export function richText(text = '') {
  return escapeHtml(text).replace(
    /\*\*([^*\n]+)\*\*/g,
    '<mark class="kw">$1</mark>'
  );
}

// Element whose content is rich text (highlights rendered).
export function rich(tag, attrs, text) {
  return el(tag, { ...attrs, html: richText(text) });
}

// Turn plain-text paragraphs into <p> elements, rendering key-term highlights.
export function paragraphs(text = '') {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => rich('p', {}, p));
}

// Lightweight non-blocking toast.
export function toast(message, kind = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host' });
    document.body.append(host);
  }
  const t = el('div', { class: `toast toast-${kind}` }, message);
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// Full-view loading state.
export function loading(root, label = 'Working…') {
  clear(root).append(
    el('div', { class: 'loading' }, [el('div', { class: 'spinner' }), el('span', {}, label)])
  );
}

export function navigate(hash) {
  location.hash = hash;
}

// Share text via the native share sheet (Android/Chrome), falling back to
// the clipboard on platforms without navigator.share.
export async function shareText({ title, text }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false; // user closed the sheet
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success');
    return true;
  } catch {
    toast('Could not share on this device', 'error');
    return false;
  }
}

// Small inline share glyph (arrow leaving a box), tinted via currentColor.
export const SHARE_ICON =
  '<svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round"><path d="M12 14V4"/><path d="M8.5 7.5 12 4l3.5 3.5"/><path d="M6 11v8h12v-8"/></svg>';

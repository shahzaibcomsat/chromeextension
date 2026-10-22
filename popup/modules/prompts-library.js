/**
 * ShahzaibSEO — Prompts Library (renders window.ShahzaibSEOPromptsLibrary)
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderList(filter) {
    const list = document.getElementById('plList');
    if (!list) return;
    const all = Array.isArray(window.ShahzaibSEOPromptsLibrary) ? window.ShahzaibSEOPromptsLibrary : [];
    const q = String(filter || '').trim().toLowerCase();
    const items = !q
      ? all
      : all.filter((p) => {
          const hay = [p.title, p.description, (p.tags || []).join(' '), p.text]
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        });

    if (!items.length) {
      list.innerHTML = '<div class="pl-empty">No prompts match your search.</div>';
      return;
    }

    list.innerHTML = items
      .map((p) => {
        const tags = (p.tags || [])
          .map((t) => `<span class="pl-tag">${esc(t)}</span>`)
          .join('');
        return `<div class="pl-card" data-id="${esc(p.id)}">
          <div class="pl-card-head">
            <div class="pl-name">${esc(p.title)}</div>
            <span class="pl-badge">${esc(p.badge || 'Prompt')}</span>
          </div>
          <div class="pl-desc">${esc(p.description || '')}</div>
          <div class="pl-meta">${tags}</div>
          <div class="pl-actions">
            <button type="button" class="pl-btn pl-btn-primary" data-pl-copy>Copy full prompt</button>
            <button type="button" class="pl-btn" data-pl-toggle>Show text</button>
          </div>
          <textarea class="pl-body" readonly spellcheck="false"></textarea>
          <div class="pl-toast">Copied to clipboard.</div>
        </div>`;
      })
      .join('');

    list.querySelectorAll('.pl-card').forEach((card) => {
      const id = card.getAttribute('data-id');
      const prompt = all.find((x) => x.id === id);
      const body = card.querySelector('.pl-body');
      const toast = card.querySelector('.pl-toast');
      const copyBtn = card.querySelector('[data-pl-copy]');
      const toggleBtn = card.querySelector('[data-pl-toggle]');
      if (body && prompt) body.value = prompt.text || '';

      if (toggleBtn && body) {
        toggleBtn.addEventListener('click', () => {
          const open = body.classList.toggle('open');
          toggleBtn.textContent = open ? 'Hide text' : 'Show text';
        });
      }

      if (copyBtn && body) {
        copyBtn.addEventListener('click', async () => {
          const text = body.value || '';
          try {
            await navigator.clipboard.writeText(text);
          } catch (_) {
            body.classList.add('open');
            body.focus();
            body.select();
            try {
              document.execCommand('copy');
            } catch (e) {
              console.warn('[Prompts] copy failed', e);
            }
          }
          if (toast) {
            toast.style.display = 'block';
            setTimeout(() => {
              toast.style.display = 'none';
            }, 1600);
          }
          const prev = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = prev;
          }, 1200);
        });
      }
    });
  }

  function init() {
    if (!document.getElementById('plList')) return;
    renderList('');
    const search = document.getElementById('plSearch');
    if (search) {
      let t = null;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => renderList(search.value), 120);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

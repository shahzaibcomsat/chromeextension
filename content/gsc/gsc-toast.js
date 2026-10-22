/**
 * Minimal toast notification helper. Works in both the popup document and
 * the content-script-injected page context — caller passes the root element
 * to mount into (defaults to document.body).
 */

const Toast = {
  _container: null,

  _ensureContainer(root) {
    const doc = root.ownerDocument || document;
    if (this._container && this._container.isConnected) return this._container;
    const container = doc.createElement('div');
    container.className = 'sc-qt-toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    root.appendChild(container);
    this._container = container;
    return container;
  },

  /**
   * type: 'success' | 'error' | 'info'
   */
  show(message, type = 'info', { root = document.body, duration = 3200 } = {}) {
    const container = this._ensureContainer(root);
    const doc = root.ownerDocument || document;
    const toast = doc.createElement('div');
    toast.className = `sc-qt-toast sc-qt-toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('sc-qt-toast--visible'));

    const remove = () => {
      toast.classList.remove('sc-qt-toast--visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 400);
    };

    const timer = setTimeout(remove, duration);
    toast._scQtDismiss = () => {
      clearTimeout(timer);
      remove();
    };
    toast.addEventListener('click', () => toast._scQtDismiss());

    return toast;
  },

  success(message, opts) {
    return this.show(message, 'success', opts);
  },
  error(message, opts) {
    return this.show(message, 'error', opts);
  },
  info(message, opts) {
    return this.show(message, 'info', opts);
  },

  /** Dismisses a toast early (e.g. once the condition it was waiting on is met), instead of leaving it to its timer. Safe to call on an already-removed toast. */
  dismiss(toast) {
    if (toast && toast.isConnected && typeof toast._scQtDismiss === 'function') {
      toast._scQtDismiss();
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toast;
}

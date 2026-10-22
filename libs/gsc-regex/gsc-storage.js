/**
 * chrome.storage.local wrapper. All reads/writes for extension state go
 * through this module so a future cloud-sync backend can be swapped in
 * behind the same function signatures without touching callers.
 *
 * Schema (namespaced, versioned so migrations are possible later):
 *   scqt:favorites      -> string[]                 (preset ids)
 *   scqt:recent         -> { id, appliedAt }[]       (max 10, newest first)
 *   scqt:customPresets   -> Preset[]
 *   scqt:collections     -> Collection[]
 *   scqt:settings        -> Settings
 *   scqt:brandTerms      -> string[]
 *   scqt:schemaVersion   -> number
 */

const GSC_STORAGE_KEYS = {
  favorites: 'scqt:favorites',
  recent: 'scqt:recent',
  customPresets: 'scqt:customPresets',
  collections: 'scqt:collections',
  settings: 'scqt:settings',
  schemaVersion: 'scqt:schemaVersion',
  brandTerms: 'scqt:brandTerms'
};

const GSC_DEFAULT_SETTINGS = {
  theme: 'light', // 'light' | 'dark' | 'system'
  rememberLastCategory: true,
  lastCategory: 'all',
  animationsEnabled: true,
  blurUrls: false, // privacy blur for screen recordings (Search Console pages)
  blurQueries: false // additionally blur query text in the Performance report
};

const CURRENT_SCHEMA_VERSION = 1;

const GscStorage = {
  async _get(key, fallback) {
    const result = await chrome.storage.local.get(key);
    return key in result ? result[key] : fallback;
  },

  async _set(key, value) {
    await chrome.storage.local.set({ [key]: value });
    return value;
  },

  async init() {
    const version = await this._get(GSC_STORAGE_KEYS.schemaVersion, 0);
    if (version < CURRENT_SCHEMA_VERSION) {
      // Placeholder for future migrations; currently a no-op beyond stamping the version.
      await this._set(GSC_STORAGE_KEYS.schemaVersion, CURRENT_SCHEMA_VERSION);
    }
  },

  // ---- Favorites ----
  async getFavorites() {
    return this._get(GSC_STORAGE_KEYS.favorites, []);
  },
  async isFavorite(presetId) {
    const favs = await this.getFavorites();
    return favs.includes(presetId);
  },
  async toggleFavorite(presetId) {
    const favs = await this.getFavorites();
    const idx = favs.indexOf(presetId);
    if (idx === -1) favs.push(presetId);
    else favs.splice(idx, 1);
    await this._set(GSC_STORAGE_KEYS.favorites, favs);
    return idx === -1; // true if now favorited
  },

  // ---- Recent (last 10 applied presets) ----
  async getRecent() {
    return this._get(GSC_STORAGE_KEYS.recent, []);
  },
  async pushRecent(presetId) {
    const recent = await this.getRecent();
    const filtered = recent.filter((r) => r.id !== presetId);
    filtered.unshift({ id: presetId, appliedAt: Date.now() });
    const trimmed = filtered.slice(0, 10);
    await this._set(GSC_STORAGE_KEYS.recent, trimmed);
    return trimmed;
  },
  async clearRecent() {
    return this._set(GSC_STORAGE_KEYS.recent, []);
  },

  // ---- Custom presets ----
  async getCustomPresets() {
    return this._get(GSC_STORAGE_KEYS.customPresets, []);
  },
  async saveCustomPreset(preset) {
    const presets = await this.getCustomPresets();
    const idx = presets.findIndex((p) => p.id === preset.id);
    if (idx === -1) presets.push(preset);
    else presets[idx] = preset;
    await this._set(GSC_STORAGE_KEYS.customPresets, presets);
    return preset;
  },
  async deleteCustomPreset(presetId) {
    const presets = await this.getCustomPresets();
    const next = presets.filter((p) => p.id !== presetId);
    await this._set(GSC_STORAGE_KEYS.customPresets, next);
    return next;
  },
  async importCustomPresets(presets, { merge = true } = {}) {
    const existing = merge ? await this.getCustomPresets() : [];
    const byId = new Map(existing.map((p) => [p.id, p]));
    for (const p of presets) byId.set(p.id, p);
    const next = Array.from(byId.values());
    await this._set(GSC_STORAGE_KEYS.customPresets, next);
    return next;
  },

  // ---- Collections ----
  async getCollections() {
    return this._get(GSC_STORAGE_KEYS.collections, []);
  },
  async saveCollection(collection) {
    const collections = await this.getCollections();
    const idx = collections.findIndex((c) => c.id === collection.id);
    if (idx === -1) collections.push(collection);
    else collections[idx] = collection;
    await this._set(GSC_STORAGE_KEYS.collections, collections);
    return collection;
  },
  async deleteCollection(collectionId) {
    const collections = await this.getCollections();
    const next = collections.filter((c) => c.id !== collectionId);
    await this._set(GSC_STORAGE_KEYS.collections, next);
    return next;
  },

  // ---- Settings ----
  async getSettings() {
    const stored = await this._get(GSC_STORAGE_KEYS.settings, {});
    return { ...GSC_DEFAULT_SETTINGS, ...stored };
  },
  async saveSettings(partial) {
    const current = await this.getSettings();
    const next = { ...current, ...partial };
    await this._set(GSC_STORAGE_KEYS.settings, next);
    return next;
  },
  async resetSettings() {
    await this._set(GSC_STORAGE_KEYS.settings, GSC_DEFAULT_SETTINGS);
    return GSC_DEFAULT_SETTINGS;
  },

  // ---- Brand terms (used to fill {{brand}} placeholders in preset regex) ----
  async getBrandTerms() {
    return this._get(GSC_STORAGE_KEYS.brandTerms, []);
  },
  async saveBrandTerms(terms) {
    const cleaned = terms.map((t) => t.trim()).filter(Boolean);
    await this._set(GSC_STORAGE_KEYS.brandTerms, cleaned);
    return cleaned;
  },

  // ---- Bulk clear (used by "Clear history" action) ----
  async clearAllHistory() {
    await this._set(GSC_STORAGE_KEYS.recent, []);
    await this._set(GSC_STORAGE_KEYS.favorites, []);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GscStorage, GSC_STORAGE_KEYS, GSC_DEFAULT_SETTINGS };
} else if (typeof window !== 'undefined') {
  window.GscStorage = GscStorage;
}

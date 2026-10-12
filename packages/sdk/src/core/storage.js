/**
 * localStorage / sessionStorage with dotted keys, JSON values and TTL.
 *
 * Every read and write is wrapped: Safari private mode throws on setItem, and
 * a storage failure must never take a component down with it.
 */
export default class Storage {
    constructor(prefix = 'falak') {
        this.prefix = prefix;
        this.session = new Driver(prefix, safeStore(() => window.sessionStorage));
        this.driver = safeStore(() => window.localStorage);
    }

    key(name) {
        return `${this.prefix}::${name}`;
    }

    get(name, fallback = null) {
        const raw = this.driver.getItem(this.key(name));

        if (raw === null) return fallback;

        try {
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    set(name, value) {
        this.driver.setItem(this.key(name), JSON.stringify(value));
        return value;
    }

    remove(name) {
        this.driver.removeItem(this.key(name));
    }

    /**
     * TTL variants — used for things that are correct now and wrong later
     * (fetched product lists, dismissed banners, attribution parameters).
     */
    setWithTTL(name, value, minutes) {
        return this.set(name, { value, expiry: Date.now() + minutes * 60000 });
    }

    getWithTTL(name, fallback = null) {
        const item = this.get(name);

        if (!item || typeof item !== 'object' || !('expiry' in item)) return fallback;

        if (Date.now() > item.expiry) {
            this.remove(name);
            return fallback;
        }

        return item.value;
    }

    /** Drops only this SDK's keys, leaving the theme's own storage alone. */
    clearAll() {
        const doomed = [];

        for (let i = 0; i < this.driver.length; i++) {
            const key = this.driver.key(i);
            if (key && key.startsWith(`${this.prefix}::`)) doomed.push(key);
        }

        doomed.forEach(key => this.driver.removeItem(key));
    }
}

class Driver {
    constructor(prefix, store) {
        this.prefix = prefix;
        this.store = store;
    }

    get(name, fallback = null) {
        const raw = this.store.getItem(`${this.prefix}::${name}`);
        if (raw === null) return fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback; }
    }

    set(name, value) {
        this.store.setItem(`${this.prefix}::${name}`, JSON.stringify(value));
        return value;
    }

    remove(name) {
        this.store.removeItem(`${this.prefix}::${name}`);
    }
}

/**
 * A no-op store when the real one is unavailable. Returning a stub rather than
 * throwing means a shopper in private mode loses persistence, not the page.
 */
function safeStore(resolve) {
    try {
        const store = resolve();
        const probe = '__falak_probe__';
        store.setItem(probe, '1');
        store.removeItem(probe);
        return store;
    } catch (e) {
        return MEMORY_STORE;
    }
}

const MEMORY_STORE = (() => {
    const map = new Map();

    return {
        get length() { return map.size; },
        key: index => Array.from(map.keys())[index] ?? null,
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key),
    };
})();

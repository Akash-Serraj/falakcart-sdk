/**
 * Dotted-path configuration store.
 *
 * Read by every other module, so it is the first thing assembled and the only
 * one with no dependencies of its own. The platform hands it a server-rendered
 * blob at body:end (see ThemeSystemServiceProvider); nothing here ever fetches.
 */
export default class Config {
    constructor() {
        this.data = {};
    }

    /** Deep-merges a blob in. Later calls win, but only for keys they mention. */
    merge(config) {
        this.data = mergeDeep(this.data, config || {});
        return this;
    }

    /** config.get('store.settings.reviews_enabled', false) */
    get(key, fallback = undefined) {
        if (!key) return this.data;

        let node = this.data;

        for (const segment of String(key).split('.')) {
            if (node === null || typeof node !== 'object' || !(segment in node)) {
                return fallback;
            }
            node = node[segment];
        }

        return node === undefined ? fallback : node;
    }

    set(key, value) {
        const segments = String(key).split('.');
        const last = segments.pop();
        let node = this.data;

        for (const segment of segments) {
            if (node[segment] === null || typeof node[segment] !== 'object') {
                node[segment] = {};
            }
            node = node[segment];
        }

        node[last] = value;
        return this;
    }

    all() {
        return this.data;
    }

    isDebug() {
        return !!this.get('debug', false);
    }

    /**
     * Identity helpers. Kept here rather than in an auth module because
     * components branch on them during render, before any auth call happens.
     */
    isUser() {
        return this.get('user.type') === 'customer' || !!this.get('user.id');
    }

    isGuest() {
        return !this.isUser();
    }
}

/** Plain objects merge recursively; arrays and scalars replace wholesale. */
function mergeDeep(target, source) {
    const output = Object.assign({}, target);

    for (const [key, value] of Object.entries(source)) {
        output[key] = isPlainObject(value) && isPlainObject(target[key])
            ? mergeDeep(target[key], value)
            : value;
    }

    return output;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The event bus, and the namespace generator built on top of it.
 *
 * Two rules make this bus worth having over plain DOM events:
 *
 *  1. `emitAsync` AWAITS every listener. That is what turns a `before.*` event
 *     into a real interception point — a listener can mutate the payload, or
 *     take its time doing so, and the caller will not proceed until it is done.
 *
 *  2. Namespaces generate their own API. A domain declares a name map and gets
 *     both an emitter method and a listener method per entry, for free.
 */
export class Emitter {
    constructor(logger) {
        this.logger = logger;
        this.listeners = new Map();
        this.delimiter = '::';
    }

    on(event, handler, options = {}) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);

        this.listeners.get(event).push({ handler, once: !!options.once });

        return () => this.off(event, handler);
    }

    once(event, handler) {
        return this.on(event, handler, { once: true });
    }

    off(event, handler) {
        const bucket = this.listeners.get(event);

        if (!bucket) return false;

        const index = bucket.findIndex(entry => entry.handler === handler);

        if (index === -1) return false;

        bucket.splice(index, 1);
        if (!bucket.length) this.listeners.delete(event);

        return true;
    }

    /** Fire-and-forget. Returns immediately; rejections are logged, not thrown. */
    emit(event, ...args) {
        this.emitAsync(event, ...args).catch(error => this.logger.warn(`event "${event}" failed`, error));
        return this;
    }

    /**
     * Sequential and awaited. Sequential matters: two listeners mutating the
     * same payload must not interleave, and `before.*` semantics depend on
     * each one seeing what the previous one did.
     */
    async emitAsync(event, ...args) {
        const bucket = this.listeners.get(event);

        if (!bucket || !bucket.length) return args[0];

        for (const entry of [...bucket]) {
            try {
                await entry.handler(...args);
            } catch (error) {
                this.logger.warn(`listener for "${event}" threw`, error);
            }

            if (entry.once) this.off(event, entry.handler);
        }

        return args[0];
    }

    /** Alias kept for readability at call sites that only ever listen. */
    listen(event, handler) {
        return this.on(event, handler);
    }

    /** Dispatch by full name, used for server-sent events. */
    dispatch(event, ...args) {
        return this.emitAsync(event, ...args);
    }

    /** `{ 'cart::updated': {...}, 'product::viewed': {...} }` — the server's shape. */
    dispatchEvents(events) {
        Object.entries(events || {}).forEach(([event, payload]) => this.dispatch(event, payload));
    }

    eventNames() {
        return Array.from(this.listeners.keys());
    }
}

/**
 * Base class for a domain's event surface.
 *
 * Subclasses set `namespace` and `events`, then call `register()`. For an entry
 * `itemAdded: 'item.added'` under namespace `cart`, this generates:
 *
 *    falak.event.cart.itemAdded(payload)      -> emits 'cart::item.added'
 *    falak.event.cart.onItemAdded(cb)         -> listens for it
 *
 * and the raw string form keeps working: falak.event.on('cart::item.added', cb).
 * Both are public API — themes use whichever reads better at the call site.
 */
export class Namespace {
    constructor(emitter) {
        this.emitter = emitter;
        this.namespace = '';
        this.events = {};
    }

    register() {
        Object.keys(this.events).forEach(key => {
            this.defineDispatcher(key);
            this.defineListener(key);
        });

        return this;
    }

    /** A hand-written method on the subclass always wins over the generated one. */
    defineDispatcher(key) {
        if (this[key]) return;
        this[key] = (...args) => this.dispatch(key, ...args);
    }

    defineListener(key) {
        const name = 'on' + key.charAt(0).toUpperCase() + key.slice(1);
        if (this[name]) return;
        this[name] = handler => this.on(key, handler);
    }

    /** A name containing '::' is already absolute and is left alone. */
    eventName(key) {
        const name = this.events[key] || key;
        return !this.namespace || name.includes('::') ? name : this.namespace + this.emitter.delimiter + name;
    }

    dispatch(key, ...args) {
        return this.emitter.emitAsync(this.eventName(key), ...args);
    }

    on(key, handler) {
        return this.emitter.on(this.eventName(key), handler);
    }

    once(key, handler) {
        return this.emitter.once(this.eventName(key), handler);
    }
}

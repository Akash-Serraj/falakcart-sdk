/**
 * Debug-gated console.
 *
 * Themes run on merchant storefronts, so chatter is off unless the platform
 * turned debug on for this render (or a developer set it by hand in the
 * console via `falak.config.set('debug', true)`).
 */
export default class Logger {
    constructor(config) {
        this.config = config;
    }

    log(message, ...data) {
        if (this.config.isDebug()) console.log('%cFalak', BADGE, message, ...data);
        return this;
    }

    info(message, ...data) {
        if (this.config.isDebug()) console.info('%cFalak', BADGE, message, ...data);
        return this;
    }

    /** Warnings and errors are never gated: they report real breakage. */
    warn(message, ...data) {
        console.warn('%cFalak', BADGE, message, ...data);
        return this;
    }

    error(message, ...data) {
        console.error('%cFalak', BADGE, message, ...data);
        return this;
    }
}

const BADGE = 'background:#111;color:#fff;padding:2px 5px;border-radius:3px;font-weight:600';

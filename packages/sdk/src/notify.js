/**
 * Notifications, deliberately pluggable.
 *
 * The default is a console line, not an alert(): a storefront must never show
 * a browser dialog, and a theme that has not wired its own toast should stay
 * silent rather than ugly. Themes call `setNotifier()` in app.js to take over.
 *
 *     falak.notify.setNotifier((message, type) => myToast(message, type));
 */
export default class Notify {
    constructor(logger, emitter) {
        this.logger = logger;
        this.emitter = emitter;
        this.types = { success: 'success', error: 'error', info: 'info' };

        this.handler = (message, type) => this.logger.log(`notify:${type}`, message);
    }

    setNotifier(handler) {
        this.handler = handler;
        this.emitter.emit('notify::handler.changed');
        return this;
    }

    fire(message, type = 'info', data = null) {
        if (!message) return;

        this.emitter.emit('notify::fired', { message, type, data });

        return this.handler(message, type, data);
    }

    success(message, data) { return this.fire(message, this.types.success, data); }
    error(message, data) { return this.fire(message, this.types.error, data); }
    info(message, data) { return this.fire(message, this.types.info, data); }
}

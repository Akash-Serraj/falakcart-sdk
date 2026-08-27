import { Namespace } from './core/emitter.js';

/**
 * Domain event surfaces.
 *
 * Each class is little more than a name map — `register()` generates the
 * dispatcher and listener methods. Adding an event to a domain is a one-line
 * change here and nothing else.
 */

class ProductEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'product';
        this.events = {
            fetched: 'fetched',
            fetchFailed: 'fetch.failed',
            detailFetched: 'detail.fetched',
            availabilitySubscribed: 'availability.subscribed',
            quantityChanged: 'quantity.changed',
            viewed: 'viewed',
        };
        this.register();
    }
}

class ReviewEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'review';
        this.events = {
            fetched: 'fetched',
            added: 'added',
            addFailed: 'add.failed',
            ratingSelected: 'rating.selected',
        };
        this.register();
    }
}

class CartEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'cart';
        this.events = {
            fetched: 'fetched',
            added: 'added',
            updated: 'updated',
            failed: 'failed',
            couponApplied: 'coupon.applied',
            couponRemoved: 'coupon.removed',
            couponFailed: 'coupon.failed',
        };
        this.register();
    }
}

class WishlistEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'wishlist';
        this.events = {
            fetched: 'fetched',
            added: 'added',
            removed: 'removed',
            updated: 'updated',
            failed: 'failed',
        };
        this.register();
    }
}

class CheckoutEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'checkout';
        this.events = {
            totalsCalculated: 'totals.calculated',
            orderPlaced: 'order.placed',
            paymentVerified: 'payment.verified',
            failed: 'failed',
        };
        this.register();
    }
}

class QuestionEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'question';
        this.events = {
            fetched: 'fetched',
            asked: 'asked',
            askFailed: 'ask.failed',
            replied: 'replied',
            replyFailed: 'reply.failed',
        };
        this.register();
    }
}

class AuthEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'auth';
        this.events = {
            otpSent: 'otp.sent',
            otpFailed: 'otp.failed',
            loggedIn: 'logged.in',
            loginFailed: 'login.failed',
            registered: 'registered',
            loggedOut: 'logged.out',
            userFetched: 'user.fetched',
            profileUpdated: 'profile.updated',
            tokenInvalid: 'token.invalid',

            // Dispatched by requireLoginThen(); the login modal listens for it.
            loginRequired: 'required',
        };
        this.register();
    }
}

class LocalizationEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'localization';
        this.events = {
            languageChanged: 'language.changed',
            currencyChanged: 'currency.changed',
            currenciesFetched: 'currencies.fetched',
            currenciesFailed: 'currencies.failed',
        };
        this.register();
    }
}

class OfferEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'offer';
        this.events = {
            fetched: 'fetched',
            fetchFailed: 'fetch.failed',
            shown: 'shown',
        };
        this.register();
    }
}

class UiEvents extends Namespace {
    constructor(emitter) {
        super(emitter);
        this.namespace = 'ui';
        this.events = {
            accordionToggled: 'accordion.toggled',
            languageChanged: 'language.changed',
            directionChanged: 'direction.changed',
        };
        this.register();
    }
}

export default function registerEvents(emitter) {
    return {
        product: new ProductEvents(emitter),
        review: new ReviewEvents(emitter),
        question: new QuestionEvents(emitter),
        cart: new CartEvents(emitter),
        wishlist: new WishlistEvents(emitter),
        checkout: new CheckoutEvents(emitter),
        auth: new AuthEvents(emitter),
        localization: new LocalizationEvents(emitter),
        offer: new OfferEvents(emitter),
        ui: new UiEvents(emitter),
    };
}

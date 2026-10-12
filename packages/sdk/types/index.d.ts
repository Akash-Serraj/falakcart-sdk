/**
 * Type definitions for the FalakCart storefront SDK (window.falak).
 *
 * Hand-written against packages/falak-sdk/src. Payloads that come straight from
 * the platform API are typed as `FalakRecord` rather than invented shapes: the
 * server owns them, and a confident wrong type is worse than an honest loose
 * one. When you add a public method to the SDK, add it here too.
 */

/** A JSON object as returned by the platform API. */
export type FalakRecord = Record<string, any>;

export type Id = number | string;

/** Returned by every `on…` subscription; call it to unsubscribe. */
export type Unsubscribe = () => boolean;

export type Listener<T = any> = (payload: T, ...rest: any[]) => unknown;

/* ------------------------------------------------------------------ events */

export interface ProductEventMap {
    fetched: 'fetched';
    fetchFailed: 'fetch.failed';
    detailFetched: 'detail.fetched';
    availabilitySubscribed: 'availability.subscribed';
    quantityChanged: 'quantity.changed';
    viewed: 'viewed';
}

export interface ReviewEventMap {
    fetched: 'fetched';
    added: 'added';
    addFailed: 'add.failed';
    ratingSelected: 'rating.selected';
}

export interface CartEventMap {
    fetched: 'fetched';
    added: 'added';
    updated: 'updated';
    failed: 'failed';
    couponApplied: 'coupon.applied';
    couponRemoved: 'coupon.removed';
    couponFailed: 'coupon.failed';
}

export interface WishlistEventMap {
    fetched: 'fetched';
    added: 'added';
    removed: 'removed';
    updated: 'updated';
    failed: 'failed';
}

export interface CheckoutEventMap {
    totalsCalculated: 'totals.calculated';
    orderPlaced: 'order.placed';
    paymentVerified: 'payment.verified';
    failed: 'failed';
}

export interface BuyNowEventMap {
    totalsCalculated: 'totals.calculated';
    orderPlaced: 'order.placed';
    failed: 'failed';
}

export interface ContactEventMap {
    sent: 'sent';
    sendFailed: 'send.failed';
}

export interface NewsletterEventMap {
    subscribed: 'subscribed';
    subscribeFailed: 'subscribe.failed';
}

export interface QuestionEventMap {
    fetched: 'fetched';
    asked: 'asked';
    askFailed: 'ask.failed';
    replied: 'replied';
    replyFailed: 'reply.failed';
}

export interface AuthEventMap {
    otpSent: 'otp.sent';
    otpFailed: 'otp.failed';
    loggedIn: 'logged.in';
    loginFailed: 'login.failed';
    registered: 'registered';
    loggedOut: 'logged.out';
    userFetched: 'user.fetched';
    profileUpdated: 'profile.updated';
    tokenInvalid: 'token.invalid';
    loginRequired: 'required';
}

export interface LocalizationEventMap {
    languageChanged: 'language.changed';
    currencyChanged: 'currency.changed';
    currenciesFetched: 'currencies.fetched';
    currenciesFailed: 'currencies.failed';
}

export interface OfferEventMap {
    fetched: 'fetched';
    fetchFailed: 'fetch.failed';
    shown: 'shown';
}

export interface UiEventMap {
    accordionToggled: 'accordion.toggled';
    languageChanged: 'language.changed';
    directionChanged: 'direction.changed';
}

type Names<NS extends string, M> = `${NS}::${M[keyof M] & string}`;

/** Every event name the SDK itself emits, in `namespace::name` form. */
export type FalakEventName =
    | Names<'product', ProductEventMap>
    | Names<'review', ReviewEventMap>
    | Names<'question', QuestionEventMap>
    | Names<'cart', CartEventMap>
    | Names<'wishlist', WishlistEventMap>
    | Names<'checkout', CheckoutEventMap>
    | Names<'buy-now', BuyNowEventMap>
    | Names<'auth', AuthEventMap>
    | Names<'contact', ContactEventMap>
    | Names<'newsletter', NewsletterEventMap>
    | Names<'localization', LocalizationEventMap>
    | Names<'offer', OfferEventMap>
    | Names<'ui', UiEventMap>
    | 'falak::initiated'
    | 'falak::components.defined'
    | 'notify::fired'
    | 'notify::handler.changed';

/** Known names autocomplete; any other string (server-sent, app-defined) is still accepted. */
export type EventName = FalakEventName | (string & {});

/**
 * A domain's event surface. For each entry `fooBar` in the map you get
 * `fooBar(payload)` (dispatch, awaited) and `onFooBar(handler)` (listen).
 */
export type EventNamespace<M> = {
    readonly namespace: string;
    readonly events: M;
    dispatch(key: keyof M | (string & {}), ...args: any[]): Promise<any>;
    on(key: keyof M | (string & {}), handler: Listener): Unsubscribe;
    once(key: keyof M | (string & {}), handler: Listener): Unsubscribe;
} & {
    [K in keyof M & string]: (...args: any[]) => Promise<any>;
} & {
    [K in keyof M & string as `on${Capitalize<K>}`]: (handler: Listener) => Unsubscribe;
};

export interface FalakEvents {
    readonly delimiter: '::';

    on(event: EventName, handler: Listener, options?: { once?: boolean }): Unsubscribe;
    once(event: EventName, handler: Listener): Unsubscribe;
    off(event: EventName, handler: Listener): boolean;
    /** Alias of on(). */
    listen(event: EventName, handler: Listener): Unsubscribe;

    /** Fire-and-forget; listener errors are logged, never thrown. */
    emit(event: EventName, ...args: any[]): this;
    /** Awaits every listener in order — the basis of `before.*` interception. Resolves with the (possibly mutated) first argument. */
    emitAsync<T = any>(event: EventName, payload?: T, ...rest: any[]): Promise<T>;
    dispatch<T = any>(event: EventName, payload?: T, ...rest: any[]): Promise<T>;
    /** `{ 'cart::updated': {...} }` — the shape the server sends. */
    dispatchEvents(events: Record<string, unknown> | null | undefined): void;
    eventNames(): string[];

    product: EventNamespace<ProductEventMap>;
    review: EventNamespace<ReviewEventMap>;
    question: EventNamespace<QuestionEventMap>;
    cart: EventNamespace<CartEventMap>;
    wishlist: EventNamespace<WishlistEventMap>;
    checkout: EventNamespace<CheckoutEventMap>;
    buyNow: EventNamespace<BuyNowEventMap>;
    auth: EventNamespace<AuthEventMap>;
    contact: EventNamespace<ContactEventMap>;
    newsletter: EventNamespace<NewsletterEventMap>;
    localization: EventNamespace<LocalizationEventMap>;
    offer: EventNamespace<OfferEventMap>;
    ui: EventNamespace<UiEventMap>;
}

/* -------------------------------------------------------------------- core */

/** The blob handed to falak.init() by the platform. Open-ended on purpose. */
export interface FalakConfig {
    debug?: boolean;
    locale?: string;
    token?: string | null;
    user?: FalakRecord | null;
    store?: FalakRecord;
    currency?: FalakRecord;
    theme?: FalakRecord;
    page?: FalakRecord;
    translations?: Record<string, unknown>;
    [key: string]: any;
}

export interface Config {
    merge(config: Partial<FalakConfig>): this;
    /** Dotted path with fallback: `config.get('store.settings.reviews_enabled', false)`. */
    get<T = any>(key?: string, fallback?: T): T;
    set(key: string, value: unknown): this;
    all(): FalakConfig;
    isDebug(): boolean;
    isUser(): boolean;
    isGuest(): boolean;
}

export interface Logger {
    log(message: unknown, ...data: unknown[]): void;
    info(message: unknown, ...data: unknown[]): void;
    warn(message: unknown, ...data: unknown[]): void;
    error(message: unknown, ...data: unknown[]): void;
}

export interface StorageDriver {
    get<T = any>(name: string, fallback?: T): T;
    set(name: string, value: unknown): void;
    remove(name: string): void;
}

export interface Storage extends StorageDriver {
    readonly prefix: string;
    /** sessionStorage with the same API. */
    readonly session: StorageDriver;
    key(name: string): string;
    setWithTTL(name: string, value: unknown, minutes: number): void;
    getWithTTL<T = any>(name: string, fallback?: T): T;
    /** Removes only this SDK's keys. */
    clearAll(): void;
}

export interface UrlHelpers {
    get(path?: string): string;
    api(path?: string): string;
    asset(path?: string): string;
    product(id: Id, slug?: string | null): string;
    category(id: Id): string;
    search(query?: string): string;
    isPage(slug: string): boolean;
    withParam(key: string, value: string, url?: string): string;
}

export interface MoneyOptions {
    /** `false` prints a base-currency amount as-is (e.g. a figure frozen on an order). */
    convert?: boolean;
    [key: string]: unknown;
}

export interface Helpers {
    readonly url: UrlHelpers;
    money(amount: number | string, currency?: string | null, options?: MoneyOptions): string;
    convert(amount: number | string, to: string, from?: string | null): number;
    roundMoney(value: number): number;
    decimals(): number;
    number(value: number | string): string;
    localeTag(): string;
    debounce<F extends (...args: any[]) => any>(fn: F, wait?: number): (...args: Parameters<F>) => void;
    escape(value: unknown): string;
    parseJson<T = any>(raw: string | null | undefined, fallback?: T): T;
}

export interface Lang {
    readonly locale: string;
    readonly isRtl: boolean;
    readonly loaded: boolean;
    setMessages(messages: Record<string, unknown>): void;
    /** A missing key returns the key itself. `{name}` placeholders are replaced. */
    get(key: string, replacements?: Record<string, string | number>): string;
    onLoaded(callback: () => void): void;
}

export type NotifyType = 'success' | 'error' | 'info';
export type Notifier = (message: string, type: NotifyType, data?: unknown) => unknown;

export interface Notify {
    /** Replace the default (console) notifier with the theme's toast. */
    setNotifier(handler: Notifier): this;
    fire(message: string, type?: NotifyType, data?: unknown): unknown;
    success(message: string, data?: unknown): unknown;
    error(message: string, data?: unknown): unknown;
    info(message: string, data?: unknown): unknown;
}

/* --------------------------------------------------------------------- api */

export interface RequestOptions {
    method?: 'get' | 'post' | 'put' | 'patch' | 'delete' | Uppercase<'get' | 'post' | 'put' | 'patch' | 'delete'>;
    /** Query string; arrays become `key[]`, empty values are dropped. */
    params?: Record<string, unknown>;
    /** JSON-encoded unless it is FormData. */
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** Milliseconds before the request is aborted. */
    timeout?: number;
}

export interface ApiClient {
    readonly isSilenced: boolean;
    /** Same-origin request with locale, currency, store, bearer token and CSRF attached. */
    request<T = any>(path: string, options?: RequestOptions): Promise<T>;
    /** Runs the callback with the notification policy suppressed (ref-counted). */
    withoutNotifier<T>(callback: () => T | Promise<T>): Promise<T>;
}

export interface ProductQuery {
    limit?: number | null;
    page?: number;
    category?: Id | null;
    search?: string | null;
    sort?: string | null;
}

export interface ProductApi {
    fetch(query?: ProductQuery): Promise<FalakRecord[]>;
    filters(options?: { category?: Id | null }): Promise<FalakRecord>;
    show(productId: Id): Promise<FalakRecord>;
    categories(): Promise<FalakRecord[]>;
    notifyWhenAvailable(productId: Id, contact?: { email?: string; phone?: string; variationId?: Id | null }): Promise<FalakRecord>;
}

export interface ReviewApi {
    fetch(productId: Id, options?: { perPage?: number; page?: number }): Promise<FalakRecord>;
    summary(productId: Id): Promise<FalakRecord>;
    /** Store-wide feed (testimonials). */
    all(params?: Record<string, unknown>): Promise<FalakRecord>;
    reviewableItems(orderNumber: string): Promise<FalakRecord>;
    reviewableOrders(): Promise<FalakRecord[]>;
    eligibleOrderFor(productId: Id): Promise<FalakRecord | null>;
    add(productId: Id, review: { rating: number; comment?: string; title?: string | null; orderId?: Id | null }): Promise<FalakRecord>;
}

export interface QuestionApi {
    fetch(productId: Id): Promise<FalakRecord>;
    ask(productId: Id, question: { question: string; anonymous?: boolean }): Promise<FalakRecord>;
    reply(questionId: Id, reply: string): Promise<FalakRecord>;
}

export interface CartState {
    lines: FalakRecord[];
    summary: FalakRecord | null;
}

export interface CartApi {
    readonly lines: FalakRecord[];
    readonly summary: FalakRecord | null;
    readonly discountCode: string | null;
    loaded: boolean;

    fetch(): Promise<CartState>;
    /** Cached lines; the first load is shared by concurrent callers. */
    items(): Promise<FalakRecord[]>;
    refresh(): Promise<CartState>;
    /** Total units, for a header badge. */
    count(): number;
    /** Adds to the existing quantity. */
    add(productId: Id, options?: { quantity?: number; variationId?: Id | null }): Promise<CartState>;
    update(productId: Id, quantity: number, options?: { variationId?: Id | null }): Promise<CartState>;
    remove(productId: Id, options?: { variationId?: Id | null }): Promise<CartState>;
    clear(): Promise<CartState>;
    applyCoupon(code: string): Promise<CartState>;
    removeCoupon(): Promise<CartState>;
}

export interface WishlistApi {
    fetch(): Promise<FalakRecord>;
    ids(): Promise<Id[]>;
    items(): Promise<FalakRecord[]>;
    refresh(): Promise<FalakRecord>;
    has(productId: Id): boolean;
    count(): number;
    list(): number[];
    add(productId: Id): Promise<FalakRecord>;
    remove(productId: Id): Promise<FalakRecord>;
    toggle(productId: Id): Promise<FalakRecord>;
    reload(): Promise<FalakRecord>;
    reset(): void;
}

export interface ShippingCapabilities {
    integrated: boolean;
    requires_national_address: boolean;
    requires_district: boolean;
    checkout_fields: FalakRecord[];
    pickup_profile: string;
    requires_sender_national_address_id: boolean;
    supports_awb_print: boolean;
    supports_shipment_cancellation: boolean;
    supports_return_pickup: boolean;
    [key: string]: unknown;
}

export type FieldOptionsState = 'waiting' | 'loading' | 'failed' | 'ready';

export interface FieldStateInput {
    form?: Record<string, unknown>;
    loading?: boolean;
    failed?: boolean;
    options?: unknown[];
}

export interface CheckoutApi {
    shipmentGateways(): Promise<FalakRecord[]>;
    paymentGateways(): Promise<FalakRecord[]>;
    countries(gatewayCode: string): Promise<FalakRecord[]>;
    /** `extra` — e.g. `{ courier_id }` for a private courier. */
    cities(gatewayCode: string, countryCode: string, extra?: Record<string, unknown>): Promise<FalakRecord[]>;
    districts(gatewayCode: string, cityId: Id, cityName?: string | null): Promise<FalakRecord[]>;

    /** What a shipping method can do — read from the payload, no request. */
    capabilities(method: FalakRecord | null | undefined): ShippingCapabilities;
    checkoutFields(method: FalakRecord | null | undefined): FalakRecord[];
    fieldOptionsState(field: FalakRecord, state?: FieldStateInput): FieldOptionsState;
    validateCheckoutFields(fields: FalakRecord[], state?: FieldStateInput): FalakRecord;

    calculateTotal(payload: FalakRecord): Promise<FalakRecord>;
    placeOrder(payload: FalakRecord): Promise<FalakRecord>;
    paymentStatus(orderNumber: string, query?: Record<string, unknown>): Promise<FalakRecord>;
    retryPayment(orderNumber: string, payload?: FalakRecord): Promise<FalakRecord>;

    order(orderNumber: string): Promise<FalakRecord>;
    orderDetails(orderNumber: string): Promise<FalakRecord>;
    orders(query?: Record<string, unknown>): Promise<FalakRecord>;
    downloadInvoice(orderNumber: string, lang?: string): Promise<unknown>;
    downloads(orderNumber: string): Promise<FalakRecord>;
    downloadFile(orderNumber: string, fileId: Id, filename?: string): Promise<unknown>;
    returnEligibility(orderNumber: string): Promise<FalakRecord>;
    requestReturn(orderNumber: string, payload: FalakRecord): Promise<FalakRecord>;
    returnRequests(query?: Record<string, unknown>): Promise<FalakRecord>;
    reviewOrder(orderNumber: string, payload: FalakRecord): Promise<FalakRecord>;
    confirmDelivery(orderNumber: string): Promise<FalakRecord>;
    cancelOrder(orderId: Id): Promise<FalakRecord>;
    trackShipment(identifier: string): Promise<FalakRecord>;
}

export interface BuyNowApi {
    calculateTotal(payload: FalakRecord): Promise<FalakRecord>;
    checkout(payload: FalakRecord): Promise<FalakRecord>;
}

export interface AuthApi {
    readonly token: string | null;
    readonly user: FalakRecord | null;
    isLoggedIn(): boolean;
    sendOtp(phone: string): Promise<FalakRecord>;
    verifyOtp(phone: string, otp: string): Promise<FalakRecord>;
    logout(): Promise<unknown>;
    profile(): Promise<FalakRecord>;
    updateProfile(data?: FalakRecord): Promise<FalakRecord>;
    fetchUser(): Promise<FalakRecord | null>;
    /** Re-issues the HttpOnly session cookie from the stored token. */
    syncCookie(options?: { reload?: boolean }): Promise<unknown>;
    /** Runs the callback now if signed in, otherwise after the shopper signs in. */
    requireLoginThen<T>(callback: () => T | Promise<T>): Promise<T>;
}

export interface Language {
    code: string;
    name: string;
    native?: string;
    is_rtl?: boolean;
}

export interface Currency {
    code: string;
    name?: string;
    label?: string;
    [key: string]: unknown;
}

export interface ExchangeRate {
    code: string;
    name: string | null;
    symbol: string | null;
    rate: number;
}

export interface LocalizationApi {
    readonly locale: string;
    readonly currency: string;
    readonly baseCurrency: string;
    readonly isMultiCurrency: boolean;
    languages(): Language[];
    languageUrl(code: string): string;
    /** Records the choice and navigates. */
    switchLanguage(code: string): string | null;
    currencies(): Currency[];
    /** Informational only — prices are never converted in the browser. */
    rates(): Promise<ExchangeRate[]>;
    currencyUrl(code: string): string;
    /** Records the choice and navigates; null when the code is not offered. */
    switchCurrency(code: string): string | null;
}

export interface OfferApi {
    fetch(): Promise<FalakRecord[]>;
}

export interface ContactApi {
    send(fields: FalakRecord): Promise<FalakRecord>;
}

export interface NewsletterApi {
    subscribe(email: string): Promise<FalakRecord>;
}

export interface FalakApi {
    client: ApiClient;
    product: ProductApi;
    review: ReviewApi;
    question: QuestionApi;
    cart: CartApi;
    wishlist: WishlistApi;
    checkout: CheckoutApi;
    buyNow: BuyNowApi;
    auth: AuthApi;
    localization: LocalizationApi;
    offer: OfferApi;
    contact: ContactApi;
    newsletter: NewsletterApi;
    request<T = any>(path: string, options?: RequestOptions): Promise<T>;
    withoutNotifier<T>(callback: () => T | Promise<T>): Promise<T>;
}

/** `falak.cart.add()` forwards to the API; `.api` and `.event` reach each half directly. */
export type Domain<A, M> = A & {
    readonly api: A;
    readonly event: EventNamespace<M>;
};

/* -------------------------------------------------------------------- root */

export interface Falak {
    readonly version: string;
    /** Version of the components bundle, when it is loaded. */
    readonly componentsVersion?: string;
    status: 'loading' | 'ready';
    /** Tag names registered by the components bundle, when it is loaded. */
    readonly components?: string[];
    readonly boot?: { storeId: number; locale: string; cartCount: number };

    config: Config;
    logger: Logger;
    log(message: unknown, ...data: unknown[]): void;
    storage: Storage;
    helpers: Helpers;
    event: FalakEvents;
    lang: Lang;
    notify: Notify;
    api: FalakApi;

    url: UrlHelpers;
    money(amount: number | string, currency?: string | null, options?: MoneyOptions): string;
    convert(amount: number | string, to: string, from?: string | null): number;
    number(value: number | string): string;

    product: Domain<ProductApi, ProductEventMap>;
    review: Domain<ReviewApi, ReviewEventMap>;
    question: Domain<QuestionApi, QuestionEventMap>;
    cart: Domain<CartApi, CartEventMap>;
    wishlist: Domain<WishlistApi, WishlistEventMap>;
    checkout: Domain<CheckoutApi, CheckoutEventMap>;
    buyNow: Domain<BuyNowApi, BuyNowEventMap>;
    auth: Domain<AuthApi, AuthEventMap>;
    localization: Domain<LocalizationApi, LocalizationEventMap>;
    offer: Domain<OfferApi, OfferEventMap>;
    contact: Domain<ContactApi, ContactEventMap>;
    newsletter: Domain<NewsletterApi, NewsletterEventMap>;
    ui: Domain<{}, UiEventMap>;

    /** Called once by the platform at body:end. Safe to call again. */
    init(options?: Partial<FalakConfig>): Falak;
    /** Runs after init(), whether called before or after it. */
    onReady<T = FalakConfig>(callback?: (config: FalakConfig) => T): Promise<T>;
    onInitiated(callback: (config: FalakConfig) => unknown): Unsubscribe;
}

/* ------------------------------------------------------- npm entry exports */

export interface LoadOptions {
    /** Milliseconds to wait for the platform script; 0 waits forever. Default 10000. */
    timeout?: number;
}

/** The platform instance, or undefined when it has not loaded (yet). */
export function getFalak(): Falak | undefined;

/** Resolves once window.falak exists. */
export function loaded(options?: LoadOptions): Promise<Falak>;

/** Resolves once window.falak exists AND falak.init() has run. */
export function ready(options?: LoadOptions): Promise<Falak>;

/** Live reference to window.falak; throws if used before the SDK has loaded. */
declare const falak: Falak;
export default falak;

declare global {
    interface Window {
        falak: Falak;
        Falak: Falak;
    }

    interface DocumentEventMap {
        'falak:loaded': CustomEvent<Falak>;
    }
}

/**
 * What a shipping method can do, and which extra fields it needs.
 *
 * The server sends `capabilities` on every shipping method it returns, and this
 * is the one place that reads it. It lives in the SDK rather than inside the
 * checkout component because a theme can build its own checkout against the
 * SDK: without this, every such theme would have to rediscover that LogesTechs
 * needs a district and Fastcoo needs a national address — which is exactly the
 * hardcoded per-carrier knowledge the capabilities payload exists to delete.
 *
 * Nothing here makes a request. It reads a payload the caller already has.
 */

/** Everything off — an unintegrated carrier, or no method chosen yet. */
const NONE = {
    integrated: false,
    requires_national_address: false,
    requires_district: false,
    checkout_fields: [],
    pickup_profile: 'standard',
    requires_sender_national_address_id: false,
    supports_awb_print: false,
    supports_shipment_cancellation: false,
    supports_return_pickup: false,
};

/**
 * What to assume when a payload carries no `capabilities`.
 *
 * A TRANSITIONAL SAFETY NET, not a second source of truth, and the only
 * carrier list left on the client.
 *
 * It exists because the two failure directions are not equal. Checkout
 * responses are cached, so shortly after a deploy a cached payload can predate
 * the field — and if that made `requires_district` read false, the form would
 * stop asking for a district and the carrier would refuse the shipment with
 * "Destination district (village) is required". Falling back to the previous
 * answer keeps that correct for the short window it can happen.
 *
 * Safe to delete once no cached payload can predate the capabilities field.
 */
const LEGACY = {
    aramex: {
        integrated: true,
        supports_awb_print: true,
        supports_shipment_cancellation: true,
    },
    fastcoo: {
        integrated: true,
        requires_national_address: true,
        requires_sender_national_address_id: true,
        supports_awb_print: true,
        supports_shipment_cancellation: true,
        supports_return_pickup: true,
        checkout_fields: [{
            key: 'national_address',
            type: 'text',
            label_key: 'checkout.national_address',
            required: true,
            depends_on: null,
            options_from: null,
            max_length: 32,
            placeholder: 'ABCD1234',
        }],
    },
    ...['logestechs', 'delex', 'shipflow'].reduce((all, code) => {
        all[code] = {
            integrated: true,
            requires_district: true,
            pickup_profile: 'logestechs_platform',
            supports_awb_print: true,
            supports_shipment_cancellation: true,
            checkout_fields: [{
                key: 'district',
                type: 'select',
                label_key: 'checkout.district',
                required: true,
                /*
                 * The district list is per city, so the field is required but
                 * unanswerable until a city is chosen. A renderer that ignores
                 * this draws a required field with no options; a validator that
                 * ignores it demands a district the shopper cannot pick. Both
                 * happened.
                 */
                depends_on: 'city',
                options_from: 'districts',
                max_length: null,
                placeholder: null,
            }],
        };

        return all;
    }, {}),
};

/**
 * A shipping method's capabilities — the server's answer when present,
 * otherwise the legacy fallback for its code.
 *
 * A private courier is never a carrier integration, so it gets NONE: it has no
 * districts, no national address and no AWB to print.
 */
export function capabilitiesOf(method) {
    if (!method || method.shipment_type === 'private_courier') {
        return NONE;
    }

    if (method.capabilities) {
        /* Spread over NONE so a capability added later reads false, not undefined. */
        return { ...NONE, ...method.capabilities };
    }

    const code = String(method.code || '').toLowerCase().trim();

    return { ...NONE, ...(LEGACY[code] || {}) };
}

/**
 * The extra fields this method needs beyond the universal ones (name, phone,
 * country, city, street).
 *
 * Always an array, so a caller can map over it without checking.
 */
export function checkoutFieldsOf(method) {
    const fields = capabilitiesOf(method).checkout_fields;

    return Array.isArray(fields) ? fields : [];
}

/**
 * Whether a declared field can be answered yet, and if not, why.
 *
 * `waiting` is the state a boolean could not express, and the reason this
 * returns a word rather than true/false: a district is required, but until a
 * city is chosen there is nothing to choose from — so the form must show that
 * rather than an empty required dropdown, and the validator must ask for the
 * CITY instead of the district.
 *
 *   waiting  the field it depends on is unanswered
 *   loading  its options are being fetched
 *   failed   its options could not be fetched, or came back empty
 *   ready    options are available
 */
export function fieldOptionsState(field, { form = {}, loading = false, failed = false, options = [] } = {}) {
    if (field?.depends_on && !form[field.depends_on]) {
        return 'waiting';
    }

    if (loading) {
        return 'loading';
    }

    if (failed || !options.length) {
        return 'failed';
    }

    return 'ready';
}

/**
 * The form value a declared field is held under.
 *
 * `national_address` is stored as `nationalAddress`, which is the one place the
 * server's key name and the form's disagree.
 */
export function formKeyFor(key) {
    return key === 'national_address' ? 'nationalAddress' : key;
}

/**
 * Whether the declared fields are satisfied, and what to say if not.
 *
 * Returns `{ missing, blockedBy }`:
 *
 *   missing    label keys to name in "please fill in …"
 *   blockedBy  a reason the shopper cannot proceed at all, or null
 *
 * The rule that matters: this NEVER asks for a field the form cannot draw. Each
 * unanswerable state names the step that is actually missing instead —
 * `waiting` asks for the dependency, `failed` reports that the options could
 * not be loaded, `loading` simply holds.
 *
 * Both halves of the district bug were this logic disagreeing with the
 * renderer. Keeping it beside `fieldOptionsState()`, which the renderer also
 * uses, is what makes them agree.
 */
export function validateCheckoutFields(fields, { form = {}, loading = false, failed = false, options = [] } = {}) {
    const missing = [];

    for (const field of Array.isArray(fields) ? fields : []) {
        if (!field || !field.required) {
            continue;
        }

        if (field.type === 'select' || field.depends_on) {
            const state = fieldOptionsState(field, { form, loading, failed, options });

            if (state === 'waiting') {
                /*
                 * Ask for what it depends on. Demanding the district here is
                 * precisely what produced "Please fill in: District" on a page
                 * with no district field.
                 */
                missing.push(`checkout.${field.depends_on}`);

                continue;
            }

            if (state === 'failed') {
                return { missing: [], blockedBy: 'districts_unavailable' };
            }

            if (state === 'loading') {
                return { missing: [], blockedBy: 'loading' };
            }
        }

        if (!String(form[formKeyFor(field.key)] ?? '').trim()) {
            missing.push(field.label_key);
        }
    }

    return { missing, blockedBy: null };
}

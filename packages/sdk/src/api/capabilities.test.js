import { describe, it, expect } from 'vitest';

import { capabilitiesOf, checkoutFieldsOf, fieldOptionsState, validateCheckoutFields } from './capabilities.js';

/**
 * What a shipping method needs from the shopper.
 *
 * These tests exist because this logic had none, and it cost two rounds of the
 * same bug reaching a real checkout:
 *
 *   1. Validation was `if (districts.length && !district)`, so when the district
 *      list failed to load the order went through with no village id and the
 *      carrier refused it: "Destination district (village) is required."
 *   2. Validation was then keyed on the carrier's requirement — correct — but
 *      the renderer still needed a loaded list, so the shopper got
 *      "Please fill in: District" with no district field on the page.
 *
 * Both were a renderer and a validator reading one intention through separate
 * code. The field schema and `fieldOptionsState()` are what make them agree, so
 * that is what is pinned here.
 */

const served = (code, capabilities) => ({
    code,
    shipment_type: 'shipment_gateway',
    capabilities,
});

describe('capabilitiesOf', () => {
    it('prefers what the server sent', () => {
        const method = served('logestechs', {
            integrated: true,
            requires_district: true,
            checkout_fields: [{ key: 'district', type: 'select', depends_on: 'city' }],
        });

        const caps = capabilitiesOf(method);

        expect(caps.requires_district).toBe(true);
        expect(caps.checkout_fields).toHaveLength(1);
    });

    it('fills in capabilities the server did not mention, rather than leaving them undefined', () => {
        /*
         * A capability added to the backend later must read false on an older
         * payload, not undefined — `if (caps.something)` and
         * `if (caps.something === false)` behave differently, and the second
         * form appears in render branches.
         */
        const caps = capabilitiesOf(served('logestechs', { requires_district: true }));

        expect(caps.supports_awb_print).toBe(false);
        expect(caps.pickup_profile).toBe('standard');
        expect(caps.checkout_fields).toEqual([]);
    });

    it('falls back by gateway code when a cached payload predates capabilities', () => {
        /*
         * Checkout responses are cached, so just after a deploy a payload can
         * arrive without the field. Reading `requires_district` as false then
         * would stop the form asking and the carrier would refuse the shipment
         * — so the fallback has to keep the old answer.
         */
        const caps = capabilitiesOf({ code: 'logestechs', shipment_type: 'shipment_gateway' });

        expect(caps.requires_district).toBe(true);
        expect(caps.checkout_fields[0].key).toBe('district');
    });

    it('includes shipflow in the fallback, which an earlier version did not', () => {
        /*
         * The bug this guards: the first version of this table listed
         * logestechs and delex but not shipflow. Shipflow runs on the same
         * adapter and refuses a shipment without a district just as firmly, so
         * a Shipflow order could not be placed at all and nothing said why.
         */
        for (const code of ['logestechs', 'delex', 'shipflow']) {
            const caps = capabilitiesOf({ code, shipment_type: 'shipment_gateway' });

            expect(caps.requires_district, `${code} must need a district`).toBe(true);
            expect(caps.pickup_profile).toBe('logestechs_platform');
        }
    });

    it('gives a private courier no carrier capabilities', () => {
        // It has no districts, no national address and no AWB to print.
        const caps = capabilitiesOf({ code: 'private_courier', shipment_type: 'private_courier' });

        expect(caps.integrated).toBe(false);
        expect(caps.requires_district).toBe(false);
        expect(caps.checkout_fields).toEqual([]);
    });

    it('ignores a courier payload that happens to carry capabilities', () => {
        /*
         * A courier is never a carrier integration, whatever the payload says —
         * otherwise a stray field would make the form ask a courier customer
         * for a carrier's district.
         */
        const caps = capabilitiesOf({
            code: 'logestechs',
            shipment_type: 'private_courier',
            capabilities: { requires_district: true },
        });

        expect(caps.requires_district).toBe(false);
    });

    it('treats an unknown or missing method as needing nothing', () => {
        for (const method of [null, undefined, {}, { code: 'dhl', shipment_type: 'shipment_gateway' }]) {
            expect(capabilitiesOf(method).requires_district).toBe(false);
            expect(capabilitiesOf(method).checkout_fields).toEqual([]);
        }
    });

    it('matches the gateway code regardless of case or padding', () => {
        // Codes come from the database, where casing is not enforced.
        expect(capabilitiesOf({ code: ' LogesTechs ', shipment_type: 'shipment_gateway' }).requires_district).toBe(true);
    });
});

describe('checkoutFieldsOf', () => {
    it('always returns an array, so callers can map without checking', () => {
        expect(checkoutFieldsOf(null)).toEqual([]);
        expect(checkoutFieldsOf(served('aramex', { integrated: true }))).toEqual([]);
        expect(checkoutFieldsOf(served('x', { checkout_fields: 'not an array' }))).toEqual([]);
    });

    it("returns Fastcoo's national address as a text field with its length", () => {
        const fields = checkoutFieldsOf({ code: 'fastcoo', shipment_type: 'shipment_gateway' });

        expect(fields).toHaveLength(1);
        expect(fields[0].key).toBe('national_address');
        expect(fields[0].type).toBe('text');
        /* A short code, so the input and the column agree on 32. */
        expect(fields[0].max_length).toBe(32);
        expect(fields[0].depends_on).toBeNull();
    });

    it('marks the district as depending on the city', () => {
        /*
         * The part a boolean could not express, and the reason both bugs were
         * possible: the field is required but unanswerable until a city is
         * chosen.
         */
        const [district] = checkoutFieldsOf({ code: 'delex', shipment_type: 'shipment_gateway' });

        expect(district.required).toBe(true);
        expect(district.depends_on).toBe('city');
        expect(district.options_from).toBe('districts');
    });
});

describe('fieldOptionsState', () => {
    const district = { key: 'district', type: 'select', depends_on: 'city', options_from: 'districts' };

    it('waits while the field it depends on is unanswered', () => {
        /*
         * The state that was missing. With no city chosen there is nothing to
         * choose from, so the form must say so — and the validator must ask for
         * the CITY. Before this, the field rendered nothing and the validator
         * demanded a district: "Please fill in: District" with no district
         * field.
         */
        expect(fieldOptionsState(district, { form: {} })).toBe('waiting');
        expect(fieldOptionsState(district, { form: { city: '' } })).toBe('waiting');
    });

    it('reports loading once a city is chosen and the lookup is in flight', () => {
        expect(fieldOptionsState(district, { form: { city: '36189' }, loading: true })).toBe('loading');
    });

    it('reports failed when the lookup failed', () => {
        expect(fieldOptionsState(district, { form: { city: '36189' }, failed: true })).toBe('failed');
    });

    it('treats an empty option list as failed, not as a field with nothing to pick', () => {
        /*
         * The original bug in one line. Districts come from the carrier for an
         * unsynced city, so an empty list means "we could not offer a choice" —
         * and the order cannot go without one. Reading it as "no districts
         * needed" is what let the order through.
         */
        expect(fieldOptionsState(district, { form: { city: '36189' }, options: [] })).toBe('failed');
    });

    it('is ready when options are available', () => {
        expect(fieldOptionsState(district, {
            form: { city: '36189' },
            options: [{ id: '88724', name: 'Aba Al Kibash' }],
        })).toBe('ready');
    });

    it('needs no dependency for a field that has none', () => {
        // Fastcoo's national address is answerable immediately.
        const national = { key: 'national_address', type: 'text', depends_on: null };

        expect(fieldOptionsState(national, { form: {}, options: [{}] })).toBe('ready');
    });

    it('survives being called with nothing', () => {
        // Render paths call this before a method is chosen.
        expect(fieldOptionsState(undefined)).toBe('failed');
        expect(fieldOptionsState(null, {})).toBe('failed');
    });
});

describe('validateCheckoutFields', () => {
    const district = {
        key: 'district',
        type: 'select',
        label_key: 'checkout.district',
        required: true,
        depends_on: 'city',
        options_from: 'districts',
    };

    const national = {
        key: 'national_address',
        type: 'text',
        label_key: 'checkout.national_address',
        required: true,
        depends_on: null,
    };

    const options = [{ id: '88724', name: 'Aba Al Kibash' }];

    it('asks for the CITY, not the district, when no city is chosen', () => {
        /*
         * Regression #2, exactly. The validator demanded the district while the
         * renderer drew nothing, so the shopper saw "Please fill in: District"
         * with no district field anywhere on the page.
         */
        const { missing, blockedBy } = validateCheckoutFields([district], { form: {} });

        expect(missing).toEqual(['checkout.city']);
        expect(blockedBy).toBeNull();
    });

    it('blocks rather than naming a field when the options could not load', () => {
        /*
         * Regression #1. The order used to go through here — the old check was
         * `if (districts.length && !district)`, which is false when the list is
         * empty — and the carrier then refused the shipment. There is nothing
         * the shopper can type, so this is a message, not a missing field.
         */
        const { missing, blockedBy } = validateCheckoutFields([district], {
            form: { city: '36189' },
            failed: true,
        });

        expect(blockedBy).toBe('districts_unavailable');
        expect(missing).toEqual([]);
    });

    it('treats an empty option list as unavailable, never as satisfied', () => {
        const { blockedBy } = validateCheckoutFields([district], {
            form: { city: '36189' },
            options: [],
        });

        expect(blockedBy).toBe('districts_unavailable');
    });

    it('holds while the options are still loading', () => {
        const { blockedBy } = validateCheckoutFields([district], {
            form: { city: '36189' },
            loading: true,
        });

        expect(blockedBy).toBe('loading');
    });

    it('asks for the district once there is a list and nothing chosen', () => {
        const { missing, blockedBy } = validateCheckoutFields([district], {
            form: { city: '36189' },
            options,
        });

        expect(missing).toEqual(['checkout.district']);
        expect(blockedBy).toBeNull();
    });

    it('passes when the district is chosen', () => {
        const { missing, blockedBy } = validateCheckoutFields([district], {
            form: { city: '36189', district: '88724' },
            options,
        });

        expect(missing).toEqual([]);
        expect(blockedBy).toBeNull();
    });

    it('reads a national address under its form key, not its server key', () => {
        /*
         * The one place the two names differ: the field is declared as
         * `national_address` and held on the form as `nationalAddress`. Reading
         * the wrong one makes a filled field look empty.
         */
        expect(validateCheckoutFields([national], { form: { nationalAddress: 'RRRD2929' } }).missing).toEqual([]);
        expect(validateCheckoutFields([national], { form: { national_address: 'RRRD2929' } }).missing)
            .toEqual(['checkout.national_address']);
    });

    it('treats whitespace as empty', () => {
        expect(validateCheckoutFields([national], { form: { nationalAddress: '   ' } }).missing)
            .toEqual(['checkout.national_address']);
    });

    it('ignores fields that are not required', () => {
        const optional = { ...national, required: false };

        expect(validateCheckoutFields([optional], { form: {} }).missing).toEqual([]);
    });

    it('is satisfied by an empty field list', () => {
        // Aramex, and every unintegrated carrier.
        for (const fields of [[], null, undefined, 'nonsense']) {
            expect(validateCheckoutFields(fields, { form: {} })).toEqual({ missing: [], blockedBy: null });
        }
    });

    it('does not ask a text field to wait on options it has no source for', () => {
        /*
         * A text field has no option list, so the empty `options` array must not
         * make it look unavailable — that would block Fastcoo checkout outright.
         */
        const { missing, blockedBy } = validateCheckoutFields([national], { form: {}, options: [] });

        expect(blockedBy).toBeNull();
        expect(missing).toEqual(['checkout.national_address']);
    });

    it('agrees with the renderer for every state of the same field', () => {
        /*
         * The guarantee the schema exists for: whenever the renderer would draw
         * no usable input, the validator must not name that field as missing.
         */
        const states = [
            { form: {} },
            { form: { city: '36189' }, loading: true },
            { form: { city: '36189' }, failed: true },
            { form: { city: '36189' }, options: [] },
            { form: { city: '36189' }, options },
        ];

        for (const state of states) {
            const rendered = fieldOptionsState(district, state);
            const { missing } = validateCheckoutFields([district], state);

            if (rendered !== 'ready') {
                expect(missing, `state ${rendered} must not demand the district`)
                    .not.toContain('checkout.district');
            }
        }
    });
});

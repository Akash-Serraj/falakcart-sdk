import FalakElement from '../base.js';

/**
 * <falak-countdown date="2026-09-30 23:59:59">                     the clock alone
 * <falak-countdown date="2026-09-30" end-of-day labeled boxed>    tiles with unit names
 * <falak-countdown date="…" size="lg" horizontal prefix-text="Offer ends in">
 * <falak-countdown date="…" theme="dark" title="Ramadan offer" description="Up to 40% off"
 *                  image="/banners/ramadan.jpg" button-text="Shop now" button-href="/offers">
 *                                                                  a whole offer band
 * <falak-countdown pre-order='{"end_date":"…","availability_date":"…","activate_countdown":true}'>
 *
 * The offer timer. On its own it is the <salla-count-down> role — the same
 * attributes, so a block ported from a Salla theme needs only the tag renamed.
 * Given a `title`, `description`, `image` or `theme` it also renders the band
 * around itself (headline, copy, background, call to action), so a theme block
 * is one tag with attributes rather than markup it has to own.
 *
 * | Attribute       | Description                                                              |
 * | date            | target moment: ISO, "YYYY-MM-DD[ HH:mm:ss]", "MM-DD-YYYY", or a unix timestamp |
 * | timezone        | offset applied to a date with none of its own (default +03:00, KSA)         |
 * | end-of-day      | a date-only value counts to 23:59:59 (also assumed when no time is given)   |
 * | labeled         | print the unit under each value                                            |
 * | boxed           | each unit in its own tile                                                  |
 * | horizontal      | prefix, units and button on one row                                        |
 * | size            | sm | md | lg                                                               |
 * | color           | dark | light | primary — the digits' colour; a `theme` picks it by itself |
 * | digits          | auto | en — force Latin digits regardless of the store's numeral setting    |
 * | auto-segments   | hide days when 0, and hours when days and hours are both 0                 |
 * | prefix-text     | short text right before the units                                          |
 * | end-text        | replaces the default "offer ended" message                                 |
 * | hide-on-end     | remove the element entirely once the moment passes                         |
 * | title           | band headline                                                              |
 * | description     | band copy under the headline                                               |
 * | image           | band background image                                                      |
 * | theme           | dark | light | primary — the band's colours (implies a band)               |
 * | button-text, button-href, button-icon | a call to action after the units                     |
 * | with-button     | accepted for <salla-count-down> parity; the button shows whenever button-text is set |
 * | pre-order       | JSON {end_date, availability_date, activate_countdown} — product pre-order mode |
 *
 * Events: `ended` (DOM, bubbles) and `countdown::ended` (bus) fire once when
 * the target passes. Method: endCountDown().
 *
 * The clock ticks by writing into the value nodes rather than re-rendering:
 * a render a second would tear down anything a theme attached to the block.
 * Every attribute IS reactive, though — the customizer edits a band live by
 * writing `title`, `date` or `image` onto the element (data-falak-bind="attr:…").
 */
export default class FalakCountdown extends FalakElement {
    static observedAttributes = [
        'date', 'timezone', 'end-of-day', 'labeled', 'boxed', 'horizontal', 'size', 'color', 'digits',
        'auto-segments', 'prefix-text', 'end-text', 'hide-on-end',
        'title', 'description', 'image', 'theme',
        'with-button', 'button-text', 'button-href', 'button-icon', 'pre-order',
    ];

    static UNITS = ['days', 'hours', 'minutes', 'seconds'];

    /* Shown when the theme ships no string for a key — the component must
       still read as a clock, not as a list of translation keys. */
    static FALLBACKS = {
        'countdown.days': { ar: 'يوم', en: 'Days' },
        'countdown.hours': { ar: 'ساعة', en: 'Hours' },
        'countdown.minutes': { ar: 'دقيقة', en: 'Minutes' },
        'countdown.seconds': { ar: 'ثانية', en: 'Seconds' },
        'countdown.ended': { ar: 'انتهت مدة العرض', en: 'This offer has ended' },
        'countdown.invalid_date': { ar: 'الرجاء إدخال الموعد بشكل صحيح', en: 'Please enter a valid date' },
        'countdown.pre_order_ends_in': { ar: 'ينتهي الطلب المسبق خلال:', en: 'Pre-order ends in:' },
        'countdown.expected_on': { ar: 'متوقَّع توفُّره بتاريخ:', en: 'Expected to be available on:' },
    };

    get preOrder() { return this.hasAttribute('pre-order') ? this.jsonAttr('pre-order', null) : null; }
    get date() { return this.preOrder?.end_date || this.attr('date'); }
    get timezone() { return this.attr('timezone', '+03:00'); }
    get size() { return this.attr('size', 'md'); }
    get theme() { return this.attr('theme'); }
    get labeled() { return this.boolAttr('labeled'); }
    get boxed() { return this.boolAttr('boxed'); }
    get horizontal() { return this.boolAttr('horizontal'); }
    get autoSegments() { return this.boolAttr('auto-segments'); }
    get ended() { return this._ended === true; }

    /** A band is anything beyond the bare clock. */
    get hasBand() {
        return !!(this.theme || this.attr('title') || this.attr('description') || this.attr('image'));
    }

    /** Digits follow the band: light text on a dark band, dark on a light one. */
    get color() {
        if (this.hasAttribute('color')) return this.attr('color');
        if (this.theme === 'dark' || this.theme === 'primary') return 'light';
        return 'dark';
    }

    /* ------------------------------------------------------------ lifecycle */

    setup() {
        this._ended = false;
        this._invalid = false;
        this._target = this.parseTarget(this.date);

        if (this.date && this._target === null) this._invalid = true;
    }

    onAttributeChange(name) {
        if (['date', 'timezone', 'end-of-day', 'pre-order'].includes(name)) {
            this.stop();
            this.setup();
        }
    }

    disconnectedCallback() {
        this.stop();
        super.disconnectedCallback();
    }

    /* -------------------------------------------------------------- parsing */

    /**
     * Accepts what merchants actually type: ISO, "YYYY-MM-DD HH:mm[:ss]" (the
     * backend's shape), US "MM-DD-YYYY[,hh:mm:ss am]", a unix timestamp. A
     * value with no zone of its own is read in `timezone` — the store's clock,
     * not the shopper's — so the same offer ends at the same moment for
     * everyone. Returns epoch ms, or null when unreadable.
     */
    parseTarget(raw) {
        if (raw === null || raw === undefined || raw === '') return null;

        const text = String(raw).trim();

        // Unix timestamp (seconds or ms).
        if (/^\d{9,13}$/.test(text)) {
            const n = Number(text);
            return n < 1e11 ? n * 1000 : n;
        }

        let value = text;
        let timePart = null;

        // "MM-DD-YYYY,hh:mm:ss am/pm"
        let m = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[, T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
        if (m) {
            const [, month, day, year, h, min, sec, period] = m;
            value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            if (h !== undefined) {
                let hour = Number(h);
                if (period && period.toLowerCase() === 'pm' && hour < 12) hour += 12;
                if (period && period.toLowerCase() === 'am' && hour === 12) hour = 0;
                timePart = `${String(hour).padStart(2, '0')}:${min}:${sec || '00'}`;
            }
        } else {
            // "YYYY-M-D[ H:mm[:ss]][zone]"
            m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
            if (m) {
                const [, year, month, day, h, min, sec, zone] = m;
                value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                if (h !== undefined) timePart = `${h.padStart(2, '0')}:${min}:${sec || '00'}`;
                if (zone) {
                    const stamp = Date.parse(`${value}T${timePart || '00:00:00'}${zone === 'Z' || zone.includes(':') ? zone : zone.replace(/(\d{2})(\d{2})$/, '$1:$2')}`);
                    return Number.isNaN(stamp) ? null : stamp;
                }
            } else {
                // Anything else: let the engine try ("Sep 30, 2026 18:00:00").
                const stamp = Date.parse(value);
                return Number.isNaN(stamp) ? null : stamp;
            }
        }

        if (!timePart || this.boolAttr('end-of-day')) timePart = '23:59:59';

        const stamp = Date.parse(`${value}T${timePart}${this.normalizeZone(this.timezone)}`);

        return Number.isNaN(stamp) ? null : stamp;
    }

    normalizeZone(zone) {
        const text = String(zone || '+03:00').trim();
        if (/^z$/i.test(text)) return 'Z';
        const m = text.match(/^([+-])(\d{1,2}):?(\d{2})?$/);
        return m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : '+03:00';
    }

    /* --------------------------------------------------------------- output */

    /** A theme string, or the built-in fallback when the theme has none. */
    label(key) {
        const value = this.trans(key);
        if (value !== key) return value;

        const fallback = FalakCountdown.FALLBACKS[key];
        return fallback ? (fallback[this.sdk.lang.locale] || fallback.en) : key;
    }

    /** Two-digit, in the store's numerals unless `digits="en"`. */
    digit(value) {
        const n = Math.max(0, Math.floor(value));
        if (this.attr('digits') === 'en') return String(n).padStart(2, '0');

        const tag = typeof this.sdk.helpers?.localeTag === 'function' ? this.sdk.helpers.localeTag() : this.sdk.lang.locale;

        try {
            return new Intl.NumberFormat(tag, { minimumIntegerDigits: 2, useGrouping: false }).format(n);
        } catch (e) {
            return String(n).padStart(2, '0');
        }
    }

    remaining() {
        const distance = Math.max(0, (this._target ?? 0) - Date.now());

        return {
            days: Math.floor(distance / 86400000),
            hours: Math.floor((distance % 86400000) / 3600000),
            minutes: Math.floor((distance % 3600000) / 60000),
            seconds: Math.floor((distance % 60000) / 1000),
            distance,
        };
    }

    render() {
        const band = this.hasBand;

        this.classList.add('f-countdown');
        this.classList.toggle('f-countdown--band', band);
        this.classList.toggle('f-countdown--image', band && !!this.attr('image'));
        this.classList.toggle('f-countdown--horizontal', this.horizontal);
        this.classList.toggle('f-countdown--boxed', this.boxed);
        this.classList.toggle('f-countdown--labeled', this.labeled);
        this.classList.toggle('f-countdown--with-button', !!this.attr('button-text'));
        this.classList.toggle('f-countdown--pre-order', !!this.preOrder);
        this.setAttribute('data-size', this.size);
        this.setAttribute('data-color', this.color);

        if (band) this.setAttribute('data-theme', this.theme || 'dark');
        else this.removeAttribute('data-theme');

        // The background is the element's own style so the customizer's
        // "background" binding and this render write the same thing.
        this.style.backgroundImage = band && this.attr('image') ? `url("${String(this.attr('image')).replace(/"/g, '%22')}")` : '';

        const clock = this.clockHtml();

        this.innerHTML = band
            ? `<div class="f-countdown__content">
                    ${this.attr('title') ? `<h2 class="f-countdown__title">${this.escape(this.attr('title'))}</h2>` : ''}
                    ${this.attr('description') ? `<p class="f-countdown__description">${this.escape(this.attr('description'))}</p>` : ''}
                    ${clock}
                </div>`
            : clock;

        this.setState('ended', this.ended);
    }

    /** Prefix, units, end message, button — the <salla-count-down> part. */
    clockHtml() {
        if (!this.date) return '';

        if (this._invalid) {
            return `<p class="f-countdown__invalid">${this.escape(this.label('countdown.invalid_date'))}</p>`;
        }

        const preOrder = this.preOrder;
        const prefix = this.attr('prefix-text');

        return `
            ${prefix ? `<span class="f-countdown__prefix">${this.escape(prefix)}</span>` : ''}
            ${preOrder ? this.preOrderHtml(preOrder) : this.unitsHtml()}
            <p class="f-countdown__ended" ${this.ended ? '' : 'hidden'}>${this.escape(this.attr('end-text') || this.label('countdown.ended'))}</p>
            ${this.buttonHtml()}`;
    }

    unitsHtml() {
        const now = this.remaining();

        return `
            <ul class="f-countdown__list" role="timer" aria-live="off">
                ${FalakCountdown.UNITS.map(unit => `
                    <li class="f-countdown__item" data-unit="${unit}" ${this.hiddenUnit(unit, now) ? 'hidden' : ''}>
                        <span class="f-countdown__value">${this.digit(now[unit])}</span>
                        ${this.labeled ? `<span class="f-countdown__label">${this.escape(this.label(`countdown.${unit}`))}</span>` : ''}
                    </li>`).join('')}
            </ul>`;
    }

    hiddenUnit(unit, now) {
        if (!this.autoSegments) return false;
        if (unit === 'days') return now.days === 0;
        if (unit === 'hours') return now.days === 0 && now.hours === 0;
        return false;
    }

    preOrderHtml(preOrder) {
        const parts = [];

        if (preOrder.availability_date) {
            const stamp = this.parseTarget(preOrder.availability_date);
            if (stamp !== null) {
                let text = '';
                try {
                    text = new Date(stamp).toLocaleDateString(this.sdk.lang.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                } catch (e) {
                    text = String(preOrder.availability_date);
                }
                parts.push(`
                    <p class="f-countdown__info">
                        <span>${this.escape(this.label('countdown.expected_on'))}</span>
                        <b>${this.escape(text)}</b>
                    </p>`);
            }
        }

        if (preOrder.activate_countdown) {
            parts.push(`
                <div class="f-countdown__pre-order">
                    <p class="f-countdown__hint">${this.escape(this.label('countdown.pre_order_ends_in'))}</p>
                    ${this.unitsHtml()}
                </div>`);
        }

        return parts.join('');
    }

    buttonHtml() {
        const text = this.attr('button-text');
        if (!text) return '';

        const icon = this.attr('button-icon');
        // On a store-coloured band a filled primary button would vanish into it.
        const fill = this.theme === 'primary' ? 'f-btn--outline btn--outline' : 'f-btn--primary btn--primary';

        return `
            <a class="f-countdown__button f-btn ${fill} btn" href="${this.escape(this.attr('button-href', '#'))}">
                ${icon ? `<i class="${this.escape(icon)}" aria-hidden="true"></i>` : ''}
                <span>${this.escape(text)}</span>
            </a>`;
    }

    /* ---------------------------------------------------------------- clock */

    afterRender() {
        this.stop();

        if (!this.date || this._invalid || this.ended || this._target === null) return;
        if (this.preOrder && !this.preOrder.activate_countdown) return;

        this.tick();
        this._interval = setInterval(() => this.tick(), 1000);
    }

    tick() {
        const now = this.remaining();

        FalakCountdown.UNITS.forEach(unit => {
            const item = this.querySelector(`[data-unit="${unit}"]`);
            if (!item) return;

            const value = item.querySelector('.f-countdown__value');
            const text = this.digit(now[unit]);
            if (value && value.textContent !== text) value.textContent = text;

            item.hidden = this.hiddenUnit(unit, now);
        });

        if (now.distance <= 0) this.endCountDown();
    }

    stop() {
        if (this._interval) clearInterval(this._interval);
        this._interval = null;
    }

    /** Stops the clock and shows the end state; fires `ended` once. */
    endCountDown() {
        this.stop();
        if (this.ended) return;

        this._ended = true;
        this.setState('ended', true);

        const message = this.querySelector('.f-countdown__ended');
        if (message) message.hidden = false;

        if (this.boolAttr('hide-on-end')) this.setAttribute('hidden', '');

        this.emit('ended', { date: this.date });
        this.emitBus('countdown::ended', { element: this, date: this.date });
    }
}

/** <falak-count-down> — the Salla spelling, kept so ported markup works unchanged. */
export class FalakCountDown extends FalakCountdown {}

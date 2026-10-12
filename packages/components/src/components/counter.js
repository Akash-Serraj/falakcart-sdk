import FalakElement from '../base.js';

/**
 * <falak-counter value="1000" suffix="+"></falak-counter>
 * <falak-counter value="5500" prefix="~" duration="1600"></falak-counter>
 *
 * A statistic that counts up the first time it is scrolled into view.
 *
 * The final value is written into the DOM on render and the animation counts
 * up TO it, restoring the exact characters at the end. So the real figure is
 * what a visitor sees with JavaScript off, what a crawler reads, and what a
 * screen reader announces — an animation that starts at zero and never
 * finishes would otherwise leave a "0" on the page.
 *
 * Only a plain run of digits animates. "10K", "١٠٠٠" and "1,000" are all
 * legitimate things for a merchant to type and there is no sensible tween
 * between two strings, so those stand exactly as given.
 *
 * | attribute | role                                                |
 * | value     | the figure (required — nothing renders without one) |
 * | suffix    | trails the number, e.g. "+"                         |
 * | prefix    | leads it, e.g. "~"                                  |
 * | duration  | count-up in ms (default 1100)                       |
 * | static    | render the figure without ever animating            |
 */
export default class FalakCounter extends FalakElement {
    static observedAttributes = ['value', 'suffix', 'prefix', 'duration', 'static'];

    get value() { return String(this.attr('value', '')).trim(); }
    get suffix() { return this.attr('suffix', ''); }
    get prefix() { return this.attr('prefix', ''); }
    get duration() { return Math.max(this.numAttr('duration', 1100), 0); }

    render() {
        this.classList.add('f-counter');

        if (!this.value) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.innerHTML = `
            ${this.prefix ? `<span class="f-counter__affix">${this.escape(this.prefix)}</span>` : ''}
            <span class="f-counter__value">${this.escape(this.value)}</span>
            ${this.suffix ? `<span class="f-counter__affix">${this.escape(this.suffix)}</span>` : ''}`;

        /* A re-render replaces the node the last observer was watching, and an
           edited value should be able to count up again. */
        this._counted = false;
        this.observe();
    }

    afterRender() {
        this.observe();
    }

    disconnectedCallback() {
        this._observer?.disconnect();
        this._observer = null;
        super.disconnectedCallback();
    }

    /**
     * Nothing here is load-bearing: without IntersectionObserver, with reduced
     * motion asked for, or with `static` set, the figure simply stands as
     * rendered.
     */
    observe() {
        if (this._counted || this.boolAttr('static')) return;
        if (typeof IntersectionObserver === 'undefined') return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

        const cell = this.querySelector('.f-counter__value');
        if (!cell) return;

        this._observer?.disconnect();
        this._observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;

                /* Once each. A figure that re-counts every time it scrolls
                   back past reads as a glitch rather than as an effect. */
                this._observer.disconnect();
                this.count(cell);
            });
        }, { threshold: 0.4 });

        this._observer.observe(cell);
    }

    count(cell) {
        const final = cell.textContent.trim();
        if (!/^\d+$/.test(final)) return;

        const target = Number(final);
        if (!target) return;

        this._counted = true;

        const duration = this.duration;
        if (!duration) return;

        let started = null;

        const step = now => {
            if (started === null) started = now;

            const progress = Math.min((now - started) / duration, 1);
            /* easeOutCubic — quick off the mark and settling onto the number,
               rather than crawling the last part of the way. */
            const eased = 1 - Math.pow(1 - progress, 3);

            cell.textContent = String(Math.round(target * eased));

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                cell.textContent = final;
                this.emit('counted', { value: final });
            }
        };

        requestAnimationFrame(step);
    }
}

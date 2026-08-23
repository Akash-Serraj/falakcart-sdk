import FalakElement from '../base.js';

/**
 * <falak-slider block-title="New arrivals" slides-per-view="4" show-controls pagination>
 *   <div slot="items">…one child per slide…</div>
 * </falak-slider>
 *
 * Salla's equivalent bundles Swiper, which is most of why their component file
 * is ten thousand lines. This uses native CSS scroll-snap instead: the browser
 * already does momentum, snapping, touch and RTL correctly, and the whole
 * component is the controls, the dots and the bookkeeping around them.
 *
 * The attribute vocabulary follows <salla-slider> so markup ports across —
 * block-title, block-subtitle, display-all-url, slides-per-view, show-controls,
 * controls-outer, pagination, auto-play, loop, static-when-single.
 *
 * RTL needs no special handling in the CSS, but it does here: in a right-to-left
 * container scrollLeft runs negative in most engines, so every position read and
 * write goes through the sign-normalising helpers at the bottom.
 */
export default class FalakSlider extends FalakElement {
    static observedAttributes = ['block-title', 'block-subtitle', 'slides-per-view', 'show-controls', 'pagination'];

    get slidesPerView() { return this.attr('slides-per-view', '4'); }
    get showControls() { return this.boolAttr('show-controls'); }
    get controlsOuter() { return this.boolAttr('controls-outer'); }
    get hasPagination() { return this.boolAttr('pagination'); }
    get loop() { return this.boolAttr('loop'); }
    get autoPlay() { return this.boolAttr('auto-play'); }
    get autoPlayDelay() { return this.numAttr('auto-play-delay', 5000); }
    get staticWhenSingle() { return this.boolAttr('static-when-single'); }
    get isRtl() { return getComputedStyle(this).direction === 'rtl'; }

    /* ------------------------------------------------------ imperative API */

    slideTo(index) {
        const slide = this._slides?.[this.clampIndex(index)];
        if (!slide) return this;

        /*
         * scrollIntoView, not scrollTo(left): in RTL scrollLeft runs NEGATIVE
         * and offsetLeft measures from the wrong edge, so hand-computed
         * positions clamp to 0 and the arrows appear dead in Arabic — the
         * store's primary language. `inline: 'start'` is direction-aware and
         * `block: 'nearest'` keeps the page from scrolling vertically.
         */
        slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        return this;
    }

    slideNext() { return this.slideTo(this.currentIndex + 1); }
    slidePrev() { return this.slideTo(this.currentIndex - 1); }

    get currentIndex() { return this._index || 0; }
    get slideCount() { return this._slides?.length || 0; }

    /* -------------------------------------------------------------- setup */

    setup() {
        /*
         * The author's children are the slides — captured as LIVE ELEMENTS,
         * never as an HTML string. Serializing through innerHTML kept
         * attributes but silently dropped JS properties, and the products
         * slider hands each card its data exactly that way (`card._product`) —
         * so every card re-parsed empty and the carousel showed a title over
         * nothing. Moving the original nodes preserves identity, properties
         * and upgraded state.
         */
        const host = this.querySelector('[slot="items"]') || this;
        this._itemsEls = Array.from(host.children);
    }

    render() {
        const title = this.attr('block-title', '');
        const subtitle = this.attr('block-subtitle', '');
        const allUrl = this.attr('display-all-url', '');
        const hasHeader = !!(title || subtitle || allUrl);

        this.classList.add('f-slider');
        this.classList.toggle('f-slider--controls-outer', this.controlsOuter);
        this.classList.toggle('f-slider--arrows-centered', this.boolAttr('arrows-centered'));
        this.style.setProperty('--f-slider-per-view', this.slidesPerView);

        const controls = this.showControls
            ? `<div class="f-slider__controls">
                   <button type="button" class="f-slider__arrow f-slider__arrow--prev" data-slide="prev"
                           aria-label="${this.escape(this.trans('common.previous'))}"></button>
                   <button type="button" class="f-slider__arrow f-slider__arrow--next" data-slide="next"
                           aria-label="${this.escape(this.trans('common.next'))}"></button>
               </div>`
            : '';

        this.innerHTML = `
            ${hasHeader
                ? `<div class="f-slider__head">
                       <div class="f-slider__headings">
                           ${title ? `<h2 class="f-slider__title">${this.escape(title)}</h2>` : ''}
                           ${subtitle ? `<p class="f-slider__subtitle">${this.escape(subtitle)}</p>` : ''}
                       </div>
                       <div class="f-slider__head-actions">
                           ${allUrl
                               ? `<a class="f-slider__all" href="${this.escape(allUrl)}">${this.escape(this.attr('display-all-title') || this.trans('common.view_all'))}</a>`
                               : ''}
                           ${this.controlsOuter ? controls : ''}
                       </div>
                   </div>`
                : ''}

            <div class="f-slider__viewport">
                <div class="f-slider__track" role="group" aria-roledescription="carousel" tabindex="0"></div>
                ${this.controlsOuter ? '' : controls}
            </div>

            ${this.hasPagination ? '<div class="f-slider__dots" role="tablist"></div>' : ''}`;

        this._track = this.querySelector('.f-slider__track');

        // The captured elements are MOVED into the fresh track — same nodes,
        // same properties — so a re-render never resets a slide's state.
        this._track.append(...(this._itemsEls || []));
        this._slides = Array.from(this._track.children);

        this._slides.forEach((slide, index) => {
            slide.classList.add('f-slider__slide');
            slide.setAttribute('data-index', String(index));
        });

        // A single slide is not a carousel; drop the chrome rather than render
        // controls that can never do anything.
        if (this.staticWhenSingle && this._slides.length <= 1) {
            this.classList.add('f-slider--static');
        }

        this.buildDots();
        this.syncState();
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            const arrow = event.target.closest('[data-slide]');
            if (arrow) {
                arrow.dataset.slide === 'next' ? this.slideNext() : this.slidePrev();
                this.pauseAutoPlay();
                return;
            }

            const dot = event.target.closest('[data-dot]');
            if (dot) {
                this.slideTo(Number(dot.dataset.dot));
                this.pauseAutoPlay();
            }
        });

        /*
         * Bound to the HOST, never to this._track: any re-render replaces the
         * track element, and a listener on the old one dies silently — the
         * index freezes and whichever arrow was disabled at that moment stays
         * disabled for good. Scroll does not bubble, but it DOES capture, so a
         * capture-phase listener on the host hears every track that will ever
         * exist inside it.
         */
        this.listen(this, 'scroll', () => {
            clearTimeout(this._scrollTimer);
            this._scrollTimer = setTimeout(() => this.syncState(), 90);
        }, { capture: true, passive: true });

        this.listen(this, 'keydown', event => {
            if (!event.target.closest('.f-slider__track')) return;
            if (event.key === 'ArrowRight') { event.preventDefault(); this.isRtl ? this.slidePrev() : this.slideNext(); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); this.isRtl ? this.slideNext() : this.slidePrev(); }
        });

        this.startAutoPlay();
    }

    disconnectedCallback() {
        this.stopAutoPlay();
        clearTimeout(this._scrollTimer);
        super.disconnectedCallback();
    }

    /* ------------------------------------------------------------- state */

    buildDots() {
        const host = this.querySelector('.f-slider__dots');
        if (!host) return;

        host.innerHTML = this._slides
            .map((_, index) => `<button type="button" class="f-slider__dot" role="tab" data-dot="${index}"
                                        aria-label="${index + 1}"></button>`)
            .join('');
    }

    /** Single source of truth for index, arrow disabling and dot state. */
    syncState() {
        if (!this._track || !this._slides.length) return;

        const position = this.scrollPosition();

        /*
         * Nearest slide by measured rects, not offsetLeft arithmetic: rects
         * already include the current scroll AND the writing direction, so the
         * same comparison works in Arabic and English. The start edge is the
         * right edge in RTL — comparing left edges there picked the LAST slide
         * as "current" at rest, which froze the index and killed the arrows.
         */
        const trackRect = this._track.getBoundingClientRect();
        const rtl = this.isRtl;

        let nearest = 0;
        let best = Infinity;

        this._slides.forEach((slide, index) => {
            const rect = slide.getBoundingClientRect();
            const distance = rtl
                ? Math.abs(trackRect.right - rect.right)
                : Math.abs(rect.left - trackRect.left);

            if (distance < best) { best = distance; nearest = index; }
        });

        this._index = nearest;

        const atStart = position <= 2;
        const atEnd = position >= this.maxScroll() - 2;

        this.querySelector('[data-slide="prev"]')?.toggleAttribute('disabled', atStart && !this.loop);
        this.querySelector('[data-slide="next"]')?.toggleAttribute('disabled', atEnd && !this.loop);

        this.querySelectorAll('[data-dot]').forEach((dot, index) => {
            const active = index === nearest;
            dot.classList.toggle('is-active', active);
            dot.setAttribute('aria-selected', String(active));
        });

        this.setState('index', nearest);
        this.emit('slide-change', { index: nearest, total: this._slides.length });
    }

    clampIndex(index) {
        const last = this._slides.length - 1;

        if (!this.loop) return Math.min(Math.max(index, 0), last);

        // Wrap in both directions so autoplay and the arrows agree.
        return index < 0 ? last : index > last ? 0 : index;
    }

    /* ---------------------------------------------------------- autoplay */

    startAutoPlay() {
        if (!this.autoPlay || this._slides.length <= 1) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        this.stopAutoPlay();
        this._timer = setInterval(() => this.slideTo(this.clampIndex(this.currentIndex + 1)), this.autoPlayDelay);

        // Pause while the pointer is over the slider — advancing under a
        // reader's cursor is the classic carousel annoyance.
        if (this._hoverWired) return;
        this._hoverWired = true;
        this.listen(this, 'pointerenter', () => this.stopAutoPlay());
        this.listen(this, 'pointerleave', () => this.startAutoPlay());
        this.listen(this, 'focusin', () => this.stopAutoPlay());
    }

    stopAutoPlay() {
        clearInterval(this._timer);
        this._timer = null;
    }

    /** A deliberate interaction stops autoplay for good, not just until hover ends. */
    pauseAutoPlay() {
        this.stopAutoPlay();
        this._hoverWired = true;
        this.removeAttribute('auto-play');
    }

    /* ------------------------------------------- RTL-normalised geometry */

    /*
     * Only two measurements remain, and both are direction-safe by
     * construction: |scrollLeft| is "distance travelled from the start edge"
     * whether the browser counts RTL scroll as negative (Chrome, Firefox) or
     * inverted-positive (legacy WebKit). Everything positional beyond this —
     * moving to a slide, finding the nearest one — uses scrollIntoView and
     * bounding rects, which the browser already resolves per direction.
     */
    scrollPosition() {
        return Math.abs(this._track.scrollLeft);
    }

    maxScroll() {
        return this._track.scrollWidth - this._track.clientWidth;
    }
}

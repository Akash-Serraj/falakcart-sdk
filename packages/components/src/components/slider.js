import FalakElement from '../base.js';

/**
 * <falak-slider block-title="New arrivals" slides-per-view="4" show-controls pagination>
 *   <div slot="items">…one child per slide…</div>
 * </falak-slider>
 *
 * <falak-slider type="thumbs" listen-to-thumbnails-option auto-height>
 *   <div slot="items">…gallery slides, each with data-img-id / data-slid-index…</div>
 *   <div slot="thumbs">…one thumbnail per slide…</div>
 * </falak-slider>
 *
 * Salla's equivalent bundles Swiper, which is most of why their component file
 * is ten thousand lines. This uses native CSS scroll-snap instead: the browser
 * already does momentum, snapping, touch and RTL correctly, and the whole
 * component is the controls, the dots, the thumbs strip and the bookkeeping
 * around them.
 *
 * The attribute vocabulary is <salla-slider>'s, so markup ports across with
 * only the tag renamed:
 *
 * | Attribute            | Description                                                    |
 * | block-title          | heading above the track                                        |
 * | block-subtitle       | line under the heading                                         |
 * | display-all-url/-title | "view all" link beside the arrows                            |
 * | type                 | '' | carousel | fullwidth | fullscreen | testimonials | blog | thumbs — presets below |
 * | slides-per-view      | a number (fractions peek the next slide) or "auto" (natural slide widths) |
 * | gap                  | space between slides (CSS length, default 1rem; type presets adjust it) |
 * | show-controls        | arrows. Default follows Salla (on) when `type` is set — ported markup expects them — and stays off otherwise, so existing falak markup is unchanged |
 * | controls-outer       | arrows in the header instead of overlaid                       |
 * | arrows-centered      | overlay arrows anchored to the media line, not the card middle |
 * | pagination           | dots                                                           |
 * | auto-play / auto-play-delay | advance on a timer (pauses on hover/focus; stops on interaction; honours reduced-motion) |
 * | loop                 | arrows and autoplay wrap                                       |
 * | centered             | active slide centred, neighbours peeking                       |
 * | vertical             | vertical main track (desktop; falls back to horizontal on phones) |
 * | auto-height          | track height follows the active slide                          |
 * | static-when-single   | a single slide renders with no carousel chrome                 |
 * | show-thumbs-controls | thumbs strip arrows (type="thumbs", default on)                |
 * | vertical-thumbs      | thumbs beside the gallery on desktop instead of below          |
 * | grid-thumbs          | thumbs as a wrapping grid instead of a strip                   |
 * | listen-to-thumbnails-option | jump to the slide whose data-img-id matches a chosen product option (`product::options.changed`) |
 * | slider-config / thumbs-config | JSON overrides, Swiper-shaped: slidesPerView, spaceBetween, loop, centeredSlides, autoplay{delay} are honoured; anything else is ignored |
 *
 * Type presets (an explicit attribute always wins over its preset):
 *   carousel      natural slide widths (slides-per-view auto)
 *   fullwidth     one full-bleed slide per view
 *   fullscreen    vertical, one viewport-height slide per view, wheel/touch scrolls between them
 *   testimonials  one per view, two from 1024px
 *   blog          one centred slide per view, looping
 *   thumbs        gallery: main track + linked thumbnails strip
 *
 * Methods mirror <salla-slider>'s: slideTo/Next/Prev(+Loop variants),
 * slideReset, slideToClosest, update/updateSlides/updateSize/updateAutoHeight,
 * getSlides, thumbsSlideTo, getThumbsSlides… — Swiper-specific arguments
 * (speed, runCallbacks) are accepted and ignored; snapping is the browser's.
 * sliderInstance() resolves to the element itself: there is no Swiper inside.
 *
 * Events: `slide-change` (ours), plus Salla's names — `afterInit` once ready,
 * `slideChange` per move, `reachBeginning` / `reachEnd` at the edges.
 *
 * RTL needs no special handling in the CSS, but it does here: in a right-to-left
 * container scrollLeft runs negative in most engines, so every position read and
 * write goes through the sign-normalising helpers at the bottom.
 */
export default class FalakSlider extends FalakElement {
    static observedAttributes = ['block-title', 'block-subtitle', 'slides-per-view', 'show-controls', 'pagination', 'type'];

    static TYPES = ['carousel', 'fullwidth', 'fullscreen', 'testimonials', 'blog', 'thumbs'];

    /* Preset defaults per type — only for attributes the author left unset. */
    static PRESETS = {
        carousel: { 'slides-per-view': 'auto' },
        fullwidth: { 'slides-per-view': '1', gap: '0' },
        fullscreen: { 'slides-per-view': '1', gap: '0', vertical: true },
        testimonials: { 'slides-per-view': '1' },
        blog: { 'slides-per-view': '1', centered: true, loop: true },
        thumbs: { 'slides-per-view': '1', gap: '0' },
    };

    get type() {
        const type = this.attr('type', '');
        return FalakSlider.TYPES.includes(type) ? type : '';
    }

    /** Preset value for an attribute the author didn't set themselves. */
    preset(name) {
        return (FalakSlider.PRESETS[this.type] || {})[name];
    }

    presetAttr(name, fallback) {
        if (this.hasAttribute(name)) return this.attr(name);
        return this.preset(name) ?? fallback;
    }

    presetBool(name) {
        if (this.hasAttribute(name)) return this.boolAttr(name);
        return this.preset(name) === true;
    }

    get slidesPerView() { return String(this.config('slidesPerView') ?? this.presetAttr('slides-per-view', '4')); }
    get gap() { return this.config('spaceBetween') !== undefined ? `${this.config('spaceBetween')}px` : this.presetAttr('gap', '1rem'); }

    /*
     * Salla defaults arrows ON; our original markup defaulted them OFF. Both
     * are honoured: `type` only appears on ported/preset markup, which gets
     * the Salla default, while type-less falak markup keeps its behaviour.
     * An explicit value (`show-controls` / `show-controls="false"`) always wins.
     */
    get showControls() {
        if (this.hasAttribute('show-controls')) return this.boolAttr('show-controls');
        return this.type !== '';
    }

    get showThumbsControls() {
        if (this.hasAttribute('show-thumbs-controls')) return this.boolAttr('show-thumbs-controls');
        return true;
    }

    get controlsOuter() { return this.boolAttr('controls-outer'); }
    get hasPagination() { return this.boolAttr('pagination'); }
    get loop() { return this.hasAttribute('loop') ? this.boolAttr('loop') : (this.config('loop') === true || this.presetBool('loop')); }
    get autoPlay() { return this.boolAttr('auto-play') || !!this.config('autoplay'); }
    get autoPlayDelay() { return this.numAttr('auto-play-delay', Number(this.config('autoplay')?.delay) || 5000); }
    get staticWhenSingle() { return this.boolAttr('static-when-single'); }
    get centered() { return this.hasAttribute('centered') ? this.boolAttr('centered') : (this.config('centeredSlides') === true || this.presetBool('centered')); }
    get vertical() { return this.hasAttribute('vertical') ? this.boolAttr('vertical') : this.presetBool('vertical'); }
    get autoHeight() { return this.boolAttr('auto-height'); }
    get isThumbs() { return this.type === 'thumbs' && !!this._thumbEls?.length; }
    get isRtl() { return getComputedStyle(this).direction === 'rtl'; }

    /** Salla parity: `direction="rtl|ltr"` overrides the inherited direction. */
    get directionOverride() {
        const dir = this.attr('direction', '');
        return dir === 'rtl' || dir === 'ltr' ? dir : '';
    }

    /** Instant instead of animated for shoppers who asked motion to stop. */
    get scrollBehavior() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    }

    /** slider-config, parsed once — Swiper-shaped JSON a port may carry. */
    config(key) {
        if (this._config === undefined) this._config = this.jsonAttr('slider-config', null) || {};
        return this._config[key];
    }

    thumbsConfig(key) {
        if (this._thumbsConf === undefined) this._thumbsConf = this.jsonAttr('thumbs-config', null) || {};
        return this._thumbsConf[key];
    }

    /* ------------------------------------------------------ imperative API */

    slideTo(index) {
        const slide = this._slides?.[this.clampIndex(index)];
        if (!slide) return this;

        /*
         * The write goes to the TRACK, never the document: scrollIntoView
         * also scrolls ancestors, so an autoplaying slider below the fold
         * dragged the whole page back to itself on every tick. Deltas are
         * measured from bounding rects (which already include the writing
         * direction) and applied to the track's own scroll position, so the
         * same arithmetic is correct in Arabic and English — the rects do the
         * RTL work that raw offsetLeft math used to get wrong.
         */
        this.scrollTrackTo(slide);

        /*
         * Belt and braces for the state: the debounced scroll listener is the
         * normal path, but a programmatic move whose scroll event never lands
         * (a browser dropping events during a snap, a test runner under
         * virtual time) would leave arrows/dots/thumbs pointing at the old
         * slide. Re-measure once mid-scroll and once after any smooth
         * animation has settled — syncState is idempotent, so the worst case
         * is a no-op.
         */
        clearTimeout(this._settleTimer);
        this._settleTimer = setTimeout(() => {
            this.syncState();
            this._settleTimer = setTimeout(() => this.syncState(), 400);
        }, 120);

        return this;
    }

    /** Rect-measured scroll of the track (or thumbs track) to a child. */
    scrollTrackTo(slide, track = this._track, center = this.centered) {
        if (!slide || !track) return;

        const trackRect = track.getBoundingClientRect();
        const rect = slide.getBoundingClientRect();
        const behavior = this.scrollBehavior;

        if (track === this._track && this._isVertical()) {
            track.scrollTo({ top: track.scrollTop + (rect.top - trackRect.top), behavior });
            return;
        }

        const delta = center
            ? (rect.left + rect.width / 2) - (trackRect.left + trackRect.width / 2)
            : (this.isRtl ? -(trackRect.right - rect.right) : rect.left - trackRect.left);

        track.scrollTo({ left: track.scrollLeft + delta, behavior });
    }

    slideNext() { return this.slideTo(this.nextIndex()); }
    slidePrev() { return this.slideTo(this.currentIndex - 1); }

    /* Salla's loop variants — same movement here: clampIndex already wraps. */
    slideToLoop(index) { return this.slideTo(index); }
    slideNextLoop() { return this.slideNext(); }
    slidePrevLoop() { return this.slidePrev(); }
    slideReset() { return this.slideTo(this.currentIndex); }
    slideToClosest() { return this.slideTo(this.currentIndex); }

    /*
     * Swiper's recalculation family. Scroll-snap has no internal geometry to
     * rebuild, so they all resolve to one honest re-measure.
     */
    update() { this.syncState(); return this; }
    updateSlides() { return this.update(); }
    updateSize() { return this.update(); }
    updateProgress() { return this.update(); }
    updateSlidesClasses() { return this.update(); }
    updateAutoHeight() { this.applyAutoHeight(); return this; }

    getSlides() { return this._slides || []; }

    /** No Swiper inside — the element IS the slider. Kept for ported call sites. */
    async sliderInstance() { return this; }
    async sliderInit() { return this; }

    /* Thumbs mirror — the strip is part of this element, so these are direct. */
    thumbsSlideTo(index) { this.scrollTrackTo(this._thumbs?.[index], this.querySelector('.f-slider__thumbs-track'), false); return this; }
    getThumbsSlides() { return this._thumbs || []; }
    async thumbsSliderInstance() { return this; }
    async thumbsSliderInit() { return this; }
    thumbsSliderUpdate() { return this.update(); }
    thumbsSliderUpdateSlides() { return this.update(); }
    getThumbsUpdateSize() { return this.update(); }

    get currentIndex() { return this._index || 0; }
    get slideCount() { return this._slides?.length || 0; }
    get isBeginning() { return this._atStart !== false; }
    get isEnd() { return this._atEnd === true; }

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
        const itemsHost = this.querySelector('[slot="items"]');
        const thumbsHost = this.querySelector('[slot="thumbs"]');

        this._thumbEls = thumbsHost ? Array.from(thumbsHost.children) : [];

        if (itemsHost) {
            this._itemsEls = Array.from(itemsHost.children);
            // Anything else the author put in the host — a promotion badge, a
            // wishlist button positioned over the gallery — is an overlay, not
            // a slide. Kept, and re-homed onto the viewport at render.
            this._extraEls = Array.from(this.children).filter(child => child !== itemsHost && child !== thumbsHost);
        } else {
            this._itemsEls = Array.from(this.children).filter(child => child !== thumbsHost);
            this._extraEls = [];
        }

        if (this.boolAttr('listen-to-thumbnails-option')) {
            this._offOptions = this.sdk.event.on('product::options.changed', payload => this.jumpToOptionImage(payload));
        }
    }

    disconnectedCallback() {
        this.stopAutoPlay();
        this._viewObserver?.disconnect();
        this._visibilityWired = false;
        clearTimeout(this._scrollTimer);
        clearTimeout(this._settleTimer);
        this._offOptions?.();
        this._lazyObserver?.disconnect();
        super.disconnectedCallback();
    }

    render() {
        const title = this.attr('block-title', '');
        const subtitle = this.attr('block-subtitle', '');
        const allUrl = this.attr('display-all-url', '');
        const hasHeader = !!(title || subtitle || allUrl || (this.controlsOuter && this.showControls));

        this.classList.add('f-slider');
        if (this.directionOverride) this.style.direction = this.directionOverride;
        if (this.type) this.classList.add(`f-slider--${this.type}`);
        this.classList.toggle('f-slider--controls-outer', this.controlsOuter);
        this.classList.toggle('f-slider--arrows-centered', this.boolAttr('arrows-centered'));
        this.classList.toggle('f-slider--vertical', this.vertical);
        this.classList.toggle('f-slider--centered', this.centered);
        this.classList.toggle('f-slider--auto-height', this.autoHeight);
        this.classList.toggle('f-slider--vertical-thumbs', this.boolAttr('vertical-thumbs'));
        this.classList.toggle('f-slider--grid-thumbs', this.boolAttr('grid-thumbs'));
        this.style.setProperty('--f-slider-per-view', this.slidesPerView === 'auto' ? 'auto' : this.slidesPerView);
        this.style.setProperty('--f-slider-gap', this.gap);
        this.classList.toggle('f-slider--per-auto', this.slidesPerView === 'auto');

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

            <div class="f-slider__body">
                <div class="f-slider__viewport">
                    <div class="f-slider__track" role="group" aria-roledescription="carousel" tabindex="0"></div>
                    ${this.controlsOuter ? '' : controls}
                </div>

                ${this._thumbEls?.length && this.type === 'thumbs' ? `
                    <div class="f-slider__thumbs">
                        <div class="f-slider__thumbs-track"></div>
                        ${this.showThumbsControls && !this.boolAttr('grid-thumbs') ? `
                            <div class="f-slider__thumbs-nav">
                                <button type="button" class="f-slider__arrow f-slider__arrow--prev" data-thumbs-slide="prev"
                                        aria-label="${this.escape(this.trans('common.previous'))}"></button>
                                <button type="button" class="f-slider__arrow f-slider__arrow--next" data-thumbs-slide="next"
                                        aria-label="${this.escape(this.trans('common.next'))}"></button>
                            </div>` : ''}
                    </div>` : ''}
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

        // Overlays (badges, buttons) sit over the viewport, outside the track.
        if (this._extraEls?.length) {
            const viewport = this.querySelector('.f-slider__viewport');
            this._extraEls.forEach(el => { el.classList.add('f-slider__extra'); viewport.append(el); });
        }

        const thumbsTrack = this.querySelector('.f-slider__thumbs-track');
        if (thumbsTrack) {
            thumbsTrack.append(...this._thumbEls);
            this._thumbs = Array.from(thumbsTrack.children);
            this._thumbs.forEach((thumb, index) => {
                thumb.classList.add('f-slider__thumb');
                thumb.setAttribute('data-thumb-index', String(index));
            });
        } else {
            this._thumbs = [];
        }

        // A single slide is not a carousel; drop the chrome rather than render
        // controls that can never do anything.
        if (this.staticWhenSingle && this._slides.length <= 1) {
            this.classList.add('f-slider--static');
        }

        this.buildDots();
        this.observeLazyBackgrounds();
        this.syncState();
        this.applyAutoHeight();

        if (!this._announcedInit) {
            this._announcedInit = true;
            this.emit('afterInit', { slider: this });
        }
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            const thumbArrow = event.target.closest('[data-thumbs-slide]');
            if (thumbArrow) {
                const track = this.querySelector('.f-slider__thumbs-track');
                const step = (this.boolAttr('vertical-thumbs') ? track.clientHeight : track.clientWidth) * 0.8;
                const sign = thumbArrow.dataset.thumbsSlide === 'next' ? 1 : -1;
                if (this.boolAttr('vertical-thumbs')) track.scrollBy({ top: sign * step, behavior: this.scrollBehavior });
                else track.scrollBy({ left: (this.isRtl ? -sign : sign) * step, behavior: this.scrollBehavior });
                return;
            }

            const thumb = event.target.closest('[data-thumb-index]');
            if (thumb) {
                this.slideTo(Number(thumb.dataset.thumbIndex));
                this.pauseAutoPlay();
                return;
            }

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

        /*
         * The <salla-slider> touch/transition event family, for ported
         * listeners. Scroll-snap has no Swiper transitions, so the honest
         * mapping is: pointer gestures -> touchSlider*, live scrolling ->
         * sliderMove, and the settled snap -> the TransitionEnd pair.
         */
        this.listen(this, 'pointerdown', event => {
            if (event.target.closest('.f-slider__track')) this.emit('touchSliderStart', { slider: this });
        });
        this.listen(this, 'pointermove', event => {
            if (this._pointerDown && event.target.closest('.f-slider__track')) this.emit('touchSliderMove', { slider: this });
        });
        this.listen(this, 'pointerup', event => {
            if (event.target.closest('.f-slider__track')) this.emit('touchSliderEnd', { slider: this });
        });
        this.listen(this, 'pointerdown', () => { this._pointerDown = true; }, { capture: true });
        this.listen(window, 'pointerup', () => { this._pointerDown = false; });

        this.listen(this, 'keydown', event => {
            if (!event.target.closest('.f-slider__track')) return;
            if (this._isVertical()) {
                if (event.key === 'ArrowDown') { event.preventDefault(); this.slideNext(); }
                if (event.key === 'ArrowUp') { event.preventDefault(); this.slidePrev(); }
                return;
            }
            if (event.key === 'ArrowRight') { event.preventDefault(); this.isRtl ? this.slidePrev() : this.slideNext(); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); this.isRtl ? this.slideNext() : this.slidePrev(); }
        });

        this.startAutoPlay();
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

    /** Single source of truth for index, arrow disabling, dot and thumb state. */
    syncState() {
        if (!this._track || !this._slides.length) return;

        const previous = this._index;
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
        const vertical = this._isVertical();

        let nearest = 0;
        let best = Infinity;

        this._slides.forEach((slide, index) => {
            const rect = slide.getBoundingClientRect();
            const distance = vertical
                ? Math.abs(rect.top - trackRect.top)
                : (this.centered
                    ? Math.abs((rect.left + rect.width / 2) - (trackRect.left + trackRect.width / 2))
                    : (rtl ? Math.abs(trackRect.right - rect.right) : Math.abs(rect.left - trackRect.left)));

            if (distance < best) { best = distance; nearest = index; }
        });

        this._index = nearest;

        const atStart = position <= 2;
        const atEnd = position >= this.maxScroll() - 2;
        this._atStart = atStart;
        this._atEnd = atEnd;

        this.querySelector('[data-slide="prev"]')?.toggleAttribute('disabled', atStart && !this.loop);
        this.querySelector('[data-slide="next"]')?.toggleAttribute('disabled', atEnd && !this.loop);

        this.querySelectorAll('[data-dot]').forEach((dot, index) => {
            const active = index === nearest;
            dot.classList.toggle('is-active', active);
            dot.setAttribute('aria-selected', String(active));
        });

        (this._thumbs || []).forEach((thumb, index) => {
            const active = index === nearest;
            thumb.classList.toggle('is-active', active);
            if (active && previous !== nearest) this.scrollTrackTo(thumb, this.querySelector('.f-slider__thumbs-track'), false);
        });

        this.setState('index', nearest);
        this.emit('slide-change', { index: nearest, total: this._slides.length });
        this.emit('sliderMove', { activeIndex: nearest });

        // The Salla names, for ported listeners.
        if (previous !== nearest) {
            this.emit('slideChangeTransitionStart', { activeIndex: nearest });
            this.emit('slideChange', { activeIndex: nearest, realIndex: nearest, isBeginning: atStart, isEnd: atEnd });
            this.emit(nearest > (previous ?? 0) ? 'slideNextTransitionEnd' : 'slidePrevTransitionEnd', { activeIndex: nearest });
            this.emit('slideChangeTransitionEnd', { activeIndex: nearest });
            this.emit('sliderTransitionEnd', { activeIndex: nearest });
            this.applyAutoHeight();
        }
        if (atStart && previous !== nearest) this.emit('reachBeginning', { slider: this });
        if (atEnd && previous !== nearest) this.emit('reachEnd', { slider: this });
    }

    clampIndex(index) {
        const last = this._slides.length - 1;

        if (!this.loop) return Math.min(Math.max(index, 0), last);

        // Wrap in both directions so autoplay and the arrows agree.
        return index < 0 ? last : index > last ? 0 : index;
    }

    /**
     * The next index for a forward move, wrapping when looping.
     *
     * WRAPPING IS DECIDED ON THE SCROLL, NOT THE SLIDE COUNT. currentIndex is
     * the slide nearest the track's leading edge, so with slides-per-view > 1
     * it tops out at (count - perView) — three, for six slides shown three at
     * a time. clampIndex only wraps above `last` (five), which that index can
     * never reach, so a looping autoplay asked for slide four forever while
     * the track sat pinned at its end: the rail played through once and
     * stopped. `_atEnd` is the honest test, and syncState already maintains it.
     */
    nextIndex() {
        if (this.loop && this._atEnd) return 0;

        return this.clampIndex(this.currentIndex + 1);
    }

    /* ------------------------------------------------ gallery integrations */

    /**
     * A chosen colour/thumbnail option names an image; the gallery jumps to
     * it. The theme marks each slide with data-img-id (and optionally
     * data-slid-index) — the same contract <salla-slider> uses — and the
     * option payload carries the selected value ids to match against.
     */
    jumpToOptionImage(payload) {
        if (!payload) return;

        const candidates = [
            ...Object.values(payload.selected || {}),
            payload.variationId,
            payload.image_id,
        ].filter(value => value !== null && value !== undefined);

        for (const value of candidates) {
            const slide = this._track?.querySelector(`[data-img-id="${CSS.escape(String(value))}"]`)?.closest('.f-slider__slide')
                || this._slides?.find(item => item.getAttribute('data-img-id') === String(value));

            if (slide) {
                const marked = slide.getAttribute('data-slid-index');
                this.slideTo(marked !== null ? Number(marked) : Number(slide.getAttribute('data-index')));
                return;
            }
        }
    }

    /** data-background lazily painted when the slide nears the viewport. */
    observeLazyBackgrounds() {
        const targets = this._track?.querySelectorAll('[data-background]');
        if (!targets?.length) return;

        this._lazyObserver ??= new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                const bg = el.getAttribute('data-background');
                if (bg) {
                    el.style.backgroundImage = `url("${bg.replace(/"/g, '%22')}")`;
                    el.removeAttribute('data-background');
                }
                observer.unobserve(el);
            });
        }, { rootMargin: '120px' });

        targets.forEach(el => this._lazyObserver.observe(el));
    }

    /** auto-height: the track is only as tall as the slide being shown. */
    applyAutoHeight() {
        if (!this.autoHeight || !this._track || this._isVertical()) return;

        const active = this._slides?.[this.currentIndex];
        if (!active) return;

        const height = active.getBoundingClientRect().height;
        if (height > 0) this._track.style.blockSize = `${Math.ceil(height)}px`;
    }

    /* ---------------------------------------------------------- autoplay */

    startAutoPlay() {
        if (!this.autoPlay || this._slides.length <= 1) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        /*
         * Only while on screen. An off-screen carousel advancing for nobody
         * wastes the battery — and before slideTo wrote to the track alone,
         * it was the thing yanking the page back up mid-read.
         */
        if (!this._visibilityWired) {
            this._visibilityWired = true;
            this._inView = false;
            this._viewObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    /*
                     * Ratio, not isIntersecting: the leave notification fires
                     * while a sliver is still intersecting, so isIntersecting
                     * reads true on the way OUT and autoplay never stopped.
                     */
                    this._inView = entry.intersectionRatio >= 0.3;
                    if (this._inView) this.startAutoPlay();
                    else this.stopAutoPlay();
                });
            }, { threshold: [0, 0.3] });
            this._viewObserver.observe(this);
            return; // the observer's first callback decides whether to start
        }

        if (!this._inView) return;

        this.stopAutoPlay();
        this._timer = setInterval(() => this.slideTo(this.nextIndex()), this.autoPlayDelay);

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

    _isVertical() {
        // Vertical needs room to scroll inside a fixed height; phones fall
        // back to the horizontal strip, matching Swiper's breakpoint switch.
        return this.vertical && window.matchMedia('(min-width: 768px)').matches;
    }

    /*
     * Only two measurements remain, and both are direction-safe by
     * construction: |scrollLeft| is "distance travelled from the start edge"
     * whether the browser counts RTL scroll as negative (Chrome, Firefox) or
     * inverted-positive (legacy WebKit). Everything positional beyond this —
     * moving to a slide, finding the nearest one — goes through bounding
     * rects, which the browser already resolves per direction.
     */
    scrollPosition() {
        return this._isVertical() ? this._track.scrollTop : Math.abs(this._track.scrollLeft);
    }

    maxScroll() {
        return this._isVertical()
            ? this._track.scrollHeight - this._track.clientHeight
            : this._track.scrollWidth - this._track.clientWidth;
    }
}

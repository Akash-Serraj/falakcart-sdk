import FalakElement from '../base.js';

/**
 * <falak-skeleton></falak-skeleton>
 * <falak-skeleton shape="circle" width="3rem" height="3rem"></falak-skeleton>
 * <falak-skeleton shape="text" lines="3"></falak-skeleton>
 *
 * A content-shaped loading placeholder — mirroring <salla-skeleton>. Where
 * <falak-loading> says "something is happening" with a spinner,
 * <falak-skeleton> holds the SHAPE of what is about to appear — a line of
 * text, an image, a card — so the layout does not jump once real content
 * lands.
 *
 * | attribute | role                                                        |
 * | shape     | rect (default) | circle | text                              |
 * | width     | any CSS length (default 100%, or `height`'s value for a     |
 * |           | circle so it stays round)                                    |
 * | height    | any CSS length (default 6rem, or 1rem for text lines)        |
 * | lines     | text shape only — how many lines to stack (default 1); the   |
 * |           | last of 2+ lines is drawn shorter, reading like a paragraph  |
 */
export default class FalakSkeleton extends FalakElement {
    static observedAttributes = ['shape', 'width', 'height', 'lines'];

    get shape() { return this.attr('shape', 'rect'); }

    render() {
        this.classList.add('f-skeleton', `f-skeleton--${this.shape}`);
        this.setAttribute('aria-hidden', 'true');

        if (this.shape === 'text') {
            this.style.inlineSize = '';
            this.style.blockSize = '';

            const width = this.attr('width', '100%');
            const lines = Math.max(1, this.numAttr('lines', 1));

            this.innerHTML = Array.from({ length: lines }, (_, index) => {
                const isLast = lines > 1 && index === lines - 1;
                return `<span class="f-skeleton__line" style="inline-size: ${isLast ? '70%' : width}"></span>`;
            }).join('');

            return;
        }

        const isCircle = this.shape === 'circle';
        this.style.inlineSize = this.attr('width', isCircle ? this.attr('height', '3rem') : '100%');
        this.style.blockSize = this.attr('height', isCircle ? this.attr('width', '3rem') : '6rem');
        this.innerHTML = '';
    }
}

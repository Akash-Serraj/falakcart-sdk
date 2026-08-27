import FalakElement from '../base.js';

/**
 * <falak-tabs-content label="Description">…</falak-tabs-content>
 * <falak-tabs-content label="Reviews" badge="24">…</falak-tabs-content>
 *
 * One panel of a <falak-tabs> — always a direct child of one. It never
 * touches its own content: the parent reads `label`/`badge` to build the
 * tab header and toggles `hidden` on this element directly, so anything
 * inside (a form, a nested component) survives every tab switch untouched.
 *
 * | attribute | role                                          |
 * | label     | the tab's header text                          |
 * | badge     | a small count/marker shown next to the label   |
 */
export default class FalakTabsContent extends FalakElement {
    static observedAttributes = ['label', 'badge'];

    render() {
        this.classList.add('f-tabs__content');
    }
}

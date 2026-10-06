import FalakSwitcher, { GLOBE } from '../lib/switcher.js';

/**
 * <falak-language></falak-language>
 *
 * The storefront language as a header dropdown — the same panel as
 * <falak-currency>, so the two read as a pair. Each row: the code chip, the
 * language in its own script ("العربية", "English") and, underneath, its
 * name in the page language when that differs ("Arabic").
 *
 * The trigger keeps the .f-locale__* class names <falak-localization-modal>
 * used, so every theme's existing header rules for the language pill apply
 * unchanged. Switching is a navigation (`?lang=`), as it always was.
 */
export default class FalakLanguage extends FalakSwitcher {
    get classes() {
        return { trigger: 'f-locale__trigger', icon: 'f-locale__globe', current: 'f-locale__current', chevron: 'f-locale__chevron' };
    }

    get icon() { return GLOBE; }
    get heading() { return this.trans('common.language'); }
    get sheetFocus() { return 'language'; }
    get current() { return this.sdk.localization.locale; }

    get options() {
        return this.sdk.localization.languages().map(language => ({
            code: language.code,
            name: language.native || language.name || language.code,
            sub: language.name && language.name !== language.native ? language.name : null,
        }));
    }

    /** The pill shows the language's own name, not its code. */
    triggerText(current) { return current?.name || current?.code?.toUpperCase() || ''; }

    select(code) { this.sdk.localization.switchLanguage(code); }

    render() {
        const options = this.options;

        this.classList.add('f-locale');

        if (options.length < 2) {
            this.innerHTML = '';
            this.hidden = true;
            return;
        }

        this.hidden = false;

        const current = options.find(option => option.code === this.current) || options[0];

        this.renderDropdown(options, current);
    }
}

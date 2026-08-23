/**
 * FalakCart storefront components — registration entry point.
 *
 * Every element is defined eagerly and guarded by a customElements.get() check,
 * so loading this bundle twice (a theme that also inlines it, a customizer
 * preview re-render) is a no-op rather than a crash.
 *
 * These components carry no CSS of their own. The stylesheet is imported here
 * so one build produces both artifacts, but Vite's library mode EXTRACTS it to
 * falak-components.css rather than injecting it at runtime — the platform links
 * that file at head:end so it is applied before first paint.
 */
import './components.css';
import './components.chrome.css';
import './components.account.css';

import FalakQuantityInput from './components/quantity-input.js';
import { FalakAccordion, FalakAccordionHead, FalakAccordionBody } from './components/accordion.js';
import FalakRatingStars from './components/rating-stars.js';
import FalakProductCard from './components/product-card.js';
import FalakProductsList from './components/products-list.js';
import FalakButton from './components/button.js';
import FalakModal from './components/modal.js';
import FalakSlider from './components/slider.js';
import FalakProductsSlider from './components/products-slider.js';
import FalakMenu from './components/menu.js';
import FalakSocial from './components/social.js';
import FalakPayments from './components/payments.js';
import FalakAppsIcons from './components/apps-icons.js';
import FalakTrustBadges from './components/trust-badges.js';
import FalakBreadcrumb from './components/breadcrumb.js';
import FalakLoginModal from './components/login-modal.js';
import FalakUserMenu from './components/user-menu.js';
import FalakLocalizationModal from './components/localization-modal.js';
import FalakOfferModal from './components/offer-modal.js';
import FalakComments from './components/comments.js';
import FalakOffers from './components/offers.js';

const REGISTRY = {
    // primitives — other components compose these
    'falak-button': FalakButton,
    'falak-modal': FalakModal,
    'falak-slider': FalakSlider,

    // product surface
    'falak-quantity-input': FalakQuantityInput,
    'falak-rating-stars': FalakRatingStars,
    'falak-product-card': FalakProductCard,
    'falak-products-list': FalakProductsList,
    'falak-products-slider': FalakProductsSlider,

    // layout & chrome
    'falak-accordion': FalakAccordion,
    'falak-accordion-head': FalakAccordionHead,
    'falak-accordion-body': FalakAccordionBody,
    'falak-menu': FalakMenu,
    'falak-breadcrumb': FalakBreadcrumb,

    // footer & trust
    'falak-social': FalakSocial,
    'falak-payments': FalakPayments,
    'falak-apps-icons': FalakAppsIcons,
    'falak-trust-badges': FalakTrustBadges,

    // account & customer
    'falak-login-modal': FalakLoginModal,
    'falak-user-menu': FalakUserMenu,
    'falak-localization-modal': FalakLocalizationModal,
    'falak-offer-modal': FalakOfferModal,
    'falak-offers': FalakOffers,
    'falak-comments': FalakComments,
};

export function defineComponents() {
    if (typeof customElements === 'undefined') return;

    Object.entries(REGISTRY).forEach(([tag, constructor]) => {
        if (!customElements.get(tag)) customElements.define(tag, constructor);
    });

    if (typeof window !== 'undefined' && window.falak) {
        window.falak.components = Object.keys(REGISTRY);
        window.falak.event.emit('falak::components.defined', Object.keys(REGISTRY));
    }
}

defineComponents();

export {
    FalakButton, FalakModal, FalakSlider,
    FalakQuantityInput, FalakRatingStars, FalakProductCard,
    FalakProductsList, FalakProductsSlider,
    FalakAccordion, FalakAccordionHead, FalakAccordionBody,
    FalakMenu, FalakBreadcrumb,
    FalakSocial, FalakPayments, FalakAppsIcons, FalakTrustBadges,
    FalakLoginModal, FalakUserMenu, FalakLocalizationModal, FalakOfferModal, FalakOffers, FalakComments,
    REGISTRY,
};

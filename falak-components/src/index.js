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
 * that file at head:start — ahead of the theme's stylesheet, inside @layer falak
 * — so it is applied before first paint and yields to any theme rule.
 */
import './styles.css';

import FalakQuantityInput from './components/quantity-input.js';
import FalakAddProductButton from './components/add-product-button.js';
import FalakAnnouncement from './components/announcement.js';
import FalakCartSummary from './components/cart-summary.js';
import FalakCartCoupons from './components/cart-coupons.js';
import FalakProductOptions from './components/product-options.js';
import FalakQuickAdd from './components/quick-add.js';
import FalakQuickBuy from './components/quick-buy.js';
import FalakLoading from './components/loading.js';
import FalakProgressBar from './components/progress-bar.js';
import FalakTooltip from './components/tooltip.js';
import FalakSkeleton from './components/skeleton.js';
import FalakPlaceholder from './components/placeholder.js';
import FalakMaintenanceAlert from './components/maintenance-alert.js';
import FalakFileUpload from './components/file-upload.js';
import FalakTabs from './components/tabs.js';
import FalakTabsContent from './components/tabs-content.js';
import FalakOrders from './components/orders.js';
import FalakNotificationItem from './components/notification-item.js';
import FalakCustomFields from './components/custom-fields.js';
import FalakPriceRange from './components/price-range.js';
import FalakDatetimePicker from './components/datetime-picker.js';
import FalakSearch from './components/search.js';
import FalakMiniCheckout from './components/mini-checkout.js';
import FalakNotifications from './components/notifications.js';
import FalakWishlistButton from './components/wishlist-button.js';
import FalakWishlistDrawer from './components/wishlist-drawer.js';
import FalakCheckout from './components/checkout.js';
import FalakPaymentStatus from './components/payment-status.js';
import FalakProductAvailability from './components/product-availability.js';
import FalakProductSizeGuide from './components/product-size-guide.js';
import FalakReviewsSummary from './components/reviews-summary.js';
import FalakAddProductToast from './components/add-product-toast.js';
import FalakUserProfile from './components/user-profile.js';
import FalakOrderSummary from './components/order-summary.js';
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
import FalakQuestions from './components/questions.js';
import FalakOffers from './components/offers.js';
import FalakCountdown, { FalakCountDown } from './components/countdown.js';
import FalakFilters from './components/filters.js';

const REGISTRY = {
    // primitives — other components compose these
    'falak-button': FalakButton,
    'falak-modal': FalakModal,
    'falak-slider': FalakSlider,

    // product surface
    'falak-quantity-input': FalakQuantityInput,
    'falak-add-product-button': FalakAddProductButton,
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
    'falak-announcement': FalakAnnouncement,
    'falak-cart-summary': FalakCartSummary,
    'falak-cart-coupons': FalakCartCoupons,
    'falak-product-options': FalakProductOptions,
    'falak-quick-add': FalakQuickAdd,
    'falak-quick-buy': FalakQuickBuy,
    'falak-loading': FalakLoading,
    'falak-progress-bar': FalakProgressBar,
    'falak-tooltip': FalakTooltip,
    'falak-skeleton': FalakSkeleton,
    'falak-placeholder': FalakPlaceholder,
    'falak-maintenance-alert': FalakMaintenanceAlert,
    'falak-file-upload': FalakFileUpload,
    'falak-tabs': FalakTabs,
    'falak-tabs-content': FalakTabsContent,
    'falak-orders': FalakOrders,
    'falak-notification-item': FalakNotificationItem,
    'falak-custom-fields': FalakCustomFields,
    'falak-price-range': FalakPriceRange,
    'falak-filters': FalakFilters,
    'falak-countdown': FalakCountdown,
    'falak-count-down': FalakCountDown, // Salla spelling — same component
    'falak-datetime-picker': FalakDatetimePicker,
    'falak-search': FalakSearch,
    'falak-mini-checkout': FalakMiniCheckout,
    'falak-notifications': FalakNotifications,
    'falak-wishlist-button': FalakWishlistButton,
    'falak-wishlist-drawer': FalakWishlistDrawer,
    'falak-checkout': FalakCheckout,
    'falak-payment-status': FalakPaymentStatus,
    'falak-product-availability': FalakProductAvailability,
    'falak-product-size-guide': FalakProductSizeGuide,
    'falak-reviews-summary': FalakReviewsSummary,
    'falak-add-product-toast': FalakAddProductToast,
    'falak-user-profile': FalakUserProfile,
    'falak-order-summary': FalakOrderSummary,

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
    'falak-questions': FalakQuestions,
};

export function defineComponents() {
    if (typeof customElements === 'undefined') return;

    Object.entries(REGISTRY).forEach(([tag, constructor]) => {
        if (!customElements.get(tag)) customElements.define(tag, constructor);
    });

    if (typeof window !== 'undefined' && window.falak) {
        window.falak.components = Object.keys(REGISTRY);
        window.falak.event.emit('falak::components.defined', Object.keys(REGISTRY));

        // A buy-now interrupted by sign-in comes back after the reload —
        // there is no element on the page to do it, so the bundle does.
        window.falak.onReady(() => FalakMiniCheckout.resume());
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
    FalakCountdown, FalakCountDown, FalakFilters,
    REGISTRY,
};

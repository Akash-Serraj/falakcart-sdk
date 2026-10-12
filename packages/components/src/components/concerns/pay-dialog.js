/**
 * Dialog plumbing shared by the order page and the payment-return page.
 *
 * Dialogs are built fresh each time they open and removed when they close:
 * <falak-modal> snapshots its content on first render, so a reused dialog
 * would show stale fields; a new element never does. Listeners bind to the
 * modal itself, because its children are rebuilt.
 *
 * Every function takes the host component first — it supplies `sdk`,
 * `trans()`, `escape()` and `money()` — and keeps the open dialog on
 * `host._dialog`, so a host can only ever have one dialog open.
 */

const NON_GATEWAY_METHODS = ['cash_on_delivery', 'cod', 'bank_transfer'];

const CARD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>';

export function openDialog(host, id, title, html, { width = 'sm' } = {}) {
    closeDialog(host);

    const modal = document.createElement('falak-modal');
    modal.id = `falak-${id}`;
    modal.setAttribute('modal-title', title);
    modal.setAttribute('width', width);
    modal.setAttribute('visible', '');
    modal.innerHTML = `<div class="f-order-dialog" data-dialog-body>${html}</div>`;

    modal.addEventListener('modal-close', () => {
        if (host._dialog === modal) host._dialog = null;
        setTimeout(() => modal.remove(), 250);
    });

    document.body.appendChild(modal);
    host._dialog = modal;

    return modal;
}

export function closeDialog(host) {
    const modal = host._dialog;
    if (!modal) return;
    host._dialog = null;
    if (typeof modal.close === 'function') modal.close(); else modal.removeAttribute('visible');
    setTimeout(() => modal.remove(), 250);
}

export function dialogBody(host) {
    return host._dialog?.querySelector('[data-dialog-body]') || null;
}

export function setDialogError(host, message) {
    const body = dialogBody(host);
    if (!body) return;
    let box = body.querySelector('[data-dialog-error]');
    if (!box) {
        box = document.createElement('p');
        box.className = 'f-order-dialog__error';
        box.setAttribute('data-dialog-error', '');
        body.prepend(box);
    }
    box.textContent = message || '';
    box.hidden = !message;
}

export function setDialogBusy(host, busy, label = '') {
    const button = dialogBody(host)?.querySelector('[data-dialog-submit]');
    if (!button) return;
    button.disabled = !!busy;
    if (busy && label) { button.dataset.idleLabel = button.textContent; button.textContent = label; }
    if (!busy && button.dataset.idleLabel) { button.textContent = button.dataset.idleLabel; delete button.dataset.idleLabel; }
}

/**
 * Pay now / retry: the store's online methods, then off to the gateway.
 *
 * `order` needs `number` and `total`. `onPaid` runs when the gateway says the
 * order was already captured (a late webhook) — the caller refreshes its view.
 */
export async function openPayDialog(host, order, { isFailed = false, onPaid = null } = {}) {
    const t = key => host.trans(key);
    const e = value => host.escape(value);

    const modal = openDialog(host, 'order-pay', t(isFailed ? 'account.retry_payment' : 'account.complete_payment'), `
        <div class="f-order-dialog__summary">
            <span>${e(t('account.order'))} <b dir="ltr">#${e(order.number)}</b></span>
            <strong>${e(host.money(order.total))}</strong>
        </div>
        <p class="f-order-dialog__hint">${e(t('account.choose_payment_method'))}</p>
        <div class="f-order-dialog__methods" data-pay-methods><span class="f-modal__spinner" aria-hidden="true"></span></div>
        <button type="button" class="f-btn f-btn--primary f-btn--wide" data-dialog-submit disabled>${e(t('account.continue_to_pay'))}</button>`);

    let selected = null;

    modal.addEventListener('click', async event => {
        const option = event.target.closest('[data-pay-method]');
        if (option) {
            selected = option.dataset.payMethod;
            modal.querySelectorAll('[data-pay-method]').forEach(el => el.classList.toggle('is-selected', el === option));
            const submit = modal.querySelector('[data-dialog-submit]');
            if (submit) submit.disabled = false;
            return;
        }

        if (!event.target.closest('[data-dialog-submit]') || !selected) return;

        setDialogBusy(host, true, t('account.processing'));
        try {
            const response = await host.sdk.api.withoutNotifier(() => host.sdk.checkout.retryPayment(order.number, { payment_method_id: selected }));
            const gateway = response?.gateway_response || {};
            const url = gateway.url || gateway.redirect_url || gateway.payment_url || gateway.transaction?.url || null;
            const status = String(response?.payment_status || '').toLowerCase();

            if (url && !String(url).includes('/payment-status')) { window.location.assign(url); return; }
            if (['completed', 'paid', 'success'].includes(status)) { closeDialog(host); await onPaid?.(); return; }

            setDialogError(host, response?.message || t('account.payment_redirect_failed'));
        } catch (error) {
            /*
             * "Already paid" is not a failure: the retry endpoint checks the
             * gateway first and, when an earlier attempt was captured but the
             * webhook never arrived, syncs the order to paid and refuses the
             * retry. The page is stale at that point — refresh it.
             */
            const paid = String(error?.falak?.payload?.payment_status || '').toLowerCase();
            if (['paid', 'completed', 'success'].includes(paid)) { closeDialog(host); await onPaid?.(); return; }

            setDialogError(host, error?.message || t('account.payment_redirect_failed'));
        }
        setDialogBusy(host, false);
    });

    try {
        const methods = await host.sdk.api.withoutNotifier(() => host.sdk.checkout.paymentGateways());
        const list = (Array.isArray(methods) ? methods : (methods?.data || []))
            .filter(m => !NON_GATEWAY_METHODS.includes(String(m.code || '').toLowerCase()));
        const box = modal.querySelector('[data-pay-methods]');
        if (!box) return modal;

        box.innerHTML = list.length
            ? list.map(m => `
                <button type="button" class="f-order-dialog__method" data-pay-method="${e(String(m.id))}">
                    <span class="f-order-dialog__method-icon" aria-hidden="true">${CARD_ICON}</span>
                    ${m.logo ? `<img src="${e(m.logo)}" alt="" loading="lazy" onload="this.previousElementSibling.remove()" onerror="this.remove()">` : ''}
                    <span>${e(m.name || String(m.code || '').replace(/_/g, ' '))}</span>
                </button>`).join('')
            : `<p class="f-order-dialog__hint">${e(t('account.no_payment_methods'))}</p>`;
    } catch (error) {
        setDialogError(host, error?.message || t('common.load_failed'));
    }

    return modal;
}

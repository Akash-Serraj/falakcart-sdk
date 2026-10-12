import FalakElement from '../base.js';

const ICONS = {
    bubble: size => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`,
    send: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/></svg>`,
    shield: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
    user: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`,
    chevron: open => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${open ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'}"/></svg>`,
};

/**
 * <falak-questions product-id="12"></falak-questions>
 *
 * Product Q&A: approved questions with their replies, plus an ask form for
 * signed-in customers. A guest gets a prompt that opens the login modal rather
 * than a form that fails on submit.
 *
 * Unlike reviews there is no purchase gate — any customer may ask — so the
 * only states are guest / customer, and the form swaps in the moment a login
 * completes on the same page.
 */
export default class FalakQuestions extends FalakElement {
    static observedAttributes = ['product-id'];

    get productId() { return this.attr('product-id'); }

    async setup() {
        if (!this.productId) return;

        this.expanded = new Set();
        await this.load();

        // Swap the sign-in prompt for the ask form without a reload.
        this._offLogin = this.sdk.event.on('auth::logged.in', () => this.render());
    }

    disconnectedCallback() {
        this._offLogin?.();
        super.disconnectedCallback();
    }

    async load() {
        this.setBusy(true);

        try {
            const response = await this.sdk.api.withoutNotifier(
                () => this.sdk.question.fetch(this.productId),
            );

            this.questions = response.questions || [];
            this.total = Number(response.total || 0);
        } catch (error) {
            this.sdk.logger.warn('falak-questions: fetch failed', error);
            this.questions = [];
            this.total = 0;
        } finally {
            this.setBusy(false);
        }
    }

    render() {
        if (!this.productId) {
            this.innerHTML = '';
            this.setAttribute('hidden', '');
            return;
        }

        this.removeAttribute('hidden');
        this.classList.add('f-questions');

        this.innerHTML = `
            <div class="f-questions__header">
                <div class="f-questions__header-row">
                    <span class="f-questions__badge">${ICONS.bubble(24)}</span>
                    <h2 class="f-questions__title">${this.escape(this.trans('questions.title'))}</h2>
                </div>
                <p class="f-questions__subtitle">${this.escape(this.trans('questions.subtitle'))}</p>
            </div>

            <div class="f-questions__body">
                ${this.formHtml()}

                <h3 class="f-questions__list-title">${this.escape(this.trans('questions.all'))} — ${this.total}</h3>

                ${this.questions?.length
                    ? `<div class="f-questions__list">${this.questions.map(q => this.questionHtml(q)).join('')}</div>`
                    : `<div class="f-questions__empty">
                           <span class="f-questions__empty-icon">${ICONS.bubble(36)}</span>
                           <h3 class="f-questions__empty-title">${this.escape(this.trans('questions.none'))}</h3>
                           <p class="f-questions__empty-text">${this.escape(this.trans('questions.be_first'))}</p>
                       </div>`}
            </div>`;
    }

    formHtml() {
        if (!this.sdk.auth.isLoggedIn()) {
            return `
                <button type="button" class="f-questions__gate" data-login>
                    ${this.escape(this.trans('questions.login_to_ask'))}
                </button>`;
        }

        return `
            <form class="f-questions__form" novalidate>
                <h3 class="f-questions__form-title">${ICONS.bubble(18)} ${this.escape(this.trans('questions.ask'))}</h3>
                <textarea class="f-questions__textarea" name="question" maxlength="500"
                          placeholder="${this.escape(this.trans('questions.placeholder'))}"></textarea>
                <p class="f-questions__error" data-error hidden></p>
                <div class="f-questions__form-actions">
                    <label class="f-questions__anonymous">
                        <input type="checkbox" name="anonymous">
                        ${this.escape(this.trans('questions.anonymous'))}
                    </label>
                    <falak-button type="submit" color="primary" size="small" loader-position="center">
                        ${ICONS.send} ${this.escape(this.trans('questions.submit'))}
                    </falak-button>
                </div>
            </form>`;
    }

    questionHtml(question) {
        const name = question.is_anonymous
            ? this.trans('questions.anonymous_name')
            : (question.user_name || this.trans('questions.anonymous_name'));

        const initial = question.is_anonymous ? '?' : (name[0] || '?').toUpperCase();
        const open = this.expanded.has(question.id);
        const replies = question.replies || [];

        return `
            <article class="f-questions__item">
                <div class="f-questions__meta">
                    <span class="f-questions__avatar" aria-hidden="true">${this.escape(initial)}</span>
                    <div class="f-questions__who">
                        <strong class="f-questions__name">${this.escape(name)}</strong>
                        <span class="f-questions__time">${this.escape(question.time_ago || '')}</span>
                    </div>
                </div>

                <p class="f-questions__text">${this.escape(question.question)}</p>

                <div class="f-questions__footer">
                    <span class="f-questions__count">${ICONS.bubble(14)} ${Number(question.reply_count || 0)} ${this.escape(this.trans('questions.replies'))}</span>
                    ${replies.length
                        ? `<button type="button" class="f-questions__toggle" data-toggle="${question.id}">
                               ${this.escape(this.trans(open ? 'questions.hide_replies' : 'questions.view_replies'))} ${ICONS.chevron(open)}
                           </button>`
                        : ''}
                </div>

                ${open && replies.length
                    ? `<div class="f-questions__replies">${replies.map(reply => this.replyHtml(reply)).join('')}</div>`
                    : ''}
            </article>`;
    }

    replyHtml(reply) {
        const admin = reply.replier_type === 'admin';
        const label = admin ? this.trans('questions.support') : (reply.replier_name || '');

        return `
            <div class="f-questions__reply">
                <div class="f-questions__reply-head">
                    <span class="f-questions__replier f-questions__replier--${admin ? 'admin' : 'customer'}">
                        ${admin ? ICONS.shield : ICONS.user} ${this.escape(label)}
                    </span>
                    <span class="f-questions__time">${this.escape(reply.time_ago || '')}</span>
                </div>
                <p class="f-questions__reply-text">${this.escape(reply.reply)}</p>
            </div>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        this.listen(this, 'click', event => {
            if (event.target.closest('[data-login]')) {
                this.sdk.event.dispatch('auth::required');
                return;
            }

            const toggle = event.target.closest('[data-toggle]');
            if (toggle) {
                const id = Number(toggle.dataset.toggle);
                this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id);
                this.render();
            }
        });

        this.listen(this, 'submit', event => {
            event.preventDefault();
            this.submit(event.target);
        });
    }

    async submit(form) {
        const data = new FormData(form);
        const question = String(data.get('question') || '').trim();
        const error = form.querySelector('[data-error]');
        const button = form.querySelector('falak-button');

        error.hidden = true;

        if (!question) {
            error.textContent = this.trans('questions.required');
            error.hidden = false;
            return;
        }

        button?.load?.();

        try {
            await this.sdk.question.ask(this.productId, {
                question,
                anonymous: data.get('anonymous') === 'on',
            });

            // The platform approves customer questions immediately, so a
            // refetch shows the new question at the top of the list.
            await this.load();
            this.render();
        } catch (submitError) {
            button?.stop?.();
            error.textContent = submitError?.message === 'AUTH_REQUIRED'
                ? this.trans('questions.login_to_ask')
                : (submitError?.messageLang || submitError?.message || this.trans('questions.failed'));
            error.hidden = false;
        }
    }
}

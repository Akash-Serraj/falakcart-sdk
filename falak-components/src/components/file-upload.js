import FalakElement from '../base.js';

/**
 * <falak-file-upload accept="image/*" label="Upload a photo"></falak-file-upload>
 * <falak-file-upload accept="image/*,.pdf" multiple max-size="5" name="attachments"></falak-file-upload>
 *
 * A drag-and-drop file picker with previews — mirroring <salla-file-upload>.
 * Click or drop to add files; each gets a thumbnail (images) or a filename
 * chip, with its own remove button. This component only COLLECTS files — it
 * never uploads them itself, so it has no opinion about the endpoint: read
 * `.files` (a plain array of File objects) or listen for `change`.
 *
 * | attribute  | role                                                        |
 * | accept     | MIME types / extensions, same syntax as <input type=file>  |
 * | multiple   | allow more than one file                                   |
 * | max-size   | per-file limit in MB; an oversized file is rejected with an |
 * |            | inline error rather than silently dropped                  |
 * | label      | the drop-zone's own text (default: a generic prompt)        |
 * | name       | forwarded to the hidden native <input>, so a plain <form>   |
 * |            | post still carries the files under this field name          |
 *
 * Events: DOM `change` on the element (detail: `{ files }`) — no bus
 * event, since this is a form control always scoped to whoever holds it.
 */
export default class FalakFileUpload extends FalakElement {
    static observedAttributes = ['accept', 'multiple', 'max-size', 'label', 'name'];

    static ICON = '<svg class="f-upload__icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
    static FILE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';

    get accept() { return this.attr('accept', ''); }
    get multiple() { return this.boolAttr('multiple'); }
    get maxSizeBytes() { return this.numAttr('max-size', 0) * 1024 * 1024; }
    get files() { return this._files || []; }

    connectedCallback() {
        if (this._files === undefined) { this._files = []; this._previews = []; }

        return super.connectedCallback();
    }

    render() {
        this.classList.add('f-upload');

        const label = this.attr('label') || this.trans(this.multiple ? 'common.upload_files' : 'common.upload_file');

        this.innerHTML = `
            <div class="f-upload__zone" data-upload-zone tabindex="0" role="button" aria-label="${this.escape(label)}">
                ${FalakFileUpload.ICON}
                <span class="f-upload__label">${this.escape(label)}</span>
                <input type="file" class="f-upload__input" data-upload-input
                       ${this.accept ? `accept="${this.escape(this.accept)}"` : ''}
                       ${this.multiple ? 'multiple' : ''}
                       ${this.attr('name') ? `name="${this.escape(this.attr('name'))}"` : ''} hidden>
            </div>
            ${this._error ? `<p class="f-upload__error" role="alert">${this.escape(this._error)}</p>` : ''}
            ${this.files.length ? `
                <ul class="f-upload__list">
                    ${this.files.map((file, index) => this.itemHtml(file, index)).join('')}
                </ul>` : ''}`;
    }

    itemHtml(file, index) {
        const preview = this._previews[index]
            ? `<img class="f-upload__thumb" src="${this._previews[index]}" alt="">`
            : `<span class="f-upload__thumb f-upload__thumb--file" aria-hidden="true">${FalakFileUpload.FILE_ICON}</span>`;

        return `
            <li class="f-upload__item">
                ${preview}
                <span class="f-upload__name">${this.escape(file.name)}</span>
                <span class="f-upload__size">${this.escape(this.formatSize(file.size))}</span>
                <button type="button" class="f-upload__remove" data-upload-remove="${index}" aria-label="${this.escape(this.trans('common.remove'))}">&times;</button>
            </li>`;
    }

    afterRender() {
        if (this._wired) return;
        this._wired = true;

        const zone = () => this.querySelector('[data-upload-zone]');
        const input = () => this.querySelector('[data-upload-input]');

        this.listen(this, 'click', event => {
            const remove = event.target.closest('[data-upload-remove]');
            if (remove) { this.removeAt(Number(remove.getAttribute('data-upload-remove'))); return; }

            if (event.target.closest('[data-upload-zone]') && !event.target.closest('[data-upload-input]')) input()?.click();
        });

        this.listen(this, 'keydown', event => {
            if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-upload-zone]')) {
                event.preventDefault();
                input()?.click();
            }
        });

        this.listen(this, 'change', event => {
            if (!event.target.matches('[data-upload-input]')) return;

            // The hidden native input's own 'change' is an implementation
            // detail — never let it bubble past this element, or a component
            // nesting this one (a <falak-custom-fields> field) sees a raw
            // native event with no useful `.detail` mixed in with the clean
            // one this component means to emit.
            event.stopImmediatePropagation();
            this.addFiles(event.target.files);
        });

        this.listen(this, 'dragover', event => { event.preventDefault(); zone()?.classList.add('is-dragover'); });
        this.listen(this, 'dragleave', () => zone()?.classList.remove('is-dragover'));
        this.listen(this, 'drop', event => {
            event.preventDefault();
            zone()?.classList.remove('is-dragover');
            this.addFiles(event.dataTransfer?.files);
        });
    }

    addFiles(fileList) {
        const incoming = [...(fileList || [])];
        if (!incoming.length) return;

        this._error = null;

        const accepted = [];
        for (const file of incoming) {
            if (this.maxSizeBytes && file.size > this.maxSizeBytes) {
                this._error = this.trans('common.upload_too_large', { name: file.name, max: this.attr('max-size') });
                continue;
            }
            accepted.push(file);
        }

        this._files = this.multiple ? [...this._files, ...accepted] : accepted.slice(-1);
        this.rebuildPreviews();
        this.render();
        this.emit('change', { files: this.files });
    }

    removeAt(index) {
        this._files = this._files.filter((_, i) => i !== index);
        this.rebuildPreviews();
        this.render();
        this.emit('change', { files: this.files });
    }

    rebuildPreviews() {
        (this._previews || []).forEach(url => { if (url) URL.revokeObjectURL(url); });
        this._previews = this._files.map(file => file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    }

    formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;

        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    disconnectedCallback() {
        (this._previews || []).forEach(url => { if (url) URL.revokeObjectURL(url); });
        super.disconnectedCallback();
    }
}

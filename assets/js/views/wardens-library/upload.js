// Warden's Library uploads: pick/drop files, choose a shelf, stage them with store.putBinary (committed on Save).
import { h, clear } from '../../core/dom.js';
import { openModal, select, toast, choiceDialog, icon } from '../../core/ui.js';
import { store } from '../../core/store.js';
import {
  ROOT, ACCEPT, LARGE_BYTES, MAX_BYTES, listFolders, safeFileName, safeFolder, freePath, fmtSize, typeOf, shelfLabel,
} from './files.js';

const NEW_SHELF = ':new';

/**
 * openUploadDialog({files, shelf, onDone(paths)})
 * files: initial File list (e.g. dropped on the page); shelf: preselected folder relative to the library root.
 */
export function openUploadDialog({ files = [], shelf = '', onDone } = {}) {
  const picked = [];
  const folders = listFolders();

  const fileInput = h('input', {
    class: 'wl-file-input', type: 'file', multiple: true, accept: ACCEPT,
    onchange: (e) => { addFiles(e.target.files); e.target.value = ''; },
  });
  const zone = h('label', { class: 'wl-drop' },
    fileInput,
    h('span', { class: 'wl-drop-icon' }, icon('upload', 28)),
    h('span', { class: 'wl-drop-text' }, h('strong', null, 'Choose files'), ' or drop them here'),
    h('span', { class: 'wl-drop-hint' }, 'PDF, Word (.docx / .doc), Markdown, text or images'));
  let depth = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth += 1; zone.classList.add('is-over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('is-over'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('is-over');
    addFiles(e.dataTransfer?.files);
  });

  const list = h('ul', { class: 'wl-up-list', hidden: true });

  const newName = h('input', {
    class: 'input', type: 'text', hidden: true, placeholder: 'e.g. Lore, or Handouts/Session 3',
    'aria-label': 'New shelf name', oninput: () => updateWhere(),
  });
  const shelfSel = select(
    [
      { value: '', label: 'General (library root)' },
      ...folders.map((f) => ({ value: f, label: shelfLabel(f) })),
      { value: NEW_SHELF, label: 'New shelf…' },
    ],
    folders.includes(shelf) ? shelf : '',
    (v) => {
      newName.hidden = v !== NEW_SHELF;
      if (v === NEW_SHELF) newName.focus();
      updateWhere();
    },
    { 'aria-label': 'Shelf' },
  );
  const where = h('span', { class: 'field-hint' });

  const body = h('div', { class: 'stack wl-upload' },
    zone,
    list,
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Shelf'),
      shelfSel,
      newName,
      where),
    h('p', { class: 'wl-up-note' },
      'Files are kept on this device until you press ', h('strong', null, 'Save'),
      ', which commits them to the repository for the whole party.'));

  const modal = openModal({
    title: 'Add documents',
    body,
    className: 'wl-upload-modal',
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Add to library', kind: 'primary', onClick: submit },
    ],
  });
  const submitBtn = modal.el.querySelector('.modal-foot .btn-primary');

  addFiles(files);
  updateWhere();

  function folder() {
    return shelfSel.value === NEW_SHELF ? safeFolder(newName.value) : shelfSel.value;
  }

  function updateWhere() {
    const f = folder();
    where.textContent = shelfSel.value === NEW_SHELF && !f
      ? 'Name the new shelf. Use “/” for a shelf inside another.'
      : `Saved to ${ROOT}${f ? `${f}/` : ''}`;
    updateSubmit();
  }

  function addFiles(fileList) {
    for (const f of fileList || []) {
      if (!picked.some((p) => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified)) picked.push(f);
    }
    drawList();
  }

  function warningFor(f) {
    if (f.size > MAX_BYTES) return { level: 'error', text: `Too large to store on GitHub (${fmtSize(f.size)}; the limit is 100 MB). It will be skipped.` };
    if (f.size > LARGE_BYTES) {
      return {
        level: 'warn',
        text: `Large file (${fmtSize(f.size)}). Saving it through the site can be slow, and it won’t be kept for offline reading. `
          + 'For big files, adding them to the repository directly (GitHub Desktop or git) is more reliable.',
      };
    }
    if (!f.size) return { level: 'warn', text: 'This file is empty.' };
    return null;
  }

  function drawList() {
    clear(list);
    list.hidden = !picked.length;
    picked.forEach((f, i) => {
      const type = typeOf(f.name);
      const warn = warningFor(f);
      const safe = safeFileName(f.name);
      list.append(h('li', { class: ['wl-up-item', warn && `is-${warn.level}`] },
        h('span', { class: 'wl-up-icon' }, icon(type.icon)),
        h('span', { class: 'wl-up-main' },
          h('span', { class: 'wl-up-name' }, f.name),
          safe !== f.name ? h('span', { class: 'wl-up-as' }, `saved as ${safe}`) : null,
          warn ? h('span', { class: 'wl-up-warn' }, warn.text) : null),
        h('span', { class: 'wl-up-size' }, fmtSize(f.size)),
        h('button', {
          class: 'btn-icon btn-sm', type: 'button', 'aria-label': `Remove ${f.name} from the list`, title: 'Remove from the list',
          onclick: () => { picked.splice(i, 1); drawList(); },
        }, icon('close'))));
    });
    updateSubmit();
  }

  function usable() { return picked.filter((f) => f.size <= MAX_BYTES); }

  function updateSubmit() {
    if (!submitBtn) return;
    const n = usable().length;
    submitBtn.disabled = !n || (shelfSel.value === NEW_SHELF && !folder());
    submitBtn.textContent = n > 1 ? `Add ${n} documents` : 'Add to library';
  }

  async function submit() {
    const chosen = usable();
    if (!chosen.length) { toast('Choose at least one file to add.', { type: 'error' }); return false; }
    const dir = folder();
    if (shelfSel.value === NEW_SHELF && !dir) { toast('Give the new shelf a name.', { type: 'error' }); newName.focus(); return false; }
    const prefix = `${ROOT}${dir ? `${dir}/` : ''}`;
    const existing = new Set(store.files(ROOT).map((f) => f.path));

    // Plan target paths; duplicates inside this batch get numbered, clashes with the shelf need consent.
    const plan = [];
    const inBatch = new Set();
    for (const file of chosen) {
      let path = `${prefix}${safeFileName(file.name)}`;
      if (inBatch.has(path)) path = freePath(path, new Set([...existing, ...inBatch]));
      inBatch.add(path);
      plan.push({ file, path, clash: existing.has(path) });
    }
    const clashes = plan.filter((p) => p.clash);
    if (clashes.length) {
      const choice = await choiceDialog(
        h('div', { class: 'stack' },
          h('p', null, clashes.length === 1
            ? 'A document with this name is already on the shelf:'
            : `${clashes.length} documents with these names are already on the shelf:`),
          h('ul', { class: 'wl-clash-list' }, clashes.map((p) => h('li', null, h('code', null, p.path.slice(ROOT.length))))),
          h('p', { class: 'muted' }, 'Replace overwrites them when you save. Keep both adds the new files with a number at the end.')),
        [
          { label: 'Cancel', value: 'cancel', kind: 'ghost' },
          { label: 'Keep both', value: 'both', kind: 'ghost' },
          { label: clashes.length === 1 ? 'Replace it' : 'Replace them', value: 'replace', kind: 'danger' },
        ],
        { title: 'Already in the library' },
      );
      if (!choice || choice === 'cancel') return false;
      if (choice === 'both') {
        const taken = new Set([...existing, ...plan.map((p) => p.path)]);
        for (const p of clashes) { p.path = freePath(p.path, taken); taken.add(p.path); }
      }
    }

    const buttons = [...modal.el.querySelectorAll('.modal-foot .btn')];
    buttons.forEach((b) => { b.disabled = true; });
    const done = [];
    try {
      for (const p of plan) {
        submitBtn.textContent = plan.length > 1 ? `Adding ${done.length + 1} of ${plan.length}…` : 'Adding…';
        await store.putBinary(p.path, p.file);
        done.push(p.path);
      }
    } catch (e) {
      console.error('[wardens-library] upload failed', e);
      toast(`Could not add ${plan[done.length]?.file.name || 'a file'}: ${e.message || e}`, { type: 'error' });
      buttons.forEach((b) => { b.disabled = false; });
      updateSubmit();
      if (done.length) onDone?.(done);
      return false;
    }
    const n = done.length;
    toast(`Added ${n} document${n === 1 ? '' : 's'}. Press Save to ${store.mode === 'sandbox' ? 'keep' : 'commit'} ${n === 1 ? 'it' : 'them'}.`, { type: 'success', timeout: 6000 });
    onDone?.(done);
    return true;
  }

  return modal;
}

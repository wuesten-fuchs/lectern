/** The slide navigator: thumbnails, selection, drag-to-reorder, context menu. */

import type { App } from '../app/App';
import { isStack, slideLabel } from '../deck/html';
import { blankLike, SLIDE_LAYOUTS } from '../deck/templates';
import type { SlideRef } from '../stage/Stage';
import { h, svgIcon, debounce, modKey } from './dom';
import { icons } from './icons';
import { showMenu } from './Menu';

/** Fork: `key` is the slide's uid plus its stack position; `html` the source the thumbnail last painted. */
interface Card { ref: SlideRef; key: string; html: string; el: HTMLElement; iframe: HTMLIFrameElement; dirty: boolean; visible: boolean }

/** Fork: how far off screen a card still counts as visible (observer and `inView` alike). */
const NEAR_PX = 200;

function cardId(ref: SlideRef): string { return `lec-slide-${ref.top}${ref.sub === null ? '' : '-' + ref.sub}`; }

export class Navigator {
  private cards: Card[] = [];
  private io: IntersectionObserver;
  private dragFrom: number | null = null;
  private dirtyTops = new Set<number>();
  private allDirty = false;
  private flush = debounce(() => this.renderDirty(), 200);

  constructor(readonly app: App, readonly container: HTMLElement) {
    container.tabIndex = 0;
    container.setAttribute('role', 'listbox');
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const card = this.cards.find((c) => c.el === e.target);
        if (!card) continue;
        card.visible = e.isIntersecting;
        if (card.visible && card.dirty) this.renderCard(card);
      }
    }, { root: container, rootMargin: `${NEAR_PX}px 0px` });

    container.addEventListener('keydown', (ev) => this.onKey(ev));
    container.addEventListener('contextmenu', (ev) => {
      if ((ev.target as HTMLElement).closest('.lec-slide-card')) return;
      ev.preventDefault();
      // Not on a card: the click is in a gap, so act on the gap rather than on
      // whichever slide happens to be current.
      this.showGapMenu(this.gapAt(ev.clientY), { x: ev.clientX, y: ev.clientY });
    });
  }

  /**
   * Rebuilds the list of cards (call when the slide list changed).
   *
   * Fork: a card is reused when its slide is still there (same uid, and for a
   * sub-slide the same position in its stack), so deleting or undoing a delete
   * keeps every other thumbnail as it is instead of tearing down one iframe per
   * slide and loading them all again. Only a card whose slide HTML changed, or a
   * new one, renders; the visible ones right away, not after the debounce.
   */
  render(): void {
    const ed = this.app.editor;
    for (const c of this.cards) this.io.unobserve(c.el);
    const old = new Map(this.cards.map((c) => [c.key, c]));
    this.cards = [];
    if (!ed.ready) { this.container.replaceChildren(); return; }
    const refs = ed.slideRefs();
    const nodes: Node[] = [];
    if (!refs.length) {
      nodes.push(h('div', { class: 'lec-nav-empty' }, 'No slides yet.'));
    }
    const { width, height } = ed.stage.slideSize;
    for (const ref of refs) {
      const key = `${ed.doc.slides[ref.top].uid}/${ref.sub ?? ''}`;
      const section = ed.stage.srcSection(ref);
      const html = section.outerHTML;
      let c = old.get(key);
      old.delete(key);
      if (c && (c.iframe.width !== String(width) || c.iframe.height !== String(height))) c = undefined;
      if (!c) c = this.createCard(ref, key, width, height);
      if (c.html !== html) c.dirty = true;
      c.ref = ref;
      this.labelCard(c, section);
      nodes.push(c.el);
      this.cards.push(c);
    }
    const addBtn = h('button', { class: 'lec-btn lec-nav-add', type: 'button', title: `New slide (${modKey()}⇧N)`, onclick: (e: MouseEvent) => this.app.showNewSlideMenu(e.currentTarget as HTMLElement) }, svgIcon(icons.plus), 'New slide');
    nodes.push(addBtn);
    // Drop what is gone first, then move only nodes out of place. Moving an iframe
    // reloads it (and loses the thumbnail's re-centring), so a moved card repaints.
    const keep = new Set(nodes);
    for (const n of Array.from(this.container.childNodes)) if (!keep.has(n)) n.remove();
    const kids = this.container.childNodes;
    nodes.forEach((n, i) => {
      if (kids[i] === n) return;
      if (n.isConnected) { const moved = this.cards.find((c) => c.el === n); if (moved) moved.dirty = true; }
      this.container.insertBefore(n, kids[i] ?? null);
    });
    for (const c of this.cards) this.io.observe(c.el);
    this.updateCurrent();
    this.fitThumbs();
    for (const c of this.cards) if (c.dirty && this.inView(c)) this.renderCard(c);
  }

  /** Fork: whether a card is on screen (or near it), measured now rather than waiting for the observer. */
  private inView(c: Card): boolean {
    const r = c.el.getBoundingClientRect();
    const v = this.container.getBoundingClientRect();
    return r.bottom >= v.top - NEAR_PX && r.top <= v.bottom + NEAR_PX && r.height > 0;
  }

  /** Fork: one card for a slide; its listeners read `c.ref`, so a reused card follows its slide. */
  private createCard(ref: SlideRef, key: string, width: number, height: number): Card {
    const ed = this.app.editor;
    const isSub = ref.sub !== null;
    // sandbox without allow-scripts: a deck's <script>/onerror must not run inside the editor's origin;
    // allow-same-origin keeps service-worker-served images loading. Thumbnails are pure HTML/CSS.
    const iframe = h('iframe', { loading: 'lazy', tabindex: -1, sandbox: 'allow-same-origin', 'aria-hidden': 'true' });
    iframe.width = String(width); iframe.height = String(height);
    const wrap = h('div', { class: 'lec-thumb-wrap', style: `padding-bottom:${((height / width) * 100).toFixed(3)}%` }, iframe);
    const el = h('div', { class: `lec-slide-card${isSub ? ' lec-sub' : ''}`, draggable: true, role: 'option', 'aria-selected': 'false' },
      h('div', { class: 'lec-slide-num' }),
      h('div', { class: 'lec-thumb' }, wrap, h('div', { class: 'lec-thumb-label' }, ' ')),
    );
    const c: Card = { ref, key, html: '', el, iframe, dirty: true, visible: false };
    el.addEventListener('click', () => { ed.goTo(c.ref); this.container.focus(); });
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      // The cards sit flush against each other, so "between two slides" has no pixels of
      // its own. Treat a band at each edge as the seam, the same way dragging reads the
      // midpoint to decide before or after.
      const r = el.getBoundingClientRect();
      const edge = Math.min(10, r.height * 0.18);
      if (ev.clientY < r.top + edge || ev.clientY > r.bottom - edge) {
        const after = ev.clientY > r.top + r.height / 2;
        this.showGapMenu(c.ref.top + (after ? 1 : 0), { x: ev.clientX, y: ev.clientY });
        return;
      }
      ed.goTo(c.ref);
      this.showMenuFor(c.ref, { x: ev.clientX, y: ev.clientY });
    });
    el.addEventListener('dblclick', () => this.app.panels.show('html'));
    this.wireDrag(c);
    return c;
  }

  /** Fork: number, label, badge and ids of a card for its current position. */
  private labelCard(c: Card, section: Element): void {
    const { ref, el } = c;
    const numLabel = ref.sub !== null ? `${ref.top + 1}.${ref.sub + 1}` : String(ref.top + 1);
    const label = slideLabel(section, '');
    const vis = section.getAttribute('data-visibility');
    el.id = cardId(ref);
    el.dataset.top = String(ref.top);
    el.dataset.sub = ref.sub === null ? '' : String(ref.sub);
    el.title = label;
    el.setAttribute('aria-label', `Slide ${numLabel}${label ? ': ' + label : ''}${vis ? ` (${vis})` : ''}`);
    c.iframe.title = `Slide ${numLabel}`;
    const num = el.querySelector('.lec-slide-num')!;
    if (num.textContent !== numLabel) num.textContent = numLabel;
    const lab = el.querySelector('.lec-thumb-label')!;
    if (lab.textContent !== (label || ' ')) lab.textContent = label || ' ';
    const badge = el.querySelector('.lec-slide-badge');
    if (vis) {
      if (badge) badge.textContent = vis;
      else el.appendChild(h('span', { class: 'lec-slide-badge' }, vis));
    } else badge?.remove();
  }

  /** Scales the thumbnail iframes to the card width. */
  fitThumbs(): void {
    const ed = this.app.editor;
    if (!ed.ready) return;
    const { width } = ed.stage.slideSize;
    for (const c of this.cards) {
      const wrapW = c.iframe.parentElement?.clientWidth ?? 0;
      if (wrapW) c.iframe.style.transform = `scale(${wrapW / width})`;
    }
  }

  updateCurrent(): void {
    const cur = this.app.editor.current;
    for (const c of this.cards) {
      const on = c.ref.top === cur.top && c.ref.sub === cur.sub;
      c.el.classList.toggle('lec-current', on);
      c.el.setAttribute('aria-selected', String(on));
      if (on) { c.el.scrollIntoView({ block: 'nearest' }); this.container.setAttribute('aria-activedescendant', c.el.id); }
    }
  }

  /** Marks slides as needing a re-render. */
  invalidate(tops: number[] | null): void {
    if (tops === null) this.allDirty = true;
    else for (const t of tops) this.dirtyTops.add(t);
    this.flush();
  }

  private renderDirty(): void {
    for (const c of this.cards) {
      if (this.allDirty || this.dirtyTops.has(c.ref.top)) {
        c.dirty = true;
        if (c.visible) this.renderCard(c);
      }
    }
    this.allDirty = false;
    this.dirtyTops.clear();
    // Labels may have changed too. Fork: the whole card label (title, badge), as render() does.
    for (const c of this.cards) {
      try { this.labelCard(c, this.app.editor.stage.srcSection(c.ref)); } catch { /* ignore */ }
    }
  }

  private renderCard(c: Card): void {
    c.dirty = false;
    // Fork: remember what was painted, so render() knows when the slide changed since.
    try { c.html = this.app.editor.stage.srcSection(c.ref).outerHTML; } catch { /* ignore */ }
    this.app.thumbs.render(c.ref, c.iframe);
  }

  // ---------------------------------------------------------------- drag to reorder

  /** Fork: takes the card, not a ref, so a reused card drags as the slide it shows now. */
  private wireDrag(c: Card): void {
    const card = c.el;
    card.addEventListener('dragstart', (ev) => {
      const ref = c.ref;
      this.dragFrom = this.cards.indexOf(c);
      card.classList.add('lec-dragging');
      ev.dataTransfer?.setData('text/plain', `slide:${ref.top}/${ref.sub}`);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('lec-dragging');
      this.clearDropMarks();
      this.dragFrom = null;
    });
    card.addEventListener('dragover', (ev) => {
      if (this.dragFrom === null) return;
      ev.preventDefault();
      const r = card.getBoundingClientRect();
      const after = ev.clientY > r.top + r.height / 2;
      this.clearDropMarks();
      card.classList.add(after ? 'lec-drop-after' : 'lec-drop-before');
    });
    card.addEventListener('dragleave', () => card.classList.remove('lec-drop-after', 'lec-drop-before'));
    card.addEventListener('drop', (ev) => {
      if (this.dragFrom === null) return;
      ev.preventDefault();
      const r = card.getBoundingClientRect();
      const after = ev.clientY > r.top + r.height / 2;
      const from = this.cards[this.dragFrom].ref;
      this.clearDropMarks();
      this.dragFrom = null;
      this.dropSlide(from, c.ref, after);
    });
  }

  private clearDropMarks(): void {
    for (const c of this.cards) c.el.classList.remove('lec-drop-after', 'lec-drop-before');
  }

  private dropSlide(from: SlideRef, to: SlideRef, after: boolean): void {
    const ed = this.app.editor;
    if (from.sub === null && to.sub === null) {
      let target = to.top + (after ? 1 : 0);
      if (from.top < target) target--;
      ed.moveSlide(from.top, target);
    } else if (from.sub !== null && to.sub !== null && from.top === to.top) {
      let target = to.sub + (after ? 1 : 0);
      if (from.sub < target) target--;
      ed.moveSubSlide(from.top, from.sub, target);
    } else if (from.sub === null && to.sub !== null) {
      // Drop a whole slide next to a stack: place relative to the stack.
      let target = to.top + (after ? 1 : 0);
      if (from.top < target) target--;
      ed.moveSlide(from.top, target);
    } else {
      this.app.toast('Drag a stacked slide within its own stack, or use the HTML view to move it out.', 'info');
    }
  }

  // ---------------------------------------------------------------- keyboard & menu

  private onKey(ev: KeyboardEvent): void {
    const ed = this.app.editor;
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') { ev.preventDefault(); ed.next(); }
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') { ev.preventDefault(); ed.prev(); }
    else if (ev.key === 'Home') { ev.preventDefault(); const r = ed.slideRefs()[0]; if (r) ed.goTo(r); }
    else if (ev.key === 'End') { ev.preventDefault(); const r = ed.slideRefs().at(-1); if (r) ed.goTo(r); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); this.app.deleteCurrentSlide(); }
    else if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); ed.duplicateSlide(); }
    else if (mod && ev.key.toLowerCase() === 'c') { ev.preventDefault(); ed.copySlide(); this.app.toast('Slide copied'); }
    else if (mod && ev.key.toLowerCase() === 'v') { ev.preventDefault(); ed.pasteSlides(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); this.app.editor.overlay.el.focus(); }
  }

  /**
   * Which top-level boundary a point in the rail falls on: 0 above the first slide,
   * `doc.length` below the last. Sub-slides resolve to their stack's boundary, the same
   * way dragging one out of its stack does.
   */
  private gapAt(y: number): number {
    const ed = this.app.editor;
    let index = 0;
    for (const c of this.cards) {
      const r = c.el.getBoundingClientRect();
      if (y > r.top + r.height / 2) index = c.ref.top + 1;
    }
    return Math.min(index, ed.doc.length);
  }

  /** The menu for a gap between two slides: what to put *here*. */
  showGapMenu(index: number, at: { x: number; y: number }): void {
    const ed = this.app.editor;
    const above = index > 0 ? ed.doc.slides[index - 1]?.el : ed.doc.slides[0]?.el;
    const where = index === 0 ? 'at the top'
      : index >= ed.doc.length ? 'at the end'
      : `between ${index} and ${index + 1}`;
    void showMenu([
      { label: `New slide ${where}`, icon: 'plus', disabled: !above,
        onSelect: () => { if (above) ed.addSlide(blankLike(above), index - 1); } },
      { label: 'New slide from layout…', onSelect: () => { ed.goTo({ top: Math.max(0, index - 1), sub: null }); this.app.showNewSlideMenu(at); } },
      { separator: true },
      { label: 'Paste slide here', shortcut: `${modKey()}V`, disabled: ed.clipboard?.kind !== 'slides',
        onSelect: () => ed.pasteSlides(index - 1) },
    ], at);
  }

  showMenuFor(ref: SlideRef | null, at: { x: number; y: number }): void {
    const ed = this.app.editor;
    const cur = ref ?? ed.current;
    const section = ed.doc.length ? ed.stage.srcSection(cur) : null;
    const vis = section?.getAttribute('data-visibility') ?? '';
    const stack = section ? isStack(ed.doc.slides[cur.top].el) : false;
    void showMenu([
      { label: 'New slide like this one', icon: 'plus', disabled: !section, onSelect: () => { if (section) ed.addSlide(blankLike(section), cur.top); } },
      { label: 'New blank slide', shortcut: `${modKey()}⇧N`, onSelect: () => ed.addSlide(SLIDE_LAYOUTS[2].html(ed.stage.slideSize), cur.top) },
      { label: 'New slide from layout…', onSelect: () => this.app.showNewSlideMenu(at) },
      { label: 'Duplicate', icon: 'duplicate', shortcut: `${modKey()}D`, disabled: !section, onSelect: () => ed.duplicateSlide(cur) },
      { separator: true },
      { label: 'Copy slide', shortcut: `${modKey()}C`, disabled: !section, onSelect: () => { ed.copySlide(cur); this.app.toast('Slide copied'); } },
      { label: 'Paste slide after', shortcut: `${modKey()}V`, disabled: ed.clipboard?.kind !== 'slides', onSelect: () => ed.pasteSlides(cur.top) },
      { separator: true },
      { label: 'Skip in presentation (uncounted)', checked: vis === 'uncounted', disabled: !section || stack, onSelect: () => ed.setSlideAttr(cur, 'data-visibility', vis === 'uncounted' ? null : 'uncounted') },
      { label: 'Hidden', checked: vis === 'hidden', disabled: !section || stack, onSelect: () => ed.setSlideAttr(cur, 'data-visibility', vis === 'hidden' ? null : 'hidden') },
      { separator: true },
      { label: 'Edit HTML', icon: 'code', disabled: !section, onSelect: () => this.app.panels.show('html') },
      { label: 'Speaker notes', icon: 'notes', disabled: !section, onSelect: () => this.app.panels.show('notes') },
      { separator: true },
      { label: 'Delete slide', icon: 'trash', shortcut: '⌫', disabled: !section, onSelect: () => this.app.deleteCurrentSlide(cur) },
    ], at);
  }
}

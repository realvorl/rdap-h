(function (root, factory) {
  const rdap = root.RDAPHuman || (typeof module === 'object' && module.exports ? require('./rdap.js') : null);
  const api = factory(rdap);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';
  const KOFI_URL = '';
  const MAX_NODES = 7000;
  let dark, screen, machinePane, filterControls, data, kind, sourceUrl, rawResponse, host, shadow, toggle;

  function mount(options) {
    const { container = document.body, stylesheetUrl, onModeChange = () => {} } = options;
    if (!R) throw new Error('RDAP core is not loaded.');
    if (!R.isObject(options.data) || !options.kind) throw new TypeError('A recognized RDAP object and type are required.');
    data = options.data;
    kind = options.kind;
    sourceUrl = options.sourceUrl;
    rawResponse = String(options.raw ?? JSON.stringify(data, null, 2));
    dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    host = document.createElement('div');
    host.id = 'rdap-human-viewer-host';
    container.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = stylesheetUrl;
    shadow.appendChild(style);
    screen = el('div', 'app');
    screen.dataset.theme = dark ? 'dark' : 'light';
    shadow.appendChild(screen);
    machinePane = renderMachine(rawResponse);
    machinePane.dataset.theme = dark ? 'dark' : 'light';
    machinePane.hidden = true;
    shadow.appendChild(machinePane);
    let human = true;
    toggle = el('button', 'toolbar-button mode-toggle', 'MACHINE');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Switch to original machine JSON');
    toggle.addEventListener('click', () => setMachineMode(human));

    function setMachineMode(machine) {
      human = !machine;
      screen.hidden = machine;
      machinePane.hidden = !machine;
      toggle.textContent = machine ? 'HUMAN' : 'MACHINE';
      toggle.setAttribute('aria-label', machine ? 'Switch to human-readable RDAP view' : 'Switch to original machine JSON');
      if (machine) shadow.appendChild(toggle);
      else filterControls.appendChild(toggle);
      host.classList.toggle('machine', machine);
      onModeChange(machine);
    }
    render();
    return { host, setMachineMode, destroy() { host.remove(); } };
  }

  function tokenizeJSON(source) {
    const text = String(source);
    const tokens = [];
    const addToken = (type, start, end) => tokens.push({ type, value: text.slice(start, end) });
    const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    const isSpace = c => c === ' ' || c === '\t' || c === '\r' || c === '\n';
    const isBoundary = c => c === undefined || isSpace(c) || c === ',' || c === '}' || c === ']' || c === ':';
    let i = 0;
    while (i < text.length) {
      const start = i;
      const c = text[i];
      if (isSpace(c)) {
        while (i < text.length && isSpace(text[i])) i++;
        addToken('whitespace', start, i);
      } else if (c === '"') {
        i++;
        while (i < text.length) {
          if (text[i] === '\\') { i = Math.min(i + 2, text.length); continue; }
          if (text[i++] === '"') break;
        }
        let lookahead = i;
        while (lookahead < text.length && isSpace(text[lookahead])) lookahead++;
        addToken(text[lookahead] === ':' ? 'key' : 'string', start, i);
      } else if (c === '-' || (c >= '0' && c <= '9')) {
        numberPattern.lastIndex = i;
        const match = numberPattern.exec(text);
        if (match && isBoundary(text[i + match[0].length])) {
          i += match[0].length;
          addToken('number', start, i);
        } else {
          i++;
          addToken('punctuation', start, i);
        }
      } else {
        let literal = null;
        if (text.startsWith('true', i) && isBoundary(text[i + 4])) literal = 'true';
        else if (text.startsWith('false', i) && isBoundary(text[i + 5])) literal = 'false';
        else if (text.startsWith('null', i) && isBoundary(text[i + 4])) literal = 'null';
        if (literal) {
          i += literal.length;
          addToken(literal === 'null' ? 'null' : 'boolean', start, i);
        } else {
          i++;
          addToken('punctuation', start, i);
        }
      }
    }
    return tokens;
  }

  function renderMachine(raw) {
    const panel = el('section', 'machine-view');
    const toolbar = add(panel, el('div', 'machine-toolbar'));
    add(toolbar, el('span', 'machine-title', 'Original JSON'));
    const copy = add(toolbar, el('button', 'toolbar-button copy-raw', 'Copy raw JSON'));
    copy.type = 'button';
    copy.setAttribute('aria-label', 'Copy exact raw JSON response');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(raw); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy unavailable'; }
    });
    const pre = add(panel, el('pre', 'machine-json'));
    const code = add(pre, el('code'));
    for (const token of tokenizeJSON(raw)) {
      if (token.type === 'whitespace') code.appendChild(document.createTextNode(token.value));
      else {
        const part = el('span', 'json-' + token.type);
        part.textContent = token.value;
        code.appendChild(part);
      }
    }
    return panel;
  }

  function el(tag, cls, text) {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text !== undefined) x.textContent = String(text);
    return x;
  }
  function add(parent, child) { parent.appendChild(child); return child; }
  function info(key) {
    const def = R.fields[key];
    if (!def) return null;
    const a = el('a', 'info', 'i');
    a.href = def.reference;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.title = `${def.description} Open standards reference`;
    a.setAttribute('aria-label', `${key}: ${def.description} (standards reference)`);
    return a;
  }
  function fieldLabel(key) {
    const l = el('span', 'field-label', R.formatLabel(key));
    const i = info(key); if (i) l.append(' ', i);
    return l;
  }
  function value(parent, data, depth = 0, limit = { count: 0 }) {
    if (++limit.count > MAX_NODES) { add(parent, el('span', 'muted', 'Large response: remaining values available in MACHINE mode.')); return; }
    if (data === null) { add(parent, el('span', 'muted', 'null')); return; }
    if (typeof data === 'string') {
      const aURL = R.safeURL(data);
      if (aURL && data.length < 2048) {
        const a = el('a', 'value-link', data); a.href = aURL; a.target = '_blank'; a.rel = 'noopener noreferrer'; add(parent, a);
      } else add(parent, el('span', 'value-text', data));
      return;
    }
    if (typeof data !== 'object') { add(parent, el('span', 'value-text', String(data))); return; }
    if (depth >= 12) { add(parent, el('span', 'muted', 'Deep object: inspect MACHINE mode.')); return; }
    if (Array.isArray(data)) {
      if (!data.length) { add(parent, el('span', 'muted', 'Empty')); return; }
      if (data.every(x => x === null || ['string', 'number', 'boolean'].includes(typeof x)) && data.length < 15) {
        const list = add(parent, el('div', 'chips'));
        data.forEach(x => add(list, el('span', 'chip', String(x))));
        return;
      }
      const list = add(parent, el('div', 'nested-list'));
      data.slice(0, 150).forEach((item, index) => {
        const wrapper = add(list, el('div', 'list-row'));
        if (R.isObject(item) || Array.isArray(item)) {
          const d = add(wrapper, el('details', 'nested-detail'));
          if (depth < 2 || index < 3) d.open = true;
          const title = item?.objectClassName || item?.title || item?.handle || item?.ldhName || item?.eventAction || `Item ${index + 1}`;
          add(d, el('summary', '', String(title)));
          value(d, item, depth + 1, limit);
        } else value(wrapper, item, depth + 1, limit);
      });
      if (data.length > 150) add(list, el('p', 'muted', `Showing 150 of ${data.length} entries. All entries remain available in MACHINE mode.`));
      return;
    }
    const grid = add(parent, el('dl', 'detail-grid'));
    for (const [key, item] of Object.entries(data)) {
      const dt = add(grid, el('dt')); add(dt, fieldLabel(key));
      const dd = add(grid, el('dd'));
      if (key === 'vcardArray') renderVcard(dd, item, depth, limit);
      else value(dd, item, depth + 1, limit);
    }
  }
  function renderVcard(parent, card, depth, limit) {
    const props = R.contactFields(card);
    if (!props.length) { value(parent, card, depth + 1, limit); return; }
    const dl = add(parent, el('dl', 'detail-grid'));
    for (const p of props) {
      const dt = add(dl, el('dt')); add(dt, fieldLabel(p.key));
      const dd = add(dl, el('dd')); value(dd, p.value, depth + 1, limit);
      if (Object.keys(p.params).length) { const label = add(dd, el('small', 'muted', ' · ' + JSON.stringify(p.params))); label.title = 'jCard parameters'; }
    }
  }
  function section(root, title, content, open = true) {
    const container = add(root, el('details', 'section'));
    container.open = open;
    add(container, el('summary', 'section-title', title));
    const body = add(container, el('div', 'section-body'));
    content(body);
    return container;
  }
  function render() {
    const wrap = add(screen, el('main', 'container'));
    const filterBar = add(wrap, el('div', 'filter-bar'));
    const filterInput = add(filterBar, el('input', 'filter-input'));
    filterInput.type = 'search';
    filterInput.placeholder = 'Filter keys or values…';
    filterInput.setAttribute('aria-label', 'Filter RDAP keys or values');
    filterInput.autocomplete = 'off';
    const count = add(filterBar, el('span', 'filter-count'));
    const clear = add(filterBar, el('button', 'filter-clear', 'Clear'));
    clear.type = 'button'; clear.hidden = true;
    filterControls = add(filterBar, el('div', 'filter-controls'));
    const themeToggle = add(filterControls, el('button', 'toolbar-button theme-toggle'));
    themeToggle.type = 'button';
    function syncThemeButton() {
      themeToggle.textContent = dark ? '☀ Light' : '☾ Dark';
      themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      themeToggle.setAttribute('aria-pressed', String(dark));
    }
    syncThemeButton();
    themeToggle.addEventListener('click', () => {
      dark = !dark;
      screen.dataset.theme = dark ? 'dark' : 'light';
      machinePane.dataset.theme = dark ? 'dark' : 'light';
      syncThemeButton();
    });
    add(filterControls, toggle);
    const content = add(wrap, el('div'));
    let timer;
    const update = () => {
      const query = filterInput.value.trim();
      clear.hidden = !query;
      content.replaceChildren();
      renderContent(content, query);
      count.textContent = query ? (content.querySelectorAll('.section').length + content.querySelectorAll('.summary-card').length) + ' result groups' : '';
    };
    filterInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 100); });
    clear.addEventListener('click', () => { clearTimeout(timer); filterInput.value = ''; update(); filterInput.focus(); });
    update();
  }
  function renderContent(wrap, query) {
    const viewData = query ? R.filterTree(data, query) : data;
    const filtering = !!query;
    const eyebrow = add(wrap, el('div', 'eyebrow'));
    eyebrow.append(el('span', 'dot'), document.createTextNode('RDAP · ' + R.formatLabel(kind.type)));
    const title = add(wrap, el('h1', '', R.headline(data, kind)));
    title.title = title.textContent;
    const displayUrl = sourceUrl || location.href;
    const lead = add(wrap, el('p', 'subtitle', new URL(displayUrl).hostname + ' · ' + (kind.conformant ? 'rdap_level_0 advertised' : 'RDAP-shaped response')));
    lead.title = displayUrl;
    const summary = R.summary(viewData, kind);
    if (summary.length) {
      const cards = add(wrap, el('div', 'summary-grid'));
      summary.forEach(({ key, value: v }) => {
        const card = add(cards, el('div', 'summary-card'));
        add(card, fieldLabel(key));
        const result = add(card, el('div', 'summary-value'));
        if (Array.isArray(v) && v.length > 5) add(result, el('span', '', `${v.length} records`));
        else if (R.isObject(v)) value(result, v);
        else value(result, v);
      });
    }
    const groups = [
      ['Contacts & entities', ['entities', 'vcardArray', 'roles']],
      ['Network & registration', ['networks', 'autnums', 'nameservers', 'ipAddresses', 'secureDNS', 'publicIds']],
      ['Events & history', ['events', 'asEventActor']],
      ['Notices & remarks', ['notices', 'remarks']],
      ['Related links', ['links']],
      ['Search results', ['domainSearchResults', 'nameserverSearchResults', 'entitySearchResults']],
      ['RDAP metadata', ['rdapConformance', 'port43', 'lang']]
    ];
    const covered = new Set(summary.map(x => x.key));
    if (!filtering) covered.add('objectClassName');
    if (!filtering && viewData.name === title.textContent) covered.add('name');
    const used = new Set();
    for (const [title, keys] of groups) {
      const present = keys.filter(k => Object.hasOwn(viewData, k));
      if (!present.length) continue;
      present.forEach(k => used.add(k));
      section(wrap, title, body => {
        const dl = add(body, el('dl', 'detail-grid'));
        present.forEach(key => { const dt = add(dl, el('dt')); add(dt, fieldLabel(key)); const dd = add(dl, el('dd')); if (key === 'vcardArray') renderVcard(dd, viewData[key], 0, { count: 0 }); else value(dd, viewData[key]); });
      }, title === 'Contacts & entities' || title === 'Events & history' || title === 'Search results');
    }
    const extras = Object.keys(viewData).filter(k => !covered.has(k) && !used.has(k));
    if (extras.length) section(wrap, 'Additional fields', body => {
      const dl = add(body, el('dl', 'detail-grid'));
      extras.forEach(key => { const dt = add(dl, el('dt')); add(dt, fieldLabel(key)); const dd = add(dl, el('dd')); value(dd, viewData[key]); });
    }, true);
    if (filtering && !summary.length && !wrap.querySelector('.section')) add(wrap, el('div', 'empty-state', 'No matching keys or values.'));
    const footer = add(wrap, el('footer'));
    const note = add(footer, el('span', '', 'Locally rendered · No analytics · No remote dependencies'));
    const links = add(footer, el('div', 'footer-links'));
    const standards = add(links, el('a', '', 'RDAP specification'));
    standards.href = 'https://www.rfc-editor.org/rfc/rfc9083.html'; standards.target = '_blank'; standards.rel = 'noopener noreferrer';
    if (KOFI_URL && R.safeURL(KOFI_URL)) {
      const donate = add(links, el('a', '', 'Support on Ko-fi'));
      donate.href = R.safeURL(KOFI_URL); donate.target = '_blank'; donate.rel = 'noopener noreferrer';
    }
    const copy = add(links, el('button', 'copy-url', 'Copy URL'));
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy unavailable'; }
    });
  }

  return Object.freeze({ mount, tokenizeJSON });
});

(function (root, factory) {
  const rdap = root.RDAPHuman || (typeof module === 'object' && module.exports ? require('./rdap.js') : null);
  const api = factory(rdap);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (R) {
  'use strict';
  const ATTRIBUTION = 'Registration data is provided by the respective RDAP registries. RDAP Human Viewer is an independent project and is not affiliated with those registries.';
  const SOURCE_URL = 'https://github.com/realvorl/rdap-human-viewer';
  const ISSUES_URL = SOURCE_URL + '/issues';
  const KOFI_URL = 'https://ko-fi.com/realvorl';
  const MAX_NODES = 7000;
  let screen, machinePane, humanContent, recordHeader, filterControls, data, kind, sourceUrl, rawResponse, formattedJSON, host, shadow, toggle, expandControls;

  function mount(options) {
    const { container = document.body, stylesheetUrl, onModeChange = () => {}, onPreferencesChange = () => {} } = options;
    if (!R) throw new Error('RDAP core is not loaded.');
    if (!R.isObject(options.data) || !options.kind) throw new TypeError('A recognized RDAP object and type are required.');
    data = options.data;
    kind = options.kind;
    sourceUrl = options.sourceUrl;
    const machine = machineOutput(data, options.raw);
    formattedJSON = machine.display;
    rawResponse = machine.clipboard;
    const restoreScrollbarGutter = reserveScrollbarGutter(document.documentElement);
    const restoreContainer = constrainContainer(container);
    const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    let currentPreferences = normalizePreferences(options.preferences, colorScheme?.matches ?? false);
    host = document.createElement('div');
    host.id = 'rdap-human-viewer-host';
    container.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = stylesheetUrl;
    shadow.appendChild(style);
    const themeStyle = document.createElement('link');
    themeStyle.rel = 'stylesheet';
    themeStyle.href = options.themeStylesheetUrl || String(stylesheetUrl).replace(/viewer\.css(?:[?#].*)?$/, 'theme.css');
    shadow.appendChild(themeStyle);
    screen = el('div', 'app');
    screen.dataset.theme = currentPreferences.dark ? 'dark' : 'light';
    shadow.appendChild(screen);
    machinePane = renderMachine(formattedJSON, rawResponse);
    machinePane.hidden = true;
    let human = !currentPreferences.machine;
    toggle = el('button', 'toolbar-button mode-toggle', human ? 'MACHINE' : 'HUMAN');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Switch to machine-readable JSON view');
    toggle.addEventListener('click', () => setMachineMode(human));

    function setMachineMode(machine) {
      const scrollTop = window.scrollY || 0;
      human = !machine;
      applyMode({ humanContent, recordHeader, machinePane, expandControls, filterControls }, machine);
      toggle.textContent = machine ? 'HUMAN' : 'MACHINE';
      toggle.setAttribute('aria-label', machine ? 'Switch to human-readable RDAP view' : 'Switch to machine-readable JSON view');
      window.scrollTo(0, scrollTop);
      onModeChange(machine);
      onPreferencesChange({ ...currentPreferences, machine });
    }
    const themeControl = render(options.newLookupHref, options.onOriginalResponse, currentPreferences, colorScheme, next => {
      currentPreferences = next;
      onPreferencesChange({ ...currentPreferences, machine: !human });
    });
    toggle.setAttribute('aria-label', human ? 'Switch to machine-readable JSON view' : 'Switch to human-readable RDAP view');
    if (!human) applyMode({ humanContent, recordHeader, machinePane, expandControls, filterControls }, true);
    renderRegistryAttribution(screen, sourceUrl);
    return { host, setMachineMode, destroy() { themeControl.destroy(); host.remove(); restoreContainer(); restoreScrollbarGutter(); } };
  }

  function normalizePreferences(preferences = {}, systemDark = false) {
    const theme = ['auto', 'light', 'dark'].includes(preferences.theme)
      ? preferences.theme
      : typeof preferences.dark === 'boolean' ? preferences.dark ? 'dark' : 'light' : 'auto';
    return { ...resolveTheme(theme, systemDark), machine: preferences.machine === true };
  }

  function resolveTheme(theme, systemDark = false) {
    const selected = ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto';
    return { theme: selected, dark: selected === 'dark' || (selected === 'auto' && Boolean(systemDark)) };
  }

  function createThemeSelector(select, target, preferences = {}, onChange = () => {}, colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)')) {
    let state = resolveTheme(preferences.theme, colorScheme?.matches ?? false);
    const apply = () => {
      select.value = state.theme;
      target.dataset.theme = state.dark ? 'dark' : 'light';
    };
    const set = theme => {
      state = resolveTheme(theme, colorScheme?.matches ?? false);
      apply();
      onChange({ ...state });
    };
    const onSelect = () => set(select.value);
    const onSystemThemeChange = event => {
      if (state.theme !== 'auto') return;
      state = resolveTheme('auto', event.matches);
      apply();
    };
    select.addEventListener('change', onSelect);
    if (colorScheme?.addEventListener) colorScheme.addEventListener('change', onSystemThemeChange);
    else colorScheme?.addListener?.(onSystemThemeChange);
    apply();
    return {
      get state() { return { ...state }; },
      set,
      destroy() {
        select.removeEventListener('change', onSelect);
        if (colorScheme?.removeEventListener) colorScheme.removeEventListener('change', onSystemThemeChange);
        else colorScheme?.removeListener?.(onSystemThemeChange);
      }
    };
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

  function machineOutput(data, raw) {
    const display = JSON.stringify(data, null, 2);
    return { display, clipboard: String(raw ?? display) };
  }

  function reserveScrollbarGutter(rootElement) {
    if (!rootElement?.style || !('scrollbarGutter' in rootElement.style)) return () => {};
    const previous = rootElement.style.scrollbarGutter;
    rootElement.style.scrollbarGutter = 'stable';
    return () => { rootElement.style.scrollbarGutter = previous; };
  }

  function constrainContainer(container) {
    if (!container?.style) return () => {};
    const properties = ['display', 'width', 'maxWidth', 'minWidth', 'boxSizing', 'margin', 'padding'];
    const previous = Object.fromEntries(properties.map(property => [property, container.style[property]]));
    Object.assign(container.style, {
      display: 'block',
      width: '100%',
      maxWidth: 'none',
      minWidth: '0',
      boxSizing: 'border-box',
      margin: '0',
      padding: '0'
    });
    return () => Object.assign(container.style, previous);
  }

  function setExpanded(details, expanded) {
    for (const item of details) item.open = Boolean(expanded);
  }

  function captureExpansion(details) {
    const state = new Map();
    const occurrences = new Map();
    Array.from(details).forEach(item => {
      const base = `${item.className}\u0000${item.querySelector('summary')?.textContent || ''}`;
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      state.set(`${base}\u0000${occurrence}`, Boolean(item.open));
    });
    return state;
  }

  function restoreExpansion(details, state) {
    if (!state) return;
    const occurrences = new Map();
    Array.from(details).forEach(item => {
      const base = `${item.className}\u0000${item.querySelector('summary')?.textContent || ''}`;
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      const key = `${base}\u0000${occurrence}`;
      if (state.has(key)) item.open = state.get(key);
    });
  }

  function applyFilterExpansion(details, filtering, previousState) {
    if (filtering) setExpanded(details, true);
    else if (previousState) restoreExpansion(details, previousState);
  }

  function applyMode(parts, machine) {
    parts.humanContent.hidden = machine;
    if (parts.recordHeader) parts.recordHeader.hidden = machine;
    parts.machinePane.hidden = !machine;
    parts.filterControls.hidden = machine;
    parts.expandControls.hidden = machine;
  }

  async function copyToClipboard(raw, clipboard = globalThis.navigator?.clipboard) {
    if (!clipboard?.writeText) return false;
    try { await clipboard.writeText(raw); return true; }
    catch { return false; }
  }

  function renderMachine(formatted, raw) {
    const panel = el('section', 'machine-view');
    const toolbar = add(panel, el('div', 'machine-title-row'));
    add(toolbar, el('span', 'machine-title', 'Formatted JSON'));
    const copy = add(toolbar, el('button', 'copy-raw'));
    copy.type = 'button';
    copy.title = 'Copy to Clipboard';
    copy.setAttribute('aria-label', 'Copy to Clipboard');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M9 8h10v12H9z M6 16H4V4h12v2');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linejoin', 'round');
    icon.appendChild(path); copy.appendChild(icon);
    copy.addEventListener('click', async () => {
      const copied = await copyToClipboard(raw);
      copy.dataset.feedback = copied ? 'success' : 'error';
      copy.setAttribute('aria-label', copied ? 'Copied to Clipboard' : 'Copy to Clipboard failed');
      copy.title = copied ? 'Copied to Clipboard' : 'Copy to Clipboard failed';
      setTimeout(() => { copy.dataset.feedback = ''; copy.setAttribute('aria-label', 'Copy to Clipboard'); copy.title = 'Copy to Clipboard'; }, 1600);
    });
    const pre = add(panel, el('pre', 'machine-json'));
    const code = add(pre, el('code'));
    for (const token of tokenizeJSON(formatted)) {
      if (token.type === 'whitespace') code.appendChild(document.createTextNode(token.value));
      else {
        const part = el('span', 'json-' + token.type);
        part.textContent = token.value;
        code.appendChild(part);
      }
    }
    return panel;
  }

  function renderRegistryAttribution(parent, endpoint) {
    const footer = add(parent, el('footer', 'registry-attribution'));
    add(footer, el('p', 'registry-disclaimer', ATTRIBUTION));
    const links = add(footer, el('div', 'registry-links'));
    if (typeof endpoint === 'string') {
      try {
        const url = new URL(endpoint);
        if (url.protocol === 'https:') {
          const link = add(links, el('a', 'source-endpoint', 'Source RDAP endpoint'));
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.title = url.href;
        }
      } catch { /* Omit an invalid source URL. */ }
    }
    for (const [label, href] of [['GitHub', SOURCE_URL], ['Issues & support', ISSUES_URL], ['Ko-fi', KOFI_URL]]) {
      const link = add(links, el('a', '', label));
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
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
    const decoded = R.contactFields(card);
    if (!decoded.length) { value(parent, card, depth + 1, limit); return; }
    const props = decoded.filter(p => p.key !== 'version' && p.value.trim());
    if (!props.length) { add(parent, el('span', 'muted', 'No contact details provided.')); return; }
    const dl = add(parent, el('dl', 'detail-grid'));
    for (const p of props) {
      const dt = add(dl, el('dt'));
      const label = add(dt, el('span', 'field-label', p.label));
      const explanation = info(p.key); if (explanation) label.append(' ', explanation);
      const dd = add(dl, el('dd'));
      if (p.key === 'adr') add(dd, el('span', 'value-text postal-address', p.value));
      else value(dd, p.value, depth + 1, limit);
      if (p.preference !== null) {
        const preference = add(dd, el('small', 'contact-annotation', ' · ' + p.preferenceLabel));
        preference.title = p.preferenceTitle;
      }
      p.metadata.forEach(item => add(dd, el('small', 'contact-annotation', ' · ' + item)));
      if (p.technicalParams.length) {
        const technical = add(dd, el('details', 'contact-technical'));
        add(technical, el('summary', '', 'Technical details'));
        const parameters = add(technical, el('dl', 'technical-parameters'));
        p.technicalParams.forEach(([key, raw]) => {
          add(parameters, el('dt', '', R.formatLabel(key)));
          add(parameters, el('dd', '', JSON.stringify(raw)));
        });
      }
    }
  }
  function renderEntityList(parent, entities) {
    const list = add(parent, el('div', 'entity-list'));
    entities.forEach(entity => {
      const card = add(list, el('details', 'entity-card'));
      const heading = add(card, el('summary', 'entity-heading', R.entityHeading(entity)));
      heading.title = R.entityHeading(entity);
      renderObjectFields(card, entity, new Set());
    });
  }
  function renderObjectFields(parent, object, omit) {
    const fields = Object.entries(object || {}).filter(([key]) => !omit.has(key));
    if (!fields.length) return;
    const dl = add(parent, el('dl', 'detail-grid compact-grid'));
    fields.forEach(([key, item]) => {
      const dt = add(dl, el('dt')); add(dt, fieldLabel(key));
      const dd = add(dl, el('dd'));
      if (key === 'vcardArray') renderVcard(dd, item, 0, { count: 0 });
      else if (key === 'entities' && Array.isArray(item)) renderEntityList(dd, item);
      else if (key === 'events' && Array.isArray(item)) renderEvents(dd, item);
      else if (key === 'links' && Array.isArray(item)) renderLinks(dd, item);
      else if ((key === 'remarks' || key === 'description') && Array.isArray(item)) renderTextBlocks(dd, item);
      else value(dd, item);
    });
  }
  function renderEvents(parent, events) {
    const list = add(parent, el('div', 'event-list'));
    events.forEach(event => {
      const row = add(list, el('div', 'event-row'));
      add(row, el('span', 'event-summary', R.eventLabel(event)));
      const extras = Object.keys(event || {}).filter(key => key !== 'eventAction' && key !== 'eventDate');
      if (extras.length) {
        const details = add(row, el('details', 'event-extra'));
        add(details, el('summary', '', 'Details'));
        renderObjectFields(details, event, new Set(['eventAction', 'eventDate']));
      }
    });
  }
  function renderLinks(parent, links) {
    const list = add(parent, el('div', 'link-list'));
    links.forEach(link => {
      const row = add(list, el('div', 'link-row'));
      const href = R.safeURL(link?.href || link?.value);
      if (href) { const a = add(row, el('a', 'value-link', href)); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      else add(row, el('span', 'value-text', link?.title || 'Link'));
      if (link?.title && link.title !== href) add(row, el('span', 'link-rel', link.title));
      if (link?.rel) add(row, el('span', 'link-rel', R.formatLabel(link.rel)));
      const extras = Object.keys(link || {}).filter(key => !['href', 'value', 'title', 'rel'].includes(key));
      if (extras.length || link?.value && link.value !== link.href) {
        const details = add(row, el('details', 'link-extra'));
        add(details, el('summary', '', 'Link fields'));
        renderObjectFields(details, link, new Set(['title', 'rel']));
      }
    });
  }
  function renderTextBlocks(parent, blocks) {
    const list = add(parent, el('div', 'text-block-list'));
    blocks.forEach(block => {
      if (typeof block === 'string') add(list, el('p', 'text-block', block));
      else if (R.isObject(block)) {
        const title = block.title;
        if (title) add(list, el('strong', 'text-block-title', title));
        const descriptions = Array.isArray(block.description) ? block.description : [block.description];
        descriptions.filter(x => typeof x === 'string').forEach(text => add(list, el('p', 'text-block', text)));
        const extras = Object.keys(block).filter(key => key !== 'title' && key !== 'description');
        if (extras.length) {
          const details = add(list, el('details', 'text-extra'));
          add(details, el('summary', '', 'Additional fields'));
          renderObjectFields(details, block, new Set(['title', 'description']));
        }
      } else value(list, block);
    });
  }
  function section(root, title, content, open = true) {
    const container = add(root, el('details', 'section'));
    container.open = open;
    add(container, el('summary', 'section-title', title));
    const body = add(container, el('div', 'section-body'));
    content(body);
    return container;
  }
  function render(newLookupHref, onOriginalResponse, preferences, colorScheme, onThemeChange) {
    const wrap = add(screen, el('main', 'container'));
    const toolbar = add(wrap, el('div', 'human-toolbar'));
    if (typeof newLookupHref === 'string' && newLookupHref) {
      try {
        const home = new URL(newLookupHref, location.href);
        if (home.origin === location.origin) {
          home.searchParams.delete('url');
          home.hash = '';
          const link = add(toolbar, el('a', 'toolbar-home', '← New lookup'));
          link.href = home.pathname + home.search;
          link.setAttribute('aria-label', 'Start a new RDAP lookup');
        }
      } catch {}
    }
    if (typeof onOriginalResponse === 'function') {
      const original = add(toolbar, el('button', 'toolbar-button original-response', '← Original response'));
      original.type = 'button';
      original.setAttribute('aria-label', 'Return to the original RDAP response');
      original.addEventListener('click', onOriginalResponse);
    }
    filterControls = add(toolbar, el('div', 'toolbar-filter'));
    const filterInput = add(filterControls, el('input', 'filter-input'));
    filterInput.type = 'search';
    filterInput.placeholder = 'Filter keys or values…';
    filterInput.setAttribute('aria-label', 'Filter RDAP keys or values');
    filterInput.autocomplete = 'off';
    const clear = add(filterControls, el('button', 'filter-clear', 'Clear'));
    clear.type = 'button'; clear.hidden = true;
    const count = add(filterControls, el('span', 'filter-count'));
    expandControls = add(toolbar, el('div', 'expand-controls'));
    const expand = add(expandControls, el('button', 'toolbar-button expand-all', '+ Expand all'));
    expand.type = 'button'; expand.setAttribute('aria-label', 'Expand all HUMAN sections and details');
    const collapse = add(expandControls, el('button', 'toolbar-button collapse-all', '− Collapse all'));
    collapse.type = 'button'; collapse.setAttribute('aria-label', 'Collapse all HUMAN sections and details');
    const actions = add(toolbar, el('div', 'toolbar-actions'));
    const themeToggle = add(actions, el('select', 'toolbar-button theme-select'));
    themeToggle.setAttribute('aria-label', 'Color theme');
    for (const [value, label] of [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]) {
      const option = add(themeToggle, el('option', '', label));
      option.value = value;
    }
    add(actions, toggle);
    recordHeader = add(wrap, el('header', 'record-header'));
    renderHeader(recordHeader);
    humanContent = add(wrap, el('div', 'human-content'));
    add(wrap, machinePane);
    let priorExpansion = null;
    expand.addEventListener('click', () => setExpanded(humanContent.querySelectorAll('details'), true));
    collapse.addEventListener('click', () => setExpanded(humanContent.querySelectorAll('details'), false));
    let timer;
    const update = () => {
      const query = filterInput.value.trim();
      clear.hidden = !query;
      if (query && priorExpansion === null) priorExpansion = captureExpansion(humanContent.querySelectorAll('details'));
      humanContent.replaceChildren();
      renderContent(humanContent, query);
      const details = humanContent.querySelectorAll('details');
      applyFilterExpansion(details, !!query, query ? null : priorExpansion);
      if (!query) priorExpansion = null;
      count.textContent = query ? (humanContent.querySelectorAll('.section').length + humanContent.querySelectorAll('.summary-card').length) + ' result groups' : '';
    };
    filterInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 100); });
    clear.addEventListener('click', () => { clearTimeout(timer); filterInput.value = ''; update(); filterInput.focus(); });
    update();
    return createThemeSelector(themeToggle, screen, preferences, onThemeChange, colorScheme);
  }
  function renderHeader(wrap) {
    const eyebrow = add(wrap, el('div', 'eyebrow'));
    eyebrow.append(el('span', 'dot'), document.createTextNode('RDAP · ' + R.formatLabel(kind.type)));
    const title = add(wrap, el('h1', '', R.headline(data, kind)));
    title.title = title.textContent;
    const displayUrl = sourceUrl || location.href;
    const lead = add(wrap, el('p', 'subtitle', new URL(displayUrl).hostname + ' · ' + (kind.conformant ? 'rdap_level_0 advertised' : 'RDAP-shaped response')));
    lead.title = displayUrl;
    const summary = R.summary(data, kind);
    if (summary.length) {
      const cards = add(wrap, el('div', 'summary-grid'));
      summary.forEach(({ key, value: v }) => {
        const card = add(cards, el('div', 'summary-card'));
        add(card, fieldLabel(key));
        const result = add(card, el('div', 'summary-value'));
        value(result, v);
      });
    }
  }
  function renderContent(wrap, query) {
    const viewData = query ? R.filterTree(data, query) : data;
    const filtering = !!query;
    const summary = R.summary(viewData, kind);
    const heading = R.headline(data, kind);
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
    if (!filtering && viewData.name === heading) covered.add('name');
    const used = new Set();
    for (const [title, keys] of groups) {
      const present = keys.filter(k => Object.hasOwn(viewData, k));
      if (!present.length) continue;
      present.forEach(k => used.add(k));
      section(wrap, title, body => {
        const dl = add(body, el('dl', 'detail-grid'));
        present.forEach(key => {
          const dt = add(dl, el('dt')); add(dt, fieldLabel(key)); const dd = add(dl, el('dd'));
          const item = viewData[key];
          if (key === 'vcardArray') renderVcard(dd, item, 0, { count: 0 });
          else if (key === 'entities' && Array.isArray(item)) renderEntityList(dd, item);
          else if ((key === 'events' || key === 'asEventActor') && Array.isArray(item)) renderEvents(dd, item);
          else if (key === 'links' && Array.isArray(item)) renderLinks(dd, item);
          else if (key === 'remarks' && Array.isArray(item)) renderTextBlocks(dd, item);
          else value(dd, item);
        });
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
    const copy = add(links, el('button', 'copy-url', 'Copy URL'));
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy unavailable'; }
    });
  }

  return Object.freeze({ mount, tokenizeJSON, machineOutput, reserveScrollbarGutter, constrainContainer, setExpanded, captureExpansion, restoreExpansion, applyFilterExpansion, applyMode, copyToClipboard, normalizePreferences, resolveTheme, createThemeSelector });
});

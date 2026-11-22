/* RDAP, but for Humans — dependency-free parsing and field metadata. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPHuman = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RFC = 'https://www.rfc-editor.org/rfc/rfc9083.html';
  const section = (n) => RFC + '#section-' + n;
  const info = (description, reference) => ({ description, reference: reference || RFC });
  const fields = {
    rdapConformance: info('RDAP feature and extension identifiers advertised by the server.', section('2.1')),
    objectClassName: info('The RDAP object type. Determines which fields can be expected.', section('3')),
    handle: info('Registry-assigned identifier for this registration object.', section('3')),
    name: info('Name or label assigned to the registration object.', section('5.4')),
    type: info('Registry-specific classification of this registration.', section('5.4')),
    startAddress: info('First IP address in the registered address range.', section('5.4')),
    endAddress: info('Last IP address in the registered address range.', section('5.4')),
    ipVersion: info('IP protocol family: v4 or v6.', section('5.4')),
    country: info('Two-letter country code associated with the registration; not necessarily geolocation.', section('5.4')),
    parentHandle: info('Registry identifier for the parent IP network registration.', section('5.4')),
    startAutnum: info('First autonomous system number in this registration.', section('5.5')),
    endAutnum: info('Last autonomous system number in this registration.', section('5.5')),
    ldhName: info('DNS name in the letters-digits-hyphen form; internationalized names may be punycode.', section('5.3')),
    unicodeName: info('Human-readable Unicode form of an internationalized DNS name.', section('5.3')),
    nameservers: info('Nameserver objects associated with the domain.', section('5.3')),
    secureDNS: info('DNSSEC delegation information, including DS or key data where supplied.', section('5.3')),
    ipAddresses: info('IPv4 and IPv6 addresses of this nameserver.', section('5.2')),
    entities: info('People or organizations associated with an RDAP object; inspect their roles.', section('5.1')),
    roles: info('Relationship of an entity to the object, such as registrant, administrative or technical.', section('5.1')),
    vcardArray: info('Contact information in jCard form (JSON representation of vCard).', 'https://www.rfc-editor.org/rfc/rfc7095.html'),
    publicIds: info('Identifiers from named public identifier systems.', section('4.8')),
    events: info('Dated operations or lifecycle events recorded for this object.', section('4.5')),
    asEventActor: info('Entity identified as the actor for an event.', section('4.5')),
    eventAction: info('Kind of event (for example registration, expiration or last changed).', section('4.5')),
    eventDate: info('Timestamp of an event, commonly expressed in RFC 3339 format.', section('4.5')),
    status: info('Standardized registration status values. Exact meanings depend on the registered status.', section('4.6')),
    notices: info('Service-wide notices or terms supplied with this response.', section('4.3')),
    remarks: info('Additional descriptive information about this particular object.', section('4.3')),
    title: info('Short display title for a notice or remark.', section('4.3')),
    description: info('Textual content of a notice or remark.', section('4.3')),
    links: info('Related URIs annotated with link relation types.', section('4.2')),
    href: info('Target URI for this link.', section('4.2')),
    rel: info('Relationship between this object and the linked resource.', section('4.2')),
    value: info('Source/context URI of a link.', section('4.2')),
    hreflang: info('Language tags for a linked resource.', section('4.2')),
    media: info('Intended media for this link.', section('4.2')),
    port43: info('Legacy WHOIS service hostname; not an RDAP endpoint.', section('4.7')),
    errorCode: info('Numeric HTTP-equivalent error code returned by the RDAP service.', section('6')),
    lang: info('Language identifier used for textual content.', section('3')),
    domainSearchResults: info('Array of matching domain objects from an RDAP search.', section('8')),
    nameserverSearchResults: info('Array of matching nameserver objects from an RDAP search.', section('8')),
    entitySearchResults: info('Array of matching entity objects from an RDAP search.', section('8')),
    networks: info('Network registrations linked to this entity.', section('5.1')),
    autnums: info('Autonomous system registrations linked to this entity.', section('5.1')),
    fn: info('Full formatted name of a person or organization in a jCard.', 'https://www.rfc-editor.org/rfc/rfc6350.html#section-6.2.1'),
    org: info('Organization name in a jCard.', 'https://www.rfc-editor.org/rfc/rfc6350.html#section-6.6.4'),
    email: info('Email contact in a jCard.', 'https://www.rfc-editor.org/rfc/rfc6350.html#section-6.4.2'),
    tel: info('Telephone contact in a jCard.', 'https://www.rfc-editor.org/rfc/rfc6350.html#section-6.4.1'),
    adr: info('Structured postal address in a jCard.', 'https://www.rfc-editor.org/rfc/rfc6350.html#section-6.3.1')
  };
  const types = new Set(['ip network', 'autnum', 'domain', 'entity', 'nameserver']);
  const searchTypes = ['domainSearchResults', 'nameserverSearchResults', 'entitySearchResults'];
  const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  function detect(data) {
    if (!isObject(data)) return null;
    if (types.has(data.objectClassName)) return { type: data.objectClassName, conformant: Array.isArray(data.rdapConformance) && data.rdapConformance.includes('rdap_level_0') };
    const search = searchTypes.find(k => Array.isArray(data[k]));
    if (search && (Array.isArray(data.rdapConformance) || data[search].some(x => isObject(x) && types.has(x.objectClassName))))
      return { type: 'search', search, conformant: Array.isArray(data.rdapConformance) && data.rdapConformance.includes('rdap_level_0') };
    if (Number.isInteger(data.errorCode) && (Array.isArray(data.rdapConformance) || Array.isArray(data.notices) || typeof data.title === 'string'))
      return { type: 'error', conformant: Array.isArray(data.rdapConformance) && data.rdapConformance.includes('rdap_level_0') };
    return null;
  }
  function looksLikeRdapUrl(href) {
    try {
      const u = new URL(href);
      if (!['http:', 'https:'].includes(u.protocol)) return false;
      return /(^|[.-])rdap([.-]|$)/i.test(u.hostname) || /\/(?:rdap|registry)\//i.test(u.pathname) || /^\/(?:ip|autnum|domain|entity|nameserver|domains|entities|nameservers)(?:\/|$)/i.test(u.pathname);
    } catch { return false; }
  }
  function safeURL(value) {
    if (typeof value !== 'string') return null;
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; }
    catch { return null; }
  }
  function formatLabel(value) {
    return String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, x => x.toUpperCase());
  }
  const parameterLabels = Object.freeze({
    abuse: 'Abuse', administrative: 'Administrative', billing: 'Billing', emergency: 'Emergency', home: 'Home',
    legal: 'Legal', noc: 'Network operations', notification: 'Notification', personal: 'Personal', registrant: 'Registrant',
    registration: 'Registration', reseller: 'Reseller', security: 'Security', sponsor: 'Sponsor', support: 'Support',
    technical: 'Technical', work: 'Work'
  });
  const phoneTypes = Object.freeze({ voice: 'Phone', fax: 'Fax', cell: 'Mobile phone', video: 'Video phone', pager: 'Pager', text: 'Text phone', textphone: 'Text phone' });
  function getParameter(params, name) {
    const entry = Object.entries(params).find(([key]) => key.toLowerCase() === name);
    return entry?.[1];
  }
  function parameterValues(value) {
    return (Array.isArray(value) ? value.flat(Infinity) : [value])
      .filter(item => ['string', 'number', 'boolean'].includes(typeof item) && String(item).trim() !== '')
      .map(item => String(item).trim());
  }
  function hasParameterValue(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(hasParameterValue);
    if (isObject(value)) return Object.values(value).some(hasParameterValue);
    return String(value).trim() !== '';
  }
  function contactPresentation(field) {
    const key = String(field?.key || '').toLowerCase();
    const params = isObject(field?.params) ? field.params : {};
    const types = parameterValues(getParameter(params, 'type')).map(type => type.toLowerCase());
    const typeLabels = types.map(type => parameterLabels[type] || formatLabel(type));
    let label = formatLabel(key);
    if (key === 'fn') label = 'Name';
    else if (key === 'org') label = 'Organization';
    else if (key === 'email') label = `${typeLabels.join(' ')}${typeLabels.length ? ' ' : ''}Email`;
    else if (key === 'tel') {
      const phoneType = types.map(type => phoneTypes[type]).find(Boolean) || 'Phone';
      const qualifiers = types.filter(type => !Object.hasOwn(phoneTypes, type)).map(type => parameterLabels[type] || formatLabel(type));
      label = `${qualifiers.join(' ')}${qualifiers.length ? ' ' : ''}${phoneType}`;
    } else if (key === 'adr') label = `${typeLabels.join(' ')}${typeLabels.length ? ' ' : ''}Address`;
    else if (key === 'title') label = 'Job title';
    else if (key === 'role') label = 'Role';
    else if (key === 'kind') label = 'Contact type';
    else if (key === 'url') label = 'Website';

    const rawPreference = parameterValues(getParameter(params, 'pref'))[0];
    const preferenceNumber = rawPreference !== undefined && /^\d+$/.test(rawPreference) ? Number(rawPreference) : null;
    const preference = Number.isInteger(preferenceNumber) && preferenceNumber >= 1 && preferenceNumber <= 100 ? preferenceNumber : null;
    const metadata = [];
    for (const [name, caption] of [['language', 'Language'], ['mediatype', 'Media type'], ['geo', 'Location'], ['tz', 'Time zone']]) {
      const values = parameterValues(getParameter(params, name));
      values.forEach(value => metadata.push(`${caption}: ${value}`));
    }
    const technicalParams = Object.entries(params).filter(([name, value]) => {
      const normalized = name.toLowerCase();
      const interpreted = normalized === 'type' && ['email', 'tel', 'adr'].includes(key) && parameterValues(value).length > 0
        || normalized === 'label' && key === 'adr' && parameterValues(value).length > 0
        || normalized === 'pref' && preference !== null
        || ['language', 'mediatype', 'geo', 'tz'].includes(normalized) && parameterValues(value).length > 0;
      return !interpreted && hasParameterValue(value);
    });
    return {
      label,
      preference,
      preferenceLabel: preference === null ? '' : preference === 1 ? 'Preferred · 1' : `Preference ${preference}`,
      preferenceTitle: preference === null ? '' : `Preference ${preference}; lower numbers indicate higher preference.`,
      metadata,
      technicalParams,
      types
    };
  }
  function contactFields(vcardArray) {
    if (!Array.isArray(vcardArray) || vcardArray[0] !== 'vcard' || !Array.isArray(vcardArray[1])) return [];
    return vcardArray[1].filter(x => Array.isArray(x) && x.length >= 4 && typeof x[0] === 'string').map(x => {
      const params = isObject(x[1]) ? x[1] : {};
      let value;
      if (x[0] === 'adr') {
        const label = parameterValues(getParameter(params, 'label')).join('\n');
        value = label || parameterValues(x[3]).join('\n');
      } else value = Array.isArray(x[3]) ? parameterValues(x[3]).join(', ') : x[3] === null || x[3] === undefined ? '' : String(x[3]).trim();
      if (x[0] === 'tel') value = value.replace(/^tel:/i, '');
      return { key: x[0], value, sourceValue: x[3], params, ...contactPresentation({ key: x[0], params }) };
    });
  }
  function entityHeading(entity) {
    const name = contactFields(entity?.vcardArray).find(x => x.key === 'fn' || x.key === 'org')?.value || entity?.name || '';
    return [name, entity?.handle, ...(Array.isArray(entity?.roles) ? entity.roles : entity?.roles ? [entity.roles] : [])].filter(Boolean).join(' · ') || entity?.objectClassName || 'Entity';
  }
  function eventLabel(event) {
    return [event?.eventAction && formatLabel(event.eventAction), event?.eventDate].filter(Boolean).join(' · ') || 'Event';
  }
  function headline(data, detected) {
    switch (detected.type) {
      case 'ip network': return data.name || [data.startAddress, data.endAddress].filter(Boolean).join(' – ') || data.handle || 'IP network';
      case 'autnum': return data.name || (data.startAutnum != null ? 'AS' + data.startAutnum : data.handle || 'Autonomous system');
      case 'domain': case 'nameserver': return data.unicodeName || data.ldhName || data.handle || formatLabel(detected.type);
      case 'entity': return contactFields(data.vcardArray).find(x => x.key === 'fn' || x.key === 'org')?.value || data.handle || 'Entity';
      case 'search': return formatLabel(detected.search.replace('SearchResults', '')) + ' search results';
      case 'error': return data.title || 'RDAP error ' + data.errorCode;
      default: return 'RDAP response';
    }
  }
  function summary(data, detected) {
    const keysByType = {
      'ip network': ['handle', 'startAddress', 'endAddress', 'ipVersion', 'country', 'parentHandle', 'type', 'status'],
      autnum: ['handle', 'startAutnum', 'endAutnum', 'country', 'type', 'status'],
      domain: ['ldhName', 'unicodeName', 'handle', 'status'],
      nameserver: ['ldhName', 'unicodeName', 'handle', 'ipAddresses', 'status'],
      entity: ['handle', 'roles', 'status'],
      error: ['errorCode', 'title', 'description']
    };
    let keys = keysByType[detected.type] || (detected.type === 'search' ? [detected.search] : []);
    return keys.filter(k => data[k] != null).map(key => ({ key, value: data[key] }));
  }
  // Return only matching key/value branches, retaining their path for context.
  // Matching a key retains its entire value; matching nested values prunes siblings.
  function filterTree(input, search) {
    const needle = String(search ?? '').trim().toLocaleLowerCase();
    if (!needle) return input;
    const matches = v => String(v).toLocaleLowerCase().includes(needle);
    function visit(node, depth = 0) {
      if (depth > 32) return undefined;
      if (Array.isArray(node)) {
        // jCard is positional and must remain intact to be decoded correctly.
        if (node[0] === 'vcard' && Array.isArray(node[1])) {
          const props = contactFields(node);
          return props.some(p => matches(p.key) || matches(p.label) || matches(p.value) || matches(p.sourceValue) || matches(p.preferenceLabel) || p.metadata.some(matches) || matches(JSON.stringify(p.params))) ? node : undefined;
        }
        const kept = node.map(v => visit(v, depth + 1)).filter(v => v !== undefined);
        return kept.length ? kept : undefined;
      }
      if (isObject(node)) {
        const kept = {};
        for (const [key, value] of Object.entries(node)) {
          if (matches(key) || matches(formatLabel(key))) { kept[key] = value; continue; }
          const result = visit(value, depth + 1);
          if (result !== undefined) kept[key] = result;
        }
        return Object.keys(kept).length ? kept : undefined;
      }
      return matches(node === null ? 'null' : node) ? node : undefined;
    }
    return visit(input) || {};
  }
  return Object.freeze({ fields, detect, looksLikeRdapUrl, safeURL, formatLabel, contactFields, entityHeading, eventLabel, headline, summary, isObject, filterTree });
});

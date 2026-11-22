/* RDAP Human Viewer — dependency-free parsing and field metadata. */
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
  function contactFields(vcardArray) {
    if (!Array.isArray(vcardArray) || vcardArray[0] !== 'vcard' || !Array.isArray(vcardArray[1])) return [];
    return vcardArray[1].filter(x => Array.isArray(x) && x.length >= 4 && typeof x[0] === 'string').map(x => ({
      key: x[0], value: Array.isArray(x[3]) ? x[3].filter(v => typeof v === 'string' && v).join(', ') : String(x[3] ?? ''), params: isObject(x[1]) ? x[1] : {}
    }));
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
          return props.some(p => matches(p.key) || matches(p.value) || matches(JSON.stringify(p.params))) ? node : undefined;
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
  return Object.freeze({ fields, detect, looksLikeRdapUrl, safeURL, formatLabel, contactFields, headline, summary, isObject, filterTree });
});

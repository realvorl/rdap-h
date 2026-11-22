const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../rdap.js');

test('detects the five primary RDAP types', () => {
  for (const type of ['ip network', 'autnum', 'domain', 'entity', 'nameserver']) {
    assert.equal(R.detect({ objectClassName: type })?.type, type);
  }
});
test('detects RDAP search result collections', () => {
  for (const key of ['domainSearchResults', 'nameserverSearchResults', 'entitySearchResults']) {
    assert.equal(R.detect({rdapConformance:['rdap_level_0'], [key]:[]})?.search, key);
  }
});
test('detects RDAP error, but not generic error JSON', () => {
  assert.equal(R.detect({errorCode:404, title:'Not found', rdapConformance:['rdap_level_0']})?.type, 'error');
  assert.equal(R.detect({errorCode:404}), null);
});
test('rejects normal JSON and malformed root structures', () => {
  for (const v of [null, [], {}, {hello:'world'}, {objectClassName:'other'}, {domainSearchResults:'wrong'}]) assert.equal(R.detect(v), null);
});
test('checks candidate URLs without matching unrelated sites', () => {
  assert.equal(R.looksLikeRdapUrl('https://rdap.arin.net/registry/ip/192.168.1.6'), true);
  assert.equal(R.looksLikeRdapUrl('https://rdap.db.ripe.net/ip/8.8.8.8'), true);
  assert.equal(R.looksLikeRdapUrl('https://example.org/rdap/domain/example.org'), true);
  assert.equal(R.looksLikeRdapUrl('https://rdap.org/domain/example.org'), true);
  assert.equal(R.looksLikeRdapUrl('https://example.org/docs/rdap'), false);
  assert.equal(R.looksLikeRdapUrl('https://example.org/home'), false);
});
test('rejects unsafe links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//example.org', 'not a url']) assert.equal(R.safeURL(url), null);
  assert.equal(R.safeURL('https://example.org/'), 'https://example.org/');
});
test('decodes jCard contact properties and preserves parameters', () => {
  const x = R.contactFields(['vcard', [['version',{},'text','4.0'], ['fn',{},'text','Example Org'], ['email',{type:'work'},'text','noc@example.org']]]);
  assert.equal(x.find(p => p.key === 'fn').value, 'Example Org');
  assert.deepEqual(x.find(p => p.key === 'email').params, {type:'work'});
});
test('preserves repeated emails and formats jCard postal address from label', () => {
  const vcard = ['vcard', [
    ['email', {type:'work'}, 'text', 'one@example.net'],
    ['email', {type:'abuse'}, 'text', 'two@example.net'],
    ['adr', {label:'Line one\nLine two'}, 'text', ['', '', 'street', 'city', '', '', 'country']]
  ]];
  const fields = R.contactFields(vcard);
  assert.deepEqual(fields.filter(x => x.key === 'email').map(x => x.value), ['one@example.net', 'two@example.net']);
  assert.equal(fields.find(x => x.key === 'adr').value, 'Line one\nLine two');
});
test('interprets jCard phone types and contact preference without exposing parameter objects', () => {
  const fields = R.contactFields(['vcard', [
    ['version', {}, 'text', '4.0'],
    ['tel', {type:['work', 'voice'], pref:1, 'x-apnic-code':'AB-12'}, 'uri', 'tel:+61738583100'],
    ['tel', {type:'fax', pref:2}, 'uri', 'tel:+61738583101'],
    ['tel', {type:'cell', pref:3}, 'uri', 'tel:+61738583102']
  ]]);
  const phones = fields.filter(field => field.key === 'tel');
  assert.deepEqual(phones.map(field => field.label), ['Work Phone', 'Fax', 'Mobile phone']);
  assert.equal(phones[0].value, '+61738583100');
  assert.equal(phones[0].sourceValue, 'tel:+61738583100');
  assert.deepEqual(phones.map(field => field.preferenceLabel), ['Preferred · 1', 'Preference 2', 'Preference 3']);
  assert.equal(phones[0].preferenceTitle, 'Preference 1; lower numbers indicate higher preference.');
  assert.deepEqual(phones[0].technicalParams, [['x-apnic-code', 'AB-12']]);
  assert.equal(fields[0].label, 'Version');
});
test('known jCard parameters are case-insensitive and labeled address data is preferred once', () => {
  const fields = R.contactFields(['vcard', [
    ['tel', {TYPE:['WORK', 'VOICE'], PREF:'1'}, 'uri', 'tel:+61738583100'],
    ['adr', {LABEL:'Line one\nLine two'}, 'text', ['', '', 'Line one', 'Line two', '', '', '']]
  ]]);
  assert.equal(fields[0].label, 'Work Phone');
  assert.equal(fields[0].preference, 1);
  assert.equal(fields[1].value, 'Line one\nLine two');
});
test('formats fallback jCard addresses and removes empty values and parameter values', () => {
  const fields = R.contactFields(['vcard', [
    ['adr', {label:'   ', type:['home', ''], 'x-empty':'', 'x-array':['', null], 'x-empty-object':{value:''}, 'x-id':'ADDR-1', 'x-registry':{token:'RG-1'}}, 'text', ['', '', ' 21 Example Road ', '', 'Harbor City', '', '', 'AU']],
    ['adr', {label:'APNIC Service Desk\nSouth Brisbane QLD 4101\nAustralia', type:'work'}, 'text', ['', '', '6 Cordelia Street', 'South Brisbane', 'QLD', '4101', 'Australia']],
    ['adr', {label:'\n', type:'work'}, 'text', ['', '', '', '', '', '', '']],
    ['email', {type:'work', pref:0, 'x-empty':null}, 'text', 'apnic@example.net']
  ]]);
  assert.equal(fields[0].value, '21 Example Road\nHarbor City\nAU');
  assert.equal(fields[0].label, 'Home Address');
  assert.deepEqual(fields[0].technicalParams, [['x-id', 'ADDR-1'], ['x-registry', {token:'RG-1'}]]);
  assert.equal(fields[1].value, 'APNIC Service Desk\nSouth Brisbane QLD 4101\nAustralia');
  assert.equal(fields[1].label, 'Work Address');
  assert.equal(fields[2].value, '');
  assert.equal(fields[3].preference, null);
  assert.deepEqual(fields[3].technicalParams, [['pref', 0]]);
});
test('derives a compact IP network summary', () => {
  const data = {objectClassName:'ip network', name:'TEST-NET', handle:'NET-TEST', startAddress:'192.0.2.0', endAddress:'192.0.2.255', status:['active']};
  assert.equal(R.headline(data, R.detect(data)), 'TEST-NET');
  assert.equal(R.summary(data, R.detect(data)).find(x=>x.key==='handle').value, 'NET-TEST');
});
test('preserves unrecognized extensions as data', () => {
  const data = {objectClassName:'ip network', arin_originas0_originautnums:[64496]};
  assert.equal(R.detect(data).type, 'ip network');
  assert.deepEqual(data.arin_originas0_originautnums, [64496]);
});

test('filter matches field names case-insensitively and retains associated values', () => {
  const data = {handle:'NET-TEST', country:'US', entities:[{handle:'ORG-1', roles:['registrant']}]};
  assert.deepEqual(R.filterTree(data,'COUNTRY'), {country:'US'});
  assert.deepEqual(R.filterTree(data,'handle'), {handle:'NET-TEST', entities:[{handle:'ORG-1'}]});
});
test('filter searches nested values and prunes unrelated siblings and array elements', () => {
  const data = {handle:'NET-TEST', entities:[{handle:'ONE', roles:['technical']},{handle:'TWO', roles:['registrant']}], events:[{eventAction:'registration'}]};
  assert.deepEqual(R.filterTree(data,'registrant'), {entities:[{roles:['registrant']}]});
  assert.deepEqual(R.filterTree(data,'not present'), {});
});
test('filter preserves valid jCard when searching decoded contact keys or values', () => {
  const card = ['vcard', [['version',{},'text','4.0'], ['fn',{},'text','Example Org'], ['email',{},'text','info@example.org']]];
  const data = {entities:[{vcardArray:card,handle:'ABC'}], name:'Test network'};
  assert.deepEqual(R.filterTree(data,'example.org'), {entities:[{vcardArray:card}]});
  assert.deepEqual(R.filterTree(data,'email'), {entities:[{vcardArray:card}]});
});
test('jCard filtering matches formatted labels and original parameter keys and values', () => {
  const card = ['vcard', [
    ['tel', {type:'voice', pref:1, 'x-apnic-code':'ABUSE-42'}, 'uri', 'tel:+61738583100'],
    ['adr', {label:'South Brisbane\nAustralia'}, 'text', ['', '', 'Cordelia Street', 'South Brisbane', '', '', 'Australia']]
  ]];
  const data = {entities:[{handle:'IRT-APNIC', vcardArray:card}]};
  assert.deepEqual(R.filterTree(data, 'phone'), {entities:[{vcardArray:card}]});
  assert.deepEqual(R.filterTree(data, 'preferred'), {entities:[{vcardArray:card}]});
  assert.deepEqual(R.filterTree(data, 'x-apnic-code'), {entities:[{vcardArray:card}]});
  assert.deepEqual(R.filterTree(data, 'ABUSE-42'), {entities:[{vcardArray:card}]});
  assert.deepEqual(R.filterTree(data, 'South Brisbane'), {entities:[{vcardArray:card}]});
});
test('empty filter returns original data unchanged', () => {
  const data = {objectClassName:'ip network', handle:'NET'};
  assert.equal(R.filterTree(data,'  '),data);
});

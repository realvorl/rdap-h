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
test('empty filter returns original data unchanged', () => {
  const data = {objectClassName:'ip network', handle:'NET'};
  assert.equal(R.filterTree(data,'  '),data);
});

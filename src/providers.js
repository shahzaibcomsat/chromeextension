// Public registry URLs are protocol destinations, not bundled service credentials.
export function registrationEndpoint(domain) {
  const hostname = new URL('https://' + domain).hostname;
  const registry = {
    com:'https://rdap.verisign.com/com/v1/domain/',
    net:'https://rdap.verisign.com/net/v1/domain/',
    org:'https://rdap.publicinterestregistry.org/rdap/domain/',
    uk:'https://rdap.nominet.uk/uk/domain/',
    app:'https://rdap.nic.google/domain/',
    dev:'https://rdap.nic.google/domain/'
  }[hostname.split('.').at(-1)];
  return new URL((registry || 'https://rdap.org/domain/') + encodeURIComponent(hostname));
}

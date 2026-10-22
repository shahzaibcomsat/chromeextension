// Best-effort public responses. No login cookies, shared keys or invented metrics.
export function finiteNumber(value,max=Infinity){
  if(value===null||value===undefined||(typeof value==='string'&&value.trim()==='')||typeof value==='boolean')return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=max?n:null;
}
export function parseSemrush(backlinksXml,infoXml){
  const number=(xml,tags)=>{for(const tag of tags){const m=String(xml||'').match(new RegExp('<'+tag+'(?:\\s[^>]*)?>\\s*([0-9]+(?:\\.[0-9]+)?)\\s*</'+tag+'>','i'));if(m)return finiteNumber(m[1]);}return null;};
  return {backlinks:number(backlinksXml,['links_hostname','links']),referringDomains:number(backlinksXml,['domains_hostname','domains']),organicTraffic:number(infoXml,['traffic']),organicKeywords:number(infoXml,['keywords']),semrushRank:number(infoXml,['rank'])};
}
export function parseSimilarweb(data,domain){
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('SimilarWeb returned no usable object.');
  if(data.SiteName&&String(data.SiteName).toLowerCase().replace(/^www\./,'')!==domain)throw new Error('SimilarWeb returned a different domain.');
  const history=Object.entries(data.EstimatedMonthlyVisits||{}).map(([month,value])=>({month,visits:finiteNumber(value)})).filter(item=>/^\d{4}-\d{2}/.test(item.month)&&item.visits!==null).sort((a,b)=>a.month.localeCompare(b.month));
  const engagement=data.Engagments||data.Engagements||{};
  return {monthlyVisits:history.at(-1)?.visits??finiteNumber(engagement.Visits),visitsMonth:history.at(-1)?.month||null,monthlyHistory:history.slice(-12),globalRank:finiteNumber(data.GlobalRank?.Rank??data.GlobalRank),bounceRate:finiteNumber(engagement.BounceRate,1),pagesPerVisit:finiteNumber(engagement.PagePerVisit),timeOnSite:finiteNumber(engagement.TimeOnSite),trafficShares:Object.fromEntries(Object.entries(data.TrafficSources||{}).filter(([,v])=>finiteNumber(v,1)!==null).map(([k,v])=>[k,Number(v)]))};
}
export function parseSuggestions(raw,query){
  if(!Array.isArray(raw)||raw[0]!==query||!Array.isArray(raw[1]))throw new Error('Google returned an unexpected suggestions response.');
  return [...new Set(raw[1].filter(v=>typeof v==='string'))].slice(0,30);
}
export function parseArchiveRows(raw){
  if(!Array.isArray(raw)||raw.length<2)return null;
  const headings=raw[0],row=raw[1];if(!Array.isArray(headings)||!Array.isArray(row))throw new Error('Archive response was not a CDX table.');
  const timestamp=row[headings.indexOf('timestamp')],original=row[headings.indexOf('original')];
  if(!/^\d{14}$/.test(timestamp||''))throw new Error('Archive response has no valid capture timestamp.');
  const iso=timestamp.slice(0,4)+'-'+timestamp.slice(4,6)+'-'+timestamp.slice(6,8)+'T'+timestamp.slice(8,10)+':'+timestamp.slice(10,12)+':'+timestamp.slice(12,14)+'Z';
  if(!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,19)!==iso.slice(0,19))throw new Error('Invalid archive capture date.');
  let url;try{url=new URL(original);}catch{throw new Error('Archive response has no valid original URL.');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('Unsupported archived URL.');
  return {timestamp,original:url.href,date:timestamp.slice(0,4)+'-'+timestamp.slice(4,6)+'-'+timestamp.slice(6,8),snapshotUrl:'https://web.archive.org/web/'+timestamp+'/'+url.href};
}

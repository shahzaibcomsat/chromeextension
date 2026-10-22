import {getDomain} from '../vendor/tldts.js';
import {registrationEndpoint} from './providers.js';
export const GOOGLE_HOSTS=['google.com','google.co.uk','google.com.pk','google.co.in','google.ca','google.com.au','google.de','google.fr','google.es','google.it','google.nl','google.com.br','google.co.jp','google.ae','google.com.sa','google.co.za','google.co.nz','google.ie','google.com.bd','google.com.sg'].flatMap(h=>[h,'www.'+h]);
export function registeredDomain(input){
  let url;try{url=new URL(String(input).includes('://')?input:'https://'+input);}catch{throw new Error('Enter a valid public website domain.');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('Only website domains are supported.');
  const domain=getDomain(url.hostname,{allowPrivateDomains:false});if(!domain)throw new Error('No registered public domain was found.');return domain;
}
export function registrationFacts(data,domain,source,now=Date.now()){
  const actual=String(data.ldhName||data.unicodeName||'').toLowerCase();
  if(actual!==domain)throw new Error('Registry returned a different domain.');
  const registration=(data.events||[]).find(e=>e.eventAction==='registration')?.eventDate;
  const time=registration?Date.parse(registration):NaN;
  const ageDays=Number.isFinite(time)&&time<=now?Math.floor((now-time)/86400000):null;
  return {domain,registered:ageDays===null?null:new Date(time).toISOString(),ageDays,ageYears:ageDays===null?null:Number((ageDays/365.2425).toFixed(1)),source,observedAt:new Date(now).toISOString()};
}
const numeric=(value,max=Infinity)=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=max?n:null;};
export function keMetrics(raw,domain){
  const rows=Array.isArray(raw)?raw:(Array.isArray(raw?.data)?raw.data:[raw]);
  const match=rows.find(row=>{try{return registeredDomain(row?.domain)===domain;}catch{return false;}});
  if(!match)throw new Error('Keywords Everywhere returned no row for this domain.');
  const row=match.data&&typeof match.data==='object'?match.data:match;
  if(row.error)throw new Error('Keywords Everywhere did not provide metrics for this domain.');
  return {source:'Keywords Everywhere / Moz',da:numeric(row.moz_domain_authority,100),pa:numeric(row.moz_page_authority,100),spam:numeric(row.moz_spam_score,100),backlinks:numeric(row.moz_external_pages_to_subdomain),referringDomains:numeric(row.moz_root_domains_to_subdomain)};
}
const pending=new Map();
let active=0;const waiting=[];
async function limited(fn){if(active>=3)await new Promise(resolve=>waiting.push(resolve));active++;try{return await fn();}finally{active--;waiting.shift()?.();}}
export async function domainData(hostname,fetchData,backend){
  const domain=registeredDomain(hostname);
  const {settings={}}=await chrome.storage.local.get('settings');
  const hasAllAccess=await chrome.permissions.contains({origins:['https://*/*']});
  const fingerprint=JSON.stringify([domain,hasAllAccess,settings.metricsUrl||'',settings.metricsToken||'',settings.keKey||'',settings.ahrefsKey||'']);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const key='domain-v1:'+hash;
  const cached=(await chrome.storage.local.get(key))[key];if(cached?.expires>Date.now())return {...cached.data,cached:true};
  if(pending.has(key))return pending.get(key);
  const task=limited(async()=>{
    const errors=[];let directDr=null;const result={domain,da:null,pa:null,dr:null,spam:null,backlinks:null,referringDomains:null,organicTraffic:null,monthlyVisits:null,ageDays:null,ageYears:null,registered:null,sources:{},observedAt:new Date().toISOString(),cached:false};
    const allowed=async url=>chrome.permissions.contains({origins:[new URL(url).origin+'/*']});
    const load=async(name,fn)=>{try{await fn();}catch(error){errors.push(name+': '+error.message);}};
    await Promise.all([
      load('Domain age',async()=>{const endpoint=registrationEndpoint(domain);if(!await allowed(endpoint.href))throw new Error('Enable website data access in Integrations.');const {text,response}=await fetchData(endpoint.href,{},500000,true);const data=registrationFacts(JSON.parse(text),domain,response.url||endpoint.href);Object.assign(result,{ageDays:data.ageDays,ageYears:data.ageYears,registered:data.registered});result.sources.age=data.source;if(data.ageDays===null)errors.push('Domain age: registry did not supply a valid registration date.');}),
      load('Authority',async()=>{
        if(settings.metricsUrl){if(!await allowed(settings.metricsUrl))throw new Error('Backend permission not granted.');const data=await backend('metrics',{hostname:domain});Object.assign(result,data,{domain});for(const field of ['da','pa','dr','spam','backlinks','referringDomains','organicTraffic','monthlyVisits'])if(data[field]!=null)result.sources[field]=data.source;}
        else if(settings.keKey){const endpoint='https://linkmetrics.keywordseverywhere.com/service/get-domain-link-metrics';if(!await allowed(endpoint))throw new Error('Grant Keywords Everywhere access in Integrations.');const {text}=await fetchData(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x.seometrics.v4+json'},body:JSON.stringify({domains:[domain],country:'us',version:'11.55',num:5000,api_key:settings.keKey})});const data=keMetrics(JSON.parse(text),domain);for(const field of ['da','pa','spam','backlinks','referringDomains']){result[field]=data[field];if(data[field]!=null)result.sources[field]=data.source;}}
        else errors.push('DA / PA / Spam: add your Keywords Everywhere key or a licensed metrics backend.');
      }),
      load('DR',async()=>{if(!settings.ahrefsKey){if(!settings.metricsUrl)errors.push('DR: add your Ahrefs key or a licensed metrics backend.');return;}const endpoint=new URL('https://api.ahrefs.com/v3/public/domain-rating-free');endpoint.search=new URLSearchParams({target:domain,output:'json'});if(!await allowed(endpoint.href))throw new Error('Grant Ahrefs access in Integrations.');const {text}=await fetchData(endpoint.href,{headers:{Accept:'application/json',Authorization:'Bearer '+settings.ahrefsKey}});const json=JSON.parse(text);const dr=numeric(typeof json.domain_rating==='object'?json.domain_rating?.domain_rating:json.domain_rating??json.domainRating,100);if(dr===null)throw new Error('Provider returned no valid DR.');directDr=dr;})
    ]);
    if(directDr!==null){result.dr=directDr;result.sources.dr='Ahrefs';}
    if(!settings.metricsUrl)errors.push('Traffic: configure a licensed metrics backend for organic traffic and monthly visits.');
    result.errors=errors;result.observedAt=new Date().toISOString();
    // Cache complete successful fields for a day; partial failures retry in five minutes.
    await chrome.storage.local.set({[key]:{expires:Date.now()+(errors.length?300000:86400000),data:result}});
    const all=await chrome.storage.local.get(null);const keys=Object.keys(all).filter(k=>k.startsWith('domain-v1:')).sort((a,b)=>(all[a]?.expires||0)-(all[b]?.expires||0));if(keys.length>250)await chrome.storage.local.remove(keys.slice(0,keys.length-250));
    return result;
  });pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}

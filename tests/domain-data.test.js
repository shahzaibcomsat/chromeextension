import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredDomain,registrationFacts,keMetrics} from '../src/domain-data.js';
test('registered domain parsing handles regional public suffixes and subdomains',()=>{assert.equal(registeredDomain('https://shop.example.co.uk/p'),'example.co.uk');assert.equal(registeredDomain('www.example.com.pk'),'example.com.pk');assert.throws(()=>registeredDomain('127.0.0.1'));});
test('age is derived only from a matching registry registration event',()=>{const data={ldhName:'EXAMPLE.COM',events:[{eventAction:'registration',eventDate:'2020-01-01T00:00:00Z'}]};const r=registrationFacts(data,'example.com','https://registry.example',Date.parse('2021-01-01T00:00:00Z'));assert.equal(r.ageDays,366);assert.equal(r.ageYears,1);assert.throws(()=>registrationFacts(data,'other.com','source'));assert.equal(registrationFacts({ldhName:'example.com'},'example.com','source').ageDays,null);});
test('absent and future registration dates never create invented age',()=>{assert.equal(registrationFacts({ldhName:'example.com',events:[{eventAction:'registration',eventDate:'2999-01-01'}]},'example.com','source').ageDays,null);});
test('provider DA, PA and Spam remain independent and missing fields stay null',()=>{const r=keMetrics([{domain:'example.com',data:{moz_domain_authority:0,moz_spam_score:null}}],'example.com');assert.equal(r.da,0);assert.equal(r.pa,null);assert.equal(r.spam,null);assert.equal(r.referringDomains,null);assert.throws(()=>keMetrics([{domain:'other.com',data:{moz_domain_authority:30}}],'example.com'));});
test('domain summary caches keyed results without fabricating missing provider values',async()=>{
 const {domainData}=await import('../src/domain-data.js');const store={settings:{keAnonymous:false,publicMetrics:false}};let requests=0;
 globalThis.chrome={storage:{local:{get:async key=>key===null?{...store}:typeof key==='string'?{[key]:store[key]}:{},set:async object=>Object.assign(store,object),remove:async keys=>keys.forEach(key=>delete store[key])}},permissions:{contains:async()=>true}};
 const fetchData=async url=>{requests++;return {response:{url},text:JSON.stringify({ldhName:'EXAMPLE.COM',events:[{eventAction:'registration',eventDate:'2000-01-01T00:00:00Z'}]})};};
 try{const first=await domainData('shop.example.com',fetchData,async()=>{});assert.ok(first.ageYears>0);assert.equal(first.da,null);assert.equal(first.pa,null);assert.equal(first.spam,null);const second=await domainData('www.example.com',fetchData,async()=>{});assert.equal(second.cached,true);assert.equal(requests,1);assert.ok(first.errors.some(error=>error.includes('DA / PA')));}finally{delete globalThis.chrome;}
});
test('saving a KE key does not send it unless account-authenticated lookup is explicitly enabled',async()=>{
 const {domainData}=await import('../src/domain-data.js');const store={settings:{keKey:'fixture-private-value',keAnonymous:true,keUseKey:false,publicMetrics:false}};let sentKey;
 globalThis.chrome={storage:{local:{get:async key=>key===null?{...store}:{[key]:store[key]},set:async v=>Object.assign(store,v),remove:async()=>{}}},permissions:{contains:async()=>true}};
 const fetchData=async(url,options={})=>url.includes('keywordseverywhere')?(sentKey=JSON.parse(options.body).api_key,{response:{url},text:JSON.stringify([{domain:'example.net',data:{moz_domain_authority:20}}])}):{response:{url},text:JSON.stringify({ldhName:'example.net'})};
 try{const result=await domainData('example.net',fetchData,async()=>{});assert.equal(sentKey,'');assert.equal(result.da,20);assert.equal(result.spam,null);}finally{delete globalThis.chrome;}
});

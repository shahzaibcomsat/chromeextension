(() => {
  if (window.__shahzaibSerpInstalled) return;
  window.__shahzaibSerpInstalled = true;
  const fields=[['ageYears','Age'],['da','DA'],['pa','PA'],['dr','DR'],['spam','Spam'],['backlinks','Backlinks'],['referringDomains','Ref. domains'],['organicTraffic','Organic traffic'],['monthlyVisits','Visits'],['organicKeywords','Keywords']];
  const CSS=`:host{all:initial;display:block;font-family:Arial,system-ui,sans-serif;color:#193d32}.bar{box-sizing:border-box;background:#f6fbf6;border:1px solid #cbded0;border-radius:8px;padding:10px 12px;margin:8px 0 14px;max-width:1040px;font-size:12px}.head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.brand{font-weight:700;color:#1c634e}.domain{font-weight:600;font-size:12px}.meta{color:#65786d;font-size:10px;margin-top:7px;line-height:1.5;overflow-wrap:anywhere}.cells{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.cell{border:1px solid #dce8dd;background:white;border-radius:5px;padding:5px 7px;font-size:10px}.cell b{font-size:11px;color:#163e2e;margin-left:4px}.actions{display:flex;gap:6px;margin-left:auto}button{border:1px solid #b5cdbb;border-radius:5px;background:white;color:#19573f;padding:5px 7px;cursor:pointer;font-size:10px}button:hover{background:#e5f2e6}button:focus-visible{outline:2px solid #1c634e;outline-offset:2px}.result{margin:6px 0 12px;padding:8px 10px;font-size:10px}.result .cells{margin-top:5px}.badge{font-size:10px;color:#566b5f}.error{color:#886022}details{margin-top:6px;font-size:10px}summary{cursor:pointer}.hint{font-size:10px;color:#63796a}a{color:#19573f}`;
  let enabled=true,root,topShadow,selected=null,scanning=false,timer,routeKey='',items=[],config={};
  const create=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  function format(key,value){if(value==null)return '—';if(key==='ageYears')return value<1?'<1 yr':value+' yr';if(key==='spam')return value+'%';return Number(value).toLocaleString();}
  function cells(data){const wrap=create('div',undefined,'cells');for(const [key,label] of fields){const item=create('span',label,'cell');item.append(create('b',format(key,data?.[key])));item.title=data?.sources?.[key==='ageYears'?'age':key]||'No provider value available';wrap.append(item);}return wrap;}
  function details(data){const el=create('details');el.append(create('summary',data?.errors?.length?'Sources & unavailable data':'Sources & timestamp'));el.append(create('div',Object.entries(data?.sources||{}).map(([k,v])=>k+': '+v).join(' · ')||'No data source returned values.','meta'));if(data?.registered)el.append(create('div','Registered '+new Date(data.registered).toLocaleDateString(),'meta'));if(data?.errors?.length)el.append(create('div',data.errors.join(' | '),'meta error'));if(data?.observedAt)el.append(create('div',(data.cached?'Cached · ':'Fetched · ')+new Date(data.observedAt).toLocaleString(),'meta'));return el;}
  function settings(event){if(event&&!event.isTrusted)return;chrome.runtime.sendMessage({job:'openSettings'}).catch(()=>{});}
  function top(){if(!topShadow)return;topShadow.replaceChildren();topShadow.append(create('style',CSS));const bar=create('section',undefined,'bar');bar.setAttribute('aria-label','Shahzaib SEO Google results toolbar');const header=create('div',undefined,'head');header.append(create('span','Shahzaib SEO','brand'),create('span',selected?.data?.domain||selected?.hostname||'Google results','domain'));const actions=create('div',undefined,'actions');for(const [label,fn] of [['Setup',settings],['Export CSV',exportCsv],['Hide',async()=>{config.serpEnabled=false;await chrome.runtime.sendMessage({job:'hideToolbar'});remove();}]]){const button=create('button',label);button.onclick=fn;actions.append(button);}header.append(actions);bar.append(header,cells(selected?.data));bar.append(create('div',`${items.length} result strips · Select a result's “Focus” button to see its website data here. Values shown as — are unavailable, never zero estimates.`,'meta'));if(selected?.data)bar.append(details(selected.data));else bar.append(create('div','Open Setup → Enable website data access to allow registry and provider requests. DA/PA/DR require configured provider access.','meta'));topShadow.append(bar);}
  function draw(item){item.shadow.replaceChildren();item.shadow.append(create('style',CSS));const bar=create('section',undefined,'bar result');bar.setAttribute('aria-label','Website metrics for '+item.hostname);const header=create('div',undefined,'head');header.append(create('span',item.data?.domain||item.hostname,'domain'));const focus=create('button','Focus');focus.onclick=()=>{selected=item;top();};header.append(focus,create('span',item.loading?'Loading website data…':item.error||'Website data','badge'));bar.append(header,cells(item.data));if(item.data)bar.append(details(item.data));else if(item.error)bar.append(create('div',item.error,'meta error'));item.shadow.append(bar);}
  async function enrich(item){item.loading=true;draw(item);try{const response=await chrome.runtime.sendMessage({job:'domainSummary',payload:{hostname:item.hostname}});if(!response?.ok)throw new Error(response?.error||'No background response.');item.data=response.data;}catch(error){item.error=error.message;}finally{item.loading=false;if(item.host.isConnected)draw(item);if(selected===item)top();}}
  function remove(){document.querySelectorAll('[data-shahzaib-seo]').forEach(el=>el.remove());root=null;topShadow=null;items=[];}
  function exportCsv(){const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const rows=[['Domain',...fields.map(v=>v[1]),'Registered','Observed','Errors'],...items.map(item=>[item.data?.domain||item.hostname,...fields.map(([key])=>item.data?.[key]??''),item.data?.registered||'',item.data?.observedAt||'',item.error||(item.data?.errors||[]).join(' | ')])];const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv'}));const a=create('a');a.href=url;a.download='shahzaib-serp-metrics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function scan(){
    if(scanning||!enabled||config.serpEnabled===false)return;scanning=true;
    try{
      if(location.pathname!=='/search'){remove();return;}
      const key=location.href;if(routeKey!==key){remove();selected=null;routeKey=key;}
      items=items.filter(item=>item.host.isConnected);
      const search=document.querySelector('#search')||document.querySelector('#rso')||document.querySelector('main');if(!search)return;
      if(!root?.isConnected){root=create('div');root.dataset.shahzaibSeo='toolbar';topShadow=root.attachShadow({mode:'open'});search.before(root);top();}
      const limit=Number(config.serpLimit)===20?20:10;
      for(const h3 of search.querySelectorAll('h3')){
        if(items.length>=limit)break;
        const anchor=h3.closest('a');if(!anchor)continue;
        let url;try{url=new URL(anchor.href,location.href);if(url.hostname===location.hostname&&url.pathname==='/url')url=new URL(url.searchParams.get('q')||url.searchParams.get('url'));}catch{continue;}
        if(!/^https?:$/.test(url.protocol)||url.hostname===location.hostname||/(^|\.)google\.[a-z.]+$/.test(url.hostname))continue;
        if(items.some(item=>item.anchor===anchor))continue;
        const host=create('div');host.dataset.shahzaibSeo='result';const shadow=host.attachShadow({mode:'open'});anchor.after(host);const item={anchor,host,shadow,hostname:url.hostname,data:null,error:null,loading:true};items.push(item);if(!selected)selected=item;draw(item);enrich(item);
      }
      top();
    }finally{scanning=false;}
  }
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='shahzaib-toolbar-config'){config=message.config||{};remove();selected=null;schedule();}});
  function schedule(){clearTimeout(timer);timer=setTimeout(scan,350);}
  chrome.runtime.sendMessage({job:'toolbarConfig'}).then(response=>{if(!response?.ok)return;config=response.config||{};schedule();}).catch(()=>{});
  new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&!node.hasAttribute?.('data-shahzaib-seo'))))schedule();}).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('popstate',schedule);
})();

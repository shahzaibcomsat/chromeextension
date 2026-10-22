"""Browser harness: runs real audit code and UI with mocked Chrome APIs.
Does not establish that Chrome Web Store policy or installed extension loading passes.
Requires the workspace-provided Python Playwright and Chromium.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,mimetypes
ROOT=Path(__file__).resolve().parents[1]
ARTIFACTS=Path('/workspace/artifacts');ARTIFACTS.mkdir(exist_ok=True)
FIXTURE='''<!doctype html><html lang="en"><head><title>A clear example title for an independent audit</title><meta name="description" content="This example page contains enough descriptive metadata for testing audits without sending anything to an external provider."><meta name="viewport" content="width=device-width"><meta property="og:title" content="Example"><link rel="canonical" href="https://example.com/sample"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Testing"}</script><script type="application/ld+json">{broken}</script></head><body><h1>Independent SEO audit example</h1><h3>A skipped heading level</h3><p>Useful content for readers. We explain metadata, structured data and accessible links. Evidence matters more than invented numbers.</p><img src="/image.png"><img src="/image.png" alt=""><a href="https://example.com/info" rel="nofollow">Documentation</a><a href="https://outside.example/"></a><a href="javascript:alert(1)">Unsafe destination</a></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':800,'height':600})
 def route(r):
  url=r.request.url
  if url=='http://localhost/fixture':return r.fulfill(body=FIXTURE,content_type='text/html')
  if not url.startswith('http://localhost/'):return r.abort()
  path=(ROOT/url.split('http://localhost/',1)[1].split('?')[0]).resolve()
  if not path.is_relative_to(ROOT) or not path.is_file():return r.fulfill(status=404,body='Missing')
  r.fulfill(body=path.read_bytes(),content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
 ctx.route('**/*',route)
 target=ctx.new_page();target.goto('http://localhost/fixture')
 function=(ROOT/'src/audit.js').read_text().replace('export function','function',1)
 audit=target.evaluate('() => {'+function+';return inspectPage();}')
 assert audit['headingSkips']==1
 assert audit['images'][0]['alt'] is None and audit['images'][1]['alt']==''
 assert audit['schemas'][0]['valid'] and not audit['schemas'][1]['valid']
 assert len(audit['links'])==3
 # The audit's evidence is provided by the test fixture, not a real Chrome tab API.
 page=ctx.new_page();errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
 page.add_init_script('''const store={};window.__store=store;window.__audit=JSON.parse('''+json.dumps(json.dumps(audit))+''');window.chrome={
 tabs:{query:async()=>[{id:1,url:'https://example.com/sample'}]},
 scripting:{executeScript:async()=>[{result:window.__audit}]},
 storage:{local:{get:async key=>typeof key==='string'?{[key]:store[key]}:Object.fromEntries(key.map(k=>[k,store[k]])),set:async data=>Object.assign(store,data),remove:async key=>{delete store[key];}}},
 permissions:{request:async()=>true,getAll:async()=>({origins:[]}),remove:async()=>true},
 runtime:{getURL:path=>'http://localhost/'+path,sendMessage:async message=>message.job==='suggest'?{ok:true,data:{source:'Google Suggest fixture',observedAt:'2026-10-23',suggestions:['example audit']}}:message.job==='wayback'?{ok:true,data:{domain:'example.com',source:'Wayback fixture',observedAt:'2026-10-23',earliest:{date:'2010-01-02',snapshotUrl:'https://web.archive.org/web/20100102030405/https://example.com/'},available:null,errors:[]}}:{ok:false,error:'Fixture: no provider request sent'}}
};''')
 page.goto('http://localhost/popup.html');page.locator('#startAudit').click()
 page.locator('#siteHost').filter(has_text='localhost').wait_for()
 assert page.locator('#view').inner_text().find('ON-PAGE CHECKLIST')>=0
 assert page.locator('#websiteFetch').count()==1
 assert 'Website age & authority' in page.locator('#view').inner_text()
 assert not page.evaluate('document.documentElement.scrollWidth>800')
 page.screenshot(path=str(ARTIFACTS/'shahzaib-seo-original-overview.png'))
 page.locator('[data-view="content"]').click();assert page.locator('#view').inner_text().find('Heading outline')>=0
 page.locator('[data-view="images"]').click();assert page.locator('#view').inner_text().find('Missing attribute')>=0
 page.locator('[data-view="links"]').click();page.locator('#linkFilter').select_option('nofollow');assert page.locator('#linkRows tbody tr').count()==1
 page.locator('[data-view="schema"]').click();page.locator('#schemaGenerate').click();assert 'schema.org' in page.locator('#schemaOutput').inner_text()
 page.locator('[data-view="technical"]').click();assert page.locator('#technicalFetch').is_visible();page.locator('#waybackFetch').click();assert '2010-01-02' in page.locator('#waybackResults').inner_text()
 page.locator('[data-view="authority"]').click();page.locator('#metricsFetch').click();assert 'Fixture: no provider request sent' in page.locator('#notice').inner_text()
 page.locator('[data-view="search"]').click();page.locator('#searchQuery').fill('example');assert page.locator('#searchFetch').is_visible();page.locator('#suggestFetch').click();assert 'example audit' in page.locator('#suggestResults').inner_text()
 page.locator('[data-view="utilities"]').click();page.locator('#regexPattern').fill('example');page.locator('#regexText').fill('example sample example');page.locator('#regexRun').click();page.wait_for_function('document.querySelector("#regexResult").textContent !== "No text has been processed."');assert page.locator('#regexResult').inner_text()=='example\nexample'
 page.locator('[data-view="settings"]').click();page.locator('#aiUrl').fill('http://insecure.example/');page.locator('#settingsForm button[type="submit"]').click();assert 'HTTPS' in page.locator('#notice').inner_text()
 page.locator('#aiUrl').fill('https://ai.example/chat');page.locator('#aiModel').fill('fixture-model');page.locator('#settingsForm button[type="submit"]').click();assert 'saved locally' in page.locator('#notice').inner_text();assert page.evaluate('window.__store.settings.keUseKey') is False;assert page.evaluate('window.__store.settings.keAnonymous') is True
 page.locator('[data-view="history"]').click();assert 'localhost' in page.locator('#view').inner_text();page.locator('#clearHistory').click();page.wait_for_function('!window.__store.history')
 page.locator('[data-view="overview"]').click();page.locator('#exportBtn').click()
 with page.expect_download() as download:page.locator('#csvExport').click()
 assert download.value.suggested_filename=='shahzaib-checks.csv'
 page.locator('#closeExport').click()
 assert not errors,errors
 print(json.dumps({'result':'PASS','checks':['real DOM extraction','missing vs decorative alt','invalid JSON-LD','heading hierarchy','overview layout','content','link filtering','schema generator','technical controls','unconfigured integration handling','search controls','regex worker','HTTPS settings validation','history deletion','CSV download'],'pageErrors':errors},indent=2))
 browser.close()

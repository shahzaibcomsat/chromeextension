"""Google results DOM fixture with mocked registry/provider responses; no live API calls."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1280,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/*',lambda route:route.fulfill(content_type='text/html',body='''<!doctype html><html><head><meta charset="utf-8"><title>SEO research - Google fixture</title><style>body{font:14px Arial;margin:28px 90px;color:#202124}h1{font-size:22px}#search{width:900px}article{margin:24px 0}a{color:#1a0dab;text-decoration:none}h3{font-size:20px;font-weight:400;margin:6px 0}p{color:#4d5156}</style></head><body><h1>Google results fixture · SEO research</h1><p>Test data only. Not a live Google search or provider response.</p><div id="search"><article><a href="https://www.example.com/guide"><span>example.com</span><h3>SEO research guide</h3></a><p>A guide to inspecting content and technical signals.</p></article><article><a href="https://shop.example.co.uk/checklist"><span>shop.example.co.uk</span><h3>Independent SEO checklist</h3></a><p>Practical checks for your website.</p></article></div></body></html>'''))
 page.add_init_script('''window.__listeners=[];window.__calls=[];window.chrome={storage:{local:{get:async()=>({settings:{serpEnabled:true,serpLimit:10}}),set:async()=>{}},onChanged:{addListener:fn=>window.__listeners.push(fn)}},runtime:{onMessage:{addListener:fn=>window.__listeners.push(fn)},sendMessage:async message=>{window.__calls.push(message);if(message.job==='toolbarConfig')return {ok:true,config:{serpEnabled:true,serpLimit:10}};if(message.job==='openSettings')return {ok:true};const second=message.payload.hostname.includes('co.uk');return {ok:true,data:{domain:second?'example.co.uk':'example.com',ageYears:second?12.4:24.8,registered:'2001-01-01T00:00:00Z',da:second?null:45,pa:second?null:32,dr:second?null:51,spam:second?null:0,backlinks:second?null:1500,referringDomains:second?null:250,organicTraffic:null,monthlyVisits:null,observedAt:new Date().toISOString(),sources:{age:'Fixture RDAP',da:'Fixture provider'},errors:second?['DA / PA / DR: provider access is not configured']:[],cached:false}};}}};''')
 page.goto('https://www.google.com/search?q=seo+research')
 page.add_script_tag(content=(ROOT/'src/serp.js').read_text())
 page.wait_for_function('document.querySelectorAll("[data-shahzaib-seo=result]").length===2')
 page.wait_for_function('window.__calls.filter(c=>c.job==="domainSummary").length===2')
 assert page.locator('[data-shahzaib-seo="toolbar"]').count()==1
 assert page.locator('[data-shahzaib-seo="result"]').first.locator('b').nth(1).inner_text()=='45'
 assert page.locator('[data-shahzaib-seo="result"]').nth(1).locator('b').nth(1).inner_text()=='—'
 page.get_by_role('button',name='Focus',exact=True).nth(1).click()
 assert 'example.co.uk' in page.locator('[data-shahzaib-seo="toolbar"]').locator('.domain').inner_text()
 with page.expect_download() as d:page.get_by_role('button',name='Export CSV',exact=True).click()
 assert d.value.suggested_filename=='shahzaib-serp-metrics.csv'
 page.get_by_role('button',name='Setup',exact=True).click()
 assert page.evaluate('window.__calls.some(c=>c.job==="openSettings")')
 page.screenshot(path='/workspace/artifacts/shahzaib-serp-v1.1.png',full_page=True)
 page.evaluate('''() => {const el=document.createElement('article');el.innerHTML='<a href="https://example.org/new"><h3>A dynamically loaded result</h3></a>';document.querySelector('#search').append(el);}''')
 page.wait_for_function('document.querySelectorAll("[data-shahzaib-seo=result]").length===3')
 assert page.locator('[data-shahzaib-seo="toolbar"]').count()==1
 page.evaluate('window.__listeners.forEach(fn=>fn({type:"shahzaib-toolbar-config",config:{serpEnabled:false}}))')
 assert page.locator('[data-shahzaib-seo]').count()==0
 assert not errors,errors
 print('PASS: Google toolbar, per-result strips, missing values, focus, CSV, Setup, dynamic results, disable control; zero browser errors. Provider values are fixtures, not live data.')
 b.close()

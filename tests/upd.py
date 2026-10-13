import re, time
from playwright.sync_api import sync_playwright
import os; SW=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','service-worker.js')
orig=open(SW).read()
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(); pg=ctx.new_page()
    pg.goto('http://127.0.0.1:8765/'); pg.wait_for_selector('#onbF'); pg.click('[data-act=onb-start]'); pg.wait_for_selector('#netWorth')
    pg.evaluate('navigator.serviceWorker.ready'); pg.reload(); pg.wait_for_selector('#netWorth')
    pg.click('#addBtn'); pg.fill('.sheet [name=amount]','9900'); pg.click('.sheet [data-act=tx-save]'); pg.wait_for_timeout(300)
    open(SW,'w').write(orig.replace("const VERSION = '1.0.0'","const VERSION = '1.0.1'"))
    pg.evaluate("navigator.serviceWorker.getRegistration().then(r=>r.update())")
    pg.wait_for_selector('#updateBar:not([hidden])', timeout=15000)
    print('PASS 새 버전 감지 → 업데이트 배너 표시')
    pg.click('#updateBtn'); pg.wait_for_timeout(2500); pg.wait_for_selector('#netWorth')
    keys=pg.evaluate('caches.keys()'); n=pg.evaluate('window.__MYMONEY__.S.txs.length')
    print('PASS' if 'mymoney-app-1.0.1' in keys and 'mymoney-app-1.0.0' not in keys else 'FAIL', '새 캐시로 교체', keys)
    print('PASS' if n==1 else 'FAIL', '업데이트 후 사용자 데이터 유지', n)
    b.close()
finally:
  open(SW,'w').write(orig)

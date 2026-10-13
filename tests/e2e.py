import json, os, sys, time, re
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8765/'
T = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(T, 'shots'); os.makedirs(SHOTS, exist_ok=True)
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), str(detail)))
    print(('PASS' if cond else 'FAIL'), name, detail, flush=True)

def num(s):
    return int(re.sub(r'[^\d-]', '', s.replace('−', '-')) or 0)

with sync_playwright() as p:
    dev = dict(p.devices['iPhone 13']); dev.pop('default_browser_type', None)
    browser = p.chromium.launch()
    ctx = browser.new_context(**dev, locale='ko-KR', timezone_id='Asia/Seoul', accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    J = lambda js: page.evaluate(js)
    tap = lambda sel: page.locator(sel).first.click()
    def sheet(): return page.locator('.sheet:not(.closing)').last
    def fill_money(scope, name, v):
        scope.locator(f'[name="{name}"]').fill(str(v))

    page.goto(BASE); page.wait_for_selector('#onbF')
    check('온보딩: 초기값 105,000,000 / 60,000,000 / 순자산 45,000,000',
          page.locator('[name=cash]').input_value() == '105,000,000' and page.locator('[name=loan]').input_value() == '60,000,000' and page.locator('#onbNet').inner_text() == '45,000,000원')
    page.locator('[name=rate]').fill('1.7')
    page.locator('[name=takeHome]').fill('3100000')
    page.locator('[name=takeHome]').dispatch_event('input')
    page.screenshot(path=f'{SHOTS}/01_onboarding.png')
    tap('[data-act=onb-start]')
    page.wait_for_selector('#netWorth')
    check('홈: 순자산 45,000,000원', page.locator('#netWorth').inner_text() == '45,000,000원', page.locator('#netWorth').inner_text())
    s = J('window.__MYMONEY__.S.settings')
    check('월 예산 자동 = 실수령 310만 - 저축 160만 - 상환 40만 = 110만', s['monthlyBudget'] == 1100000, s['monthlyBudget'])

    # 1) 지출
    tap('#addBtn'); page.wait_for_selector('.sheet [name=amount]')
    sh = sheet()
    fill_money(sh, 'amount', '12000'); sh.locator('[data-act=tx-cat][data-v="카페"]').click()
    sh.locator('[name=merchant]').fill('스타벅스')
    sh.locator('[data-act=tx-save]').click(); page.wait_for_timeout(400)
    t = J('window.__MYMONEY__.totals()')
    check('지출 12,000 → 현금 감소·순자산 44,988,000', t['net'] == 44988000, t)
    ms = J(f"window.__MYMONEY__.monthStats('{time.strftime('%Y-%m')}')")
    check('월 지출 12,000 / 카페 카테고리', ms['expense'] == 12000 and ms['byCat'].get('카페') == 12000, ms['byCat'])
    wk = J('window.__MYMONEY__.weekStats()')
    check('주간 예산 사용 12,000 / 남은 188,000', wk['spent'] == 12000 and wk['left'] == 188000, wk)

    # 2) 수입
    tap('#addBtn'); page.wait_for_selector('.sheet [name=amount]'); sh = sheet()
    sh.locator('[data-act=tx-type][data-v=income]').click()
    fill_money(sh, 'amount', '3100000'); sh.locator('[name=merchant]').fill('회사 급여')
    sh.locator('[data-act=tx-save]').click(); page.wait_for_timeout(400)
    ms = J(f"window.__MYMONEY__.monthStats('{time.strftime('%Y-%m')}')")
    check('저축액 = 수입-지출 = 3,088,000, 저축률 99.6%', ms['savings'] == 3088000 and abs(ms['rate'] - 3088000/3100000) < 1e-9, ms['rate'])

    # 3) 계정 추가 + 이체
    tap('[data-tab=assets]'); page.wait_for_selector('[data-act=acc-new]')
    page.locator('[data-act=acc-new]').first.click(); sh = sheet()
    sh.locator('[name=name]').fill('청년도약계좌'); sh.locator('[name=type]').select_option('적금')
    fill_money(sh, 'openingBalance', '0'); sh.locator('[data-act=save]').click(); page.wait_for_timeout(400)
    before = J('window.__MYMONEY__.totals()')
    tap('#addBtn'); page.wait_for_selector('.sheet [name=amount]'); sh = sheet()
    sh.locator('[data-act=tx-type][data-v=transfer]').click()
    fill_money(sh, 'amount', '700000')
    accs = J('window.__MYMONEY__.S.accounts.map(a=>[a.id,a.name])')
    cash_id = [a for a in accs if a[1] == '보유 현금'][0][0]; sav_id = [a for a in accs if a[1] == '청년도약계좌'][0][0]
    sh.locator('[name=accountId]').select_option(cash_id); sh.locator('[name=toAccountId]').select_option(sav_id)
    sh.locator('[data-act=tx-save]').click(); page.wait_for_timeout(400)
    after = J('window.__MYMONEY__.totals()')
    ms2 = J(f"window.__MYMONEY__.monthStats('{time.strftime('%Y-%m')}')")
    bal = J(f"window.__MYMONEY__.accountBalance(window.__MYMONEY__.S.accounts.find(a=>a.id==='{sav_id}'))")
    check('이체 70만: 순자산 불변·수입/지출 미반영·적금 잔액 70만', after['net'] == before['net'] and ms2['income'] == ms['income'] and ms2['expense'] == ms['expense'] and bal == 700000, (after, bal))

    # 4) 대출 상환 (원금/이자 분리)
    page.locator('[data-act=loan-pay]').first.click(); page.wait_for_selector('.sheet [name=principal]'); sh = sheet()
    auto_p = num(sh.locator('[name=principal]').input_value()); auto_i = num(sh.locator('[name=interest]').input_value())
    check('상환 자동계산: 이자 = 6천만×1.7%/12 = 85,000, 원금 = 315,000', auto_i == 85000 and auto_p == 315000, (auto_p, auto_i))
    sh.locator('[data-act=tx-save]').click(); page.wait_for_timeout(400)
    t2 = J('window.__MYMONEY__.totals()')
    ms3 = J(f"window.__MYMONEY__.monthStats('{time.strftime('%Y-%m')}')")
    check('상환 후 부채 59,685,000 / 순자산은 이자만큼만 감소', t2['debts'] == 59685000 and t2['net'] == after['net'] - 85000, t2)
    check('이자는 지출(대출 이자), 원금은 지출 아님', ms3['expense'] == ms2['expense'] + 85000 and ms3['principal'] == 315000 and ms3['byCat'].get('대출 이자') == 85000)
    page.screenshot(path=f'{SHOTS}/04_assets.png', full_page=True)
    trend_paths = page.locator('#trend svg path').count()
    check('자산 흐름 그래프 렌더링(순자산·자산·부채·누적상환)', trend_paths >= 4, trend_paths)
    for r in ['1M', '6M', '3Y', '5Y', 'ALL']:
        page.locator(f'[data-act=range][data-r="{r}"]').click()
    check('조회 기간 전환(1M~전체) 오류 없음', page.locator('#trend svg').count() == 1)

    # 5) 목표
    tap('[data-tab=goals]'); page.locator('[data-act=goal-template]').click(); sh = sheet()
    sh.locator('[data-act=save]').click(); page.wait_for_timeout(400)
    g = J('window.__MYMONEY__.S.goals[0]')
    gp = J('window.__MYMONEY__.goalProgress(window.__MYMONEY__.S.goals[0])')
    net = J('window.__MYMONEY__.totals().net')
    check('순자산 목표: 달성률 = 순자산/1억, 남은금액, 필요 월평균',
          abs(gp['pct'] - net/1e8) < 1e-9 and gp['remaining'] == 1e8 - net and abs(gp['required'] - (1e8 - net)/gp['monthsLeft']) < 1, (round(gp['pct']*100,1), gp['required']))
    # 저축 목표 (계정 연동)
    page.locator('[data-act=goal-new]').first.click(); sh = sheet()
    sh.locator('[data-act=kind][data-v=saving]').click()
    sh.locator('[name=name]').fill('비상금 1천만'); fill_money(sh, 'target', '10000000')
    sh.locator('[data-act=span][data-m="12"]').click()
    sh.locator(f'[name=accountIds][value="{sav_id}"]').check()
    sh.locator('[data-act=save]').click(); page.wait_for_timeout(400)
    gp2 = J('window.__MYMONEY__.goalProgress(window.__MYMONEY__.S.goals[1])')
    check('저축 목표는 선택 계정 잔액 기준(70만, 7%) — 순자산 목표와 다른 기준', gp2['cur'] == 700000 and abs(gp2['pct'] - 0.07) < 1e-9, gp2['cur'])
    page.screenshot(path=f'{SHOTS}/05_goals.png', full_page=True)
    page.locator('[data-act=goal-open]').first.click(); page.wait_for_timeout(500)
    check('목표 상세 그래프 렌더링', sheet().locator('#goalChart svg').count() == 1)
    page.screenshot(path=f'{SHOTS}/05b_goal_detail.png')
    sheet().locator('[data-act=close]').click(); page.wait_for_timeout(300)

    # 6) 시뮬레이션
    page.locator('[data-act=goal-seg][data-s=sim]').click(); page.wait_for_selector('.sim-table')
    sim = J('''window.__MYMONEY__.simulate({assets:100000000,debts:60000000,saving:1600000,principal:400000,ret:0,growth:0,target:100000000,years:10,raise:false,redirect:false,salary:0,tax:0,living:0,inflation:0})''')
    y1 = [x for x in sim['yearly'] if x['y'] == 1][0]
    check('시뮬레이션(수익률0): 1년 후 순자산 = 4천만 + (160만+40만)×12 = 6,400만', round(y1['net']) == 64000000, y1['net'])
    check('목표 1억 달성 = 30개월 후', sim['hit'] == 30, sim['hit'])
    rows = page.locator('.sim-table tbody tr').count()
    check('결과표 1·3·5·10년 표시', rows == 4, rows)
    page.locator('#simForm label.switch').nth(1).click(); page.wait_for_timeout(400)
    check('연봉 상승 반영 시 세금·생활비 가정 입력 노출', page.locator('#raiseBox').is_visible())
    page.screenshot(path=f'{SHOTS}/06_sim.png', full_page=True)

    # 7) HOME 화면
    tap('[data-tab=home]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/02_home.png', full_page=True)
    check('홈 도넛 차트 렌더링', page.locator('.donut-wrap svg').count() == 1)

    # 8) OCR
    tap('#addBtn'); sheet().locator('[data-act=tx-ocr]').click(); page.wait_for_selector('#ocrFile', state='attached')
    page.wait_for_timeout(500)
    st = page.locator('#ocrStatus').inner_text()
    check('OCR 상태 표시(온라인·엔진 미설치)', '온라인' in st, st)
    t0 = time.time()
    page.locator('#ocrFile').set_input_files(os.path.join(T, 'card_light.png'))
    page.wait_for_selector('.sheet .cand, .sheet .banner b', timeout=180000)
    page.wait_for_timeout(300)
    cands = page.locator('.cand')
    n = cands.count()
    vals = [(cands.nth(i).locator('[data-k=amount]').input_value(), cands.nth(i).locator('[data-k=merchant]').input_value(), cands.nth(i).locator('[data-k=date]').input_value(), cands.nth(i).locator('[data-k=time]').input_value(), cands.nth(i).locator('[data-k=category]').input_value()) for i in range(n)]
    print('OCR card:', vals, f'{time.time()-t0:.1f}s')
    yr = time.strftime('%Y')
    amts = sorted(num(v[0]) for v in vals)
    check('OCR 카드내역: 3건 분리 인식 (5,600 / 23,500 / 3,200)', amts == [3200, 5600, 23500], vals)
    byamt = {num(v[0]): v for v in vals}
    ok_detail = byamt.get(5600, ('', '', '', '', ''))[2].endswith('10-12') and byamt.get(5600)[3] == '14:23' and byamt.get(3200, ('', '', '', '', ''))[2].endswith('10-11') and '스타벅스' in byamt.get(5600)[1]
    check('OCR: 날짜·시간·가맹점 추출 (10/12 14:23 스타벅스, 10/11 GS25)', ok_detail, vals)
    check('OCR: 카테고리 추정 (스타벅스→카페, 배달의민족→식비, GS25→생활)', byamt.get(5600, [0]*5)[4] == '카페' and byamt.get(23500, [0]*5)[4] == '식비' and byamt.get(3200, [0]*5)[4] == '생활', [v[4] for v in vals])
    page.screenshot(path=f'{SHOTS}/07_ocr_confirm.png', full_page=False)
    cnt_before = J('window.__MYMONEY__.S.txs.length')
    check('OCR 결과는 즉시 저장되지 않음(확인 화면)', cnt_before == 4, cnt_before)
    # 수정 후 저장
    cands.nth(0).locator('[data-k=memo]').count()
    sheet().locator('[data-act=ocr-save]').click(); page.wait_for_timeout(500)
    check('확인 후 3건 저장', J('window.__MYMONEY__.S.txs.length') == 7)

    # 같은 이미지 재업로드 → 중복 안내
    tap('#addBtn'); sheet().locator('[data-act=tx-ocr]').click(); page.wait_for_timeout(600)
    st2 = page.locator('#ocrStatus').inner_text()
    check('OCR 엔진 캐시 후 "오프라인에서도 동작" 표시', '오프라인' in st2, st2)
    page.locator('#ocrFile').set_input_files(os.path.join(T, 'card_light.png'))
    page.wait_for_selector('.cand', timeout=120000)
    dups = page.locator('.cand.dup').count(); onc = J("document.querySelectorAll('.cand input[data-k=on]:checked').length")
    check('중복 거래 안내 + 기본 선택 해제', dups == 3 and onc == 0, (dups, onc))
    sheet().locator('[data-act=close]').click(); page.wait_for_timeout(300)

    # 다크모드 은행 캡처 (수입/지출, 잔액 줄 제외)
    tap('#addBtn'); sheet().locator('[data-act=tx-ocr]').click(); page.wait_for_timeout(400)
    page.locator('#ocrFile').set_input_files(os.path.join(T, 'bank_dark.png'))
    page.wait_for_selector('.sheet .cand, .sheet .banner b', timeout=120000); page.wait_for_timeout(300)
    cands = page.locator('.cand'); n = cands.count()
    vals = [(cands.nth(i).locator('[data-k=type]').input_value(), cands.nth(i).locator('[data-k=amount]').input_value(), cands.nth(i).locator('[data-k=merchant]').input_value(), cands.nth(i).locator('[data-k=date]').input_value(), cands.nth(i).locator('[data-k=time]').input_value(), cands.nth(i).locator('[data-k=category]').input_value()) for i in range(n)]
    print('OCR bank:', vals)
    check('OCR 은행(다크모드): 급여 +3,200,000 수입 / 택시 -12,800 지출, 잔액 줄 제외', n == 2 and ('income', '3,200,000') == vals[0][:2] and ('expense', '12,800') == vals[1][:2], vals)
    check('OCR 은행: 날짜 2026-10-10, 시간 09:00/12:31, 카테고리 급여/교통', n == 2 and vals[0][3] == '2026-10-10' and vals[0][4] == '09:00' and vals[1][4] == '12:31' and vals[0][5] == '급여' and vals[1][5] == '교통', vals)
    page.screenshot(path=f'{SHOTS}/07b_ocr_bank.png')
    sheet().locator('[data-act=ocr-manual]').click(); page.wait_for_timeout(400)
    check('OCR → 수동 입력 전환(값 이어받기)', num(sheet().locator('[name=amount]').input_value()) == 3200000)
    sheet().locator('[data-act=close]').click(); page.wait_for_timeout(300)

    # 9) 파서 단위 테스트
    cases = J('''(() => { const P = window.__MYMONEY__.parseReceiptText; return [
      P("2026.10.05\\n쿠팡 -32,900원\\n잔액 1,000,000원", "2026-10-13"),
      P("10/03 13:10 카카오페이 올리브영 15,000원\\n10/03 18:40 교촌치킨 22,000원", "2026-10-13"),
      P("합계 50,000원\\n카드번호 1234-****-****-5678\\n승인번호 12345678", "2026-10-13"),
      P("12월 30일\\n이마트 45,000원", "2026-01-05")
    ]})()''')
    check('파서: 은행 출금(쿠팡→쇼핑, 잔액 제외)', len(cases[0]) == 1 and cases[0][0]['amount'] == 32900 and cases[0][0]['category'] == '쇼핑' and cases[0][0]['date'] == '2026-10-05', cases[0])
    check('파서: 한 줄에 날짜·시간·가맹점·금액 2건', len(cases[1]) == 2 and cases[1][1]['time'] == '18:40' and cases[1][1]['category'] == '식비', cases[1])
    check('파서: 합계·카드번호·승인번호 줄 무시', len(cases[2]) == 0, cases[2])
    check('파서: 연도 없는 날짜의 연말 보정(1월 기준 12/30 → 작년)', cases[3][0]['date'] == '2025-12-30', cases[3])

    # 10) CSV / JSON 백업 → 삭제 → 복원
    csv = J('window.__MYMONEY__.buildCSV()')
    check('CSV: BOM+헤더+거래 7행', csv.startswith('﻿날짜,시간,유형') and len(csv.strip().split('\r\n')) == 8, len(csv.strip().split('\r\n')))
    snap = J('JSON.stringify(window.__MYMONEY__.backupPayload().data)')
    tap('[data-act=settings]'); page.wait_for_timeout(400)
    with page.expect_download() as dl:
        sheet().locator('[data-act=backup]').click()
    path = os.path.join(T, 'backup.json'); dl.value.save_as(path)
    bk = json.load(open(path, encoding='utf-8'))
    check('JSON 백업 파일 다운로드(계정·대출·목표·설정 포함)', bk['app'] == 'MY MONEY' and len(bk['data']['transactions']) == 7 and len(bk['data']['goals']) == 2 and len(bk['data']['loans']) == 1)
    page.screenshot(path=f'{SHOTS}/08_settings.png')
    with page.expect_download() as dl2:
        sheet().locator('[data-act=csv]').click()
    dl2.value.save_as(os.path.join(T, 'tx.csv'))
    # 전체 삭제 (이중 확인)
    sheet().locator('[data-act=wipe]').click(); page.locator('.dialog [data-r="1"]').click(); page.wait_for_timeout(200)
    page.locator('.dialog [data-r="1"]').click(); page.wait_for_selector('#onbF')
    check('전체 삭제(2단계 확인) 후 초기화면', J('window.__MYMONEY__.S.txs.length') == 0)
    page.locator('#onbRestore').set_input_files(path); page.wait_for_selector('.dialog'); page.locator('.dialog [data-r="1"]').click()
    page.wait_for_selector('#netWorth')
    snap2 = J('JSON.stringify(window.__MYMONEY__.backupPayload().data)')
    a, b = json.loads(snap), json.loads(snap2)
    a['settings'][0]['lastBackup'] = b['settings'][0]['lastBackup'] = 0
    for k in ['accounts','transactions','loans','goals']:
        a[k] = sorted(a[k], key=lambda x: x['id']); b[k] = sorted(b[k], key=lambda x: x['id'])
    diff = [k for k in a if a[k] != b[k]]
    if 'settings' in diff: print('settings diff', {kk:(a['settings'][0].get(kk), b['settings'][0].get(kk)) for kk in set(a['settings'][0])|set(b['settings'][0]) if a['settings'][0].get(kk)!=b['settings'][0].get(kk)})
    check('JSON 복원 → 데이터 완전 일치', not diff, diff)

    # 11) 새로고침 후 유지 + 오프라인
    page.reload(); page.wait_for_selector('#netWorth')
    check('새로고침 후 데이터 유지(IndexedDB)', J('window.__MYMONEY__.S.txs.length') == 7)
    sw = J('navigator.serviceWorker.ready.then(r=>!!r.active)')
    check('Service Worker 활성화', sw)
    page.reload(); page.wait_for_selector('#netWorth')
    ctx.set_offline(True)
    page.reload(); page.wait_for_selector('#netWorth', timeout=10000)
    check('오프라인에서 앱 실행·조회', page.locator('#netWorth').is_visible())
    tap('#addBtn'); page.wait_for_selector('.sheet [name=amount]'); sh = sheet()
    fill_money(sh, 'amount', '4500'); sh.locator('[data-act=tx-save]').click(); page.wait_for_timeout(400)
    check('오프라인 수동 거래 저장', J('window.__MYMONEY__.S.txs.length') == 8)
    tap('#addBtn'); sheet().locator('[data-act=tx-ocr]').click(); page.wait_for_timeout(600)
    st3 = page.locator('#ocrStatus').inner_text()
    check('오프라인 OCR 상태 표시', '오프라인' in st3, st3)
    page.locator('#ocrFile').set_input_files(os.path.join(T, 'card_light.png'))
    page.wait_for_selector('.cand', timeout=120000)
    check('오프라인 OCR 인식 동작(기기 내 처리)', page.locator('.cand').count() == 3)
    sheet().locator('[data-act=close]').click()
    ctx.set_offline(False)

    # 12) 다크 모드 / 넓은 화면
    page.emulate_media(color_scheme='dark'); tap('[data-tab=home]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/03_home_dark.png', full_page=True)
    bg = J("getComputedStyle(document.body).backgroundColor")
    check('다크모드 적용', bg == 'rgb(15, 16, 18)', bg)
    tap('[data-tab=history]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/09_history_dark.png', full_page=True)
    page.emulate_media(color_scheme='light')
    # 하단 탭바 safe area
    pad = J("getComputedStyle(document.querySelector('.tabbar')).paddingBottom")
    check('탭바 safe-area 패딩 적용(env)', 'env' in open(os.path.join(T, '..', 'style.css')).read() and pad is not None, pad)

    # 13) 거래 수정·삭제
    tap('[data-tab=history]'); page.locator('[data-act=tx-edit]').first.click(); sh = sheet()
    sh.locator('[data-act=tx-del]').click(); page.locator('.dialog [data-r="1"]').click(); page.wait_for_timeout(400)
    check('거래 삭제(확인 후)', J('window.__MYMONEY__.S.txs.length') == 7)

    check('콘솔 오류 없음', not errors, errors[:5])
    browser.close()

passed = sum(1 for r in results if r[1])
print(f'\n{passed}/{len(results)} passed')
json.dump(results, open(os.path.join(T, 'results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

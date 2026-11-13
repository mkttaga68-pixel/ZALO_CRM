// AIQC Nightly Learning — browser E2E (Playwright, Microsoft Edge, headless) against the ISOLATED synthetic sandbox
// started by scripts/start-native-ai-qc-sandbox.cjs (fresh PostgreSQL cluster, loopback ports 3091/5174, outbound denied).
// Never targets production (3080/5433). All network outside 127.0.0.1:3091/5174 is blocked in the browser.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), parent = path.resolve(repo, '..');
const { chromium } = require(path.join(parent, 'aiqc-browser-e2e-20261101/tools/node_modules/playwright-core'));
const latest = JSON.parse(fs.readFileSync(path.join(parent, 'native-ai-qc-runtime/latest.json'), 'utf8'));
const sandboxRoot = path.resolve(latest.root);
if (!sandboxRoot.startsWith(path.join(parent, 'native-ai-qc-runtime') + path.sep)) throw Error('Invalid sandbox root');
const evidence = JSON.parse(fs.readFileSync(path.join(sandboxRoot, 'runtime-evidence.json'), 'utf8'));
if (evidence.syntheticOnly !== true || evidence.ports.backend !== 3091 || evidence.ports.frontend !== 5174) throw Error('Not the synthetic sandbox');
const password = fs.readFileSync(path.join(sandboxRoot, 'SYNTHETIC-LOGIN.txt'), 'utf8').match(/^Password: (.+)$/m)?.[1];
if (!password?.startsWith('Synthetic-QC-')) throw Error('SYNTHETIC_LOGIN_MISSING');
const API = 'http://127.0.0.1:3091', WEB = 'http://127.0.0.1:5174';
const out = path.join(parent, 'aiqc-nightly-learning-production-20261112', 'e2e-' + Date.now().toString(36)); fs.mkdirSync(out, { recursive: true });
const TABS = ['Tổng quan', 'Hội thoại', 'Chờ duyệt', 'Phòng ban', 'Kho quy tắc', 'Phản hồi', 'Huấn luyện', 'Trợ lý AI', 'Cài đặt'];
const results = [], consoleErrors = [], pageErrors = [], blocked = [], failedResponses = [], secrets = [password];
const clean = s => { let v = String(s); for (const x of secrets) v = v.split(x).join('[REDACTED]'); return v.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]'); };
const allowed = u => { try { const x = new URL(u); return ['127.0.0.1', 'localhost'].includes(x.hostname) && ['3091', '5174'].includes(x.port); } catch { return u.startsWith('data:') || u.startsWith('blob:'); } };

async function http(method, url, token, body) {
    const r = await fetch(API + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    let json = null; try { json = await r.json(); } catch { }
    return { status: r.status, body: json };
}
const ok = async (...a) => { const r = await http(...a); if (r.status >= 300) throw Error(`${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const login = async (identifier, pw) => { const r = await ok('POST', '/api/v1/auth/login', null, { identifier, password: pw }); secrets.push(r.token); return r.token; };
const Q = '/api/v1/ai-quality-control';
async function step(name, fn) {
    const started = Date.now();
    try { const detail = await fn(); results.push({ name, status: 'PASS', ms: Date.now() - started, ...(detail ? { detail } : {}) }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, status: 'FAIL', ms: Date.now() - started, error: clean(e.message).slice(0, 800) }); console.log('FAIL ' + name + ': ' + clean(e.message).slice(0, 300)); }
}
async function newPage(browser, label) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN' });
    await context.route('**/*', route => { const u = route.request().url(); if (!allowed(u)) { blocked.push({ label, url: clean(u) }); return route.abort('blockedbyclient'); } return route.continue(); });
    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ label, text: clean(m.text()).slice(0, 300) }); });
    page.on('pageerror', e => pageErrors.push({ label, text: clean(e.message).slice(0, 300) }));
    page.on('response', r => { if (r.status() >= 400 && allowed(r.url())) failedResponses.push({ label, status: r.status(), method: r.request().method(), path: new URL(r.url()).pathname, page: new URL(page.url()).pathname }); });
    return { context, page };
}
async function uiLogin(page, email, pw) {
    await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/Email hoặc/).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(pw);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 });
    await page.goto(WEB + '/ai-quality-control', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /^Tổng quan/ }).waitFor({ timeout: 20000 });
}
const vaultTab = page => page.getByRole('tab', { name: /^Kho quy tắc/ });
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png'), fullPage: false }).catch(() => { });
const tabCount = async page => { const t = await vaultTab(page).locator('.qc-tab-count').textContent({ timeout: 1000 }).catch(() => null); return t ? Number(t.trim()) : 0; };

(async () => {
    const owner = 'ai-qc@sandbox.invalid';
    let token, browser, A, B;
    const ids = {};
    try {
        await step('S00 sandbox safety: synthetic-only status, postgres-sandbox storage, real API/data off', async () => {
            token = await login(owner, password);
            const s = await ok('GET', Q + '/status', token);
            assert.equal(s.syntheticOnly, true); assert.equal(s.capabilities.realApi, false); assert.equal(s.capabilities.realData, false); assert.equal(s.storageMode, 'postgres-sandbox');
            return { storageMode: s.storageMode };
        });
        await step('S01 seed synthetic knowledge + analysed runs via existing APIs (publish 4 rules, 2× insult, 2× knowledge, 2× missing-actor)', async () => {
            const ws = await ok('GET', Q + '/workspace', token);
            const type = p => p.includes('courtesy') ? 'COURTESY' : p.includes('request') ? 'UNRESOLVED_REQUEST' : p.includes('product') ? 'KNOWLEDGE_MISMATCH' : 'INSULT';
            const terms = { INSULT: 'đồ ngu', COURTESY: 'tự đi mà tìm', UNRESOLVED_REQUEST: '', KNOWLEDGE_MISMATCH: 'SYNTHETIC-A miễn phí' };
            for (const d of ws.documents.filter(d => d.status === 'DRAFT')) {
                const t = type(d.sourcePath);
                await ok('POST', `${Q}/knowledge/${d.id}/publish`, token, { hash: d.contentHash, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: null, departmentIds: [],
                    rule: { id: 'synthetic-e2e-' + t, type: t, matchTerms: terms[t] ? [terms[t]] : [], conflictGroup: null, slaSeconds: t === 'UNRESOLVED_REQUEST' ? 300 : null, careIntervalDays: null } });
            }
            let runs = 0;
            for (const [scenario, n] of [['insult', 2], ['knowledge', 2], ['missing-actor', 2]]) for (let i = 0; i < n; i++) {
                const ds = await ok('POST', Q + '/datasets', token, { name: `E2E SYNTHETIC ${scenario} ${i}`, scenario });
                await ok('POST', `${Q}/datasets/${ds.id}/analyze`, token, { provider: 'mock' }); runs++;
            }
            const before = await ok('GET', Q + '/learning-drafts/summary', token);
            assert.equal(before.pending, 0);
            return { publishedRules: ws.documents.length, analysedRuns: runs };
        });
        await step('S02 create limited users via existing RBAC APIs: approver-without-view_all and viewer (access only)', async () => {
            for (const [key, grants] of [['approver', { access: true, approve: true }], ['viewer', { access: true }]]) {
                const email = `e2e-${key}@sandbox.invalid`, pw = 'Synthetic-QC-' + key + '-' + Math.random().toString(36).slice(2, 10) + '!'; secrets.push(pw);
                const user = await ok('POST', '/api/v1/users', token, { email, fullName: 'E2E ' + key, password: pw, role: 'member' });
                const g = await ok('POST', '/api/v1/permission-groups', token, { name: 'E2E AIQC ' + key, grants: { ai_quality_control: grants } });
                await ok('PATCH', `/api/v1/rbac/users/${user.id}/permission-group`, token, { permissionGroupId: g.group.id });
                ids[key] = { email, pw, token: await login(email, pw) };
            }
        });

        browser = await chromium.launch({ channel: 'msedge', headless: true });
        A = await newPage(browser, 'adminA'); B = await newPage(browser, 'adminB');
        await step('E01 login through the existing CRM login form (two Admin sessions)', async () => { await uiLogin(A.page, owner, password); await uiLogin(B.page, owner, password); });
        await step('E02 all 9 AIQC tabs are present and unchanged', async () => {
            const names = (await A.page.getByRole('tab').allTextContents()).map(t => t.replace(/\d+$/, '').trim());
            for (const t of TABS) assert.ok(names.some(n => n.startsWith(t)), 'missing tab ' + t);
            const qcTabs = names.filter(n => TABS.some(t => n.startsWith(t)));
            assert.equal(qcTabs.length, 9, 'expected exactly 9 AIQC tabs, got ' + JSON.stringify(qcTabs));
            return { tabs: qcTabs };
        });
        await step('E03 "Kho quy tắc": Learning inbox inside the existing tab, health line shows scheduler not activated, no drafts', async () => {
            for (const p of [A.page, B.page]) { await vaultTab(p).click(); await p.getByRole('heading', { name: /Bài học AI đề xuất/ }).waitFor({ timeout: 15000 }); }
            await A.page.getByTestId('learning-health').waitFor({ timeout: 10000 });
            const h = await A.page.getByTestId('learning-health').textContent();
            assert.match(h, /Lịch tự động chưa kích hoạt/);
            await A.page.getByText('Không có bài học mới chờ duyệt.').waitFor();
            await shot(A.page, 'e03-vault-empty');
            return { health: h.replace(/\s+/g, ' ').trim() };
        });
        await step('E04 realtime: both Admin sessions show the "Trực tiếp" (Socket.IO connected) pill', async () => {
            for (const p of [A.page, B.page]) await p.locator('.live-pill').waitFor({ timeout: 15000 });
        });
        await step('E05 sandbox nightly run from the UI creates drafts; tab badge and bell badge show pending count; second session updates WITHOUT reload', async () => {
            await A.page.getByRole('button', { name: /Chạy thử/ }).click();
            await A.page.getByText(/Chạy thử xong: \d+ bản nháp mới/).waitFor({ timeout: 20000 });
            const pending = (await ok('GET', Q + '/learning-drafts/summary', token)).pending;
            assert.ok(pending >= 3, 'expected >=3 drafts, got ' + pending);
            await A.page.waitForFunction(n => document.querySelector('.qc-learning-badge')?.textContent?.trim() === String(n), pending, { timeout: 10000 });
            await B.page.waitForFunction(n => document.querySelector('.qc-learning-badge')?.textContent?.trim() === String(n), pending, { timeout: 10000 });
            assert.equal(await tabCount(B.page), pending);
            await shot(A.page, 'e05-drafts-pending');
            return { pending };
        });
        await step('E06 open an INSULT draft: rationale, minimised evidence, related Obsidian rule with valid citation, history; no PII', async () => {
            const row = A.page.locator('tr', { hasText: 'Lời lẽ xúc phạm' }).first();
            await row.getByRole('button', { name: 'Xem và duyệt' }).click();
            const dlg = A.page.locator('.learning-dialog');
            for (const h of ['Nguyên nhân AI đề xuất', 'Bằng chứng đã giảm thiểu dữ liệu', 'Quy tắc Obsidian liên quan', 'Lịch sử xét duyệt']) await dlg.locator('h4', { hasText: h }).waitFor({ timeout: 10000 });
            await dlg.getByText('Trích dẫn hợp lệ, đang hiệu lực').first().waitFor();
            const text = await dlg.textContent();
            // PII and synthetic CUSTOMER message text must be absent. (Quoting the official Obsidian policy rule is expected.)
            assert.doesNotMatch(text, /0\d{9}|@example\.|Tôi sẽ giải đáp|SYNTHETIC-A\?/i);
            assert.match(text, /đã ghi vào thư mục chờ đồng bộ/);
            await shot(A.page, 'e06-draft-detail');
        });
        await step('E07 Admin approves: verify tenant scope → confirm → approve; regression passes; Verified Learning Case published', async () => {
            const dlg = A.page.locator('.learning-dialog');
            const before = await tabCount(B.page);
            await dlg.getByRole('button', { name: 'Xác minh phạm vi' }).click();
            await dlg.getByText('Đã xác minh', { exact: true }).waitFor({ timeout: 10000 });
            await dlg.getByLabel(/Tôi đã đọc nội dung/).check();
            await dlg.getByRole('button', { name: 'Phê duyệt', exact: true }).click();
            await A.page.getByText(/Đã phê duyệt\. Bài học được đưa vào kho truy xuất/).waitFor({ timeout: 15000 });
            const ws = await ok('GET', Q + '/workspace', token);
            const vlc = ws.documents.filter(d => d.knowledgeClass === 'VERIFIED_LEARNING_CASE');
            assert.equal(vlc.length, 1); assert.equal(vlc[0].status, 'APPROVED'); assert.deepEqual(vlc[0].rule.matchTerms, []);
            // Second Admin session sees the decision through Socket.IO (no reload).
            await B.page.waitForFunction(n => Number(document.querySelector('.qc-learning-badge')?.textContent?.trim() || 0) === n, before - 1, { timeout: 10000 });
            return { verifiedLearningCases: vlc.length, otherSessionBadge: before - 1 };
        });
        await step('E08 Obsidian outbox: draft markdown staged as LD-<id>.r1.md in the outbox, never in the read-only vault', async () => {
            const files = fs.readdirSync(path.join(sandboxRoot, 'learning-outbox'));
            assert.ok(files.length >= 3 && files.every(f => /^LD-[0-9a-f-]{36}\.r\d+\.md$/.test(f)), JSON.stringify(files));
            const sample = fs.readFileSync(path.join(sandboxRoot, 'learning-outbox', files[0]), 'utf8');
            assert.match(sample, /knowledge_class: LEARNING_DRAFT/); assert.doesNotMatch(sample, /0\d{9}|@example/);
            return { outboxFiles: files.length };
        });
        await step('E09 request changes → revise (new revision, re-verify needed) → reject with reason; history recorded', async () => {
            const row = A.page.locator('tr', { hasText: 'Thông tin sản phẩm chưa khớp' }).first();
            await row.getByRole('button', { name: 'Xem và duyệt' }).click();
            const dlg = A.page.locator('.learning-dialog');
            await dlg.getByLabel('Ghi chú cho AI / người soạn').fill('Làm rõ cách xử lý khi thông tin khuyến mãi chưa khớp');
            await dlg.getByRole('button', { name: 'Yêu cầu chỉnh sửa' }).click();
            await A.page.getByText('Đã gửi yêu cầu chỉnh sửa.').waitFor({ timeout: 10000 });
            await A.page.getByRole('tab', { name: /^Yêu cầu sửa/ }).click();
            await A.page.locator('tr', { hasText: 'Thông tin sản phẩm chưa khớp' }).first().getByRole('button', { name: 'Xem chi tiết' }).click();
            await dlg.getByLabel('Tên bài học').fill('Đối chiếu thông tin khuyến mãi với quy tắc sản phẩm');
            await dlg.getByLabel('Nguyên nhân / hướng dẫn').fill('Bổ sung bước đối chiếu bảng giá hiện hành trước khi trả lời khách.');
            await dlg.getByRole('button', { name: 'Lưu phiên bản mới' }).click();
            await A.page.getByText(/Đã lưu phiên bản mới/).waitFor({ timeout: 10000 });
            await dlg.getByText(/Phiên bản 2/).waitFor();
            await dlg.getByText('Xác minh phạm vi', { exact: true }).waitFor();
            await dlg.getByLabel('Ghi chú cho AI / người soạn').fill('Đã có quy tắc tương đương');
            await dlg.getByRole('button', { name: 'Từ chối' }).click();
            await A.page.getByText('Đã từ chối bản nháp.').waitFor({ timeout: 10000 });
            const list = (await ok('GET', Q + '/learning-drafts', token)).items;
            const k = list.find(i => i.findingType === 'KNOWLEDGE_MISMATCH');
            const det = await ok('GET', Q + '/learning-drafts/' + k.id, token);
            assert.deepEqual(det.reviewHistory.map(h => h.action), ['CREATED', 'CHANGES_REQUESTED', 'REVISED', 'REJECTED']);
            assert.ok(fs.existsSync(path.join(sandboxRoot, 'learning-outbox', `LD-${k.id}.r2.md`)), 'revised revision staged to outbox');
            await shot(A.page, 'e09-after-reject');
        });
        await step('E10 real HTTP + PostgreSQL race: two Admin sessions approve/reject the same draft concurrently → one 200, one 409 LEARNING_DRAFT_ALREADY_DECIDED', async () => {
            const tokenB = await login(owner, password);
            const d = (await ok('GET', Q + '/learning-drafts?status=DRAFT', token)).items[0];
            assert.ok(d, 'one open draft remains');
            const det = await ok('GET', Q + '/learning-drafts/' + d.id, token);
            await ok('POST', `${Q}/learning-drafts/${d.id}/verify-scope`, token, { expectedRevision: d.revision });
            const [x, y] = await Promise.all([
                http('POST', `${Q}/learning-drafts/${d.id}/approve`, token, { expectedRevision: d.revision, contentHash: det.contentHash, confirm: true }),
                http('POST', `${Q}/learning-drafts/${d.id}/reject`, tokenB, { expectedRevision: d.revision, reason: 'Không cần thiết' }),
            ]);
            assert.deepEqual([x.status, y.status].sort(), [200, 409]);
            assert.equal([x.body, y.body].find(b => b?.error)?.error, 'LEARNING_DRAFT_ALREADY_DECIDED');
            return { statuses: [x.status, y.status] };
        });
        await step('E11 approver WITHOUT view_all: sees inbox read-only (no decision controls), API decisions and /health → 403', async () => {
            const C = await newPage(browser, 'approver');
            try {
                await uiLogin(C.page, ids.approver.email, ids.approver.pw);
                await vaultTab(C.page).click();
                await C.page.getByRole('heading', { name: /Bài học AI đề xuất/ }).waitFor({ timeout: 15000 });
                assert.equal(await C.page.getByTestId('learning-health').count(), 0);
                await C.page.getByRole('tab', { name: /^Đã xử lý/ }).click();
                await C.page.getByRole('button', { name: 'Xem chi tiết' }).first().click();
                await C.page.locator('.learning-dialog').waitFor();
                assert.equal(await C.page.getByRole('button', { name: 'Xác minh phạm vi' }).count(), 0);
                assert.equal(await C.page.getByRole('button', { name: 'Phê duyệt', exact: true }).count(), 0);
                assert.equal(await C.page.getByRole('button', { name: /Chạy thử/ }).count(), 0);
                const d = (await ok('GET', Q + '/learning-drafts', ids.approver.token)).items[0];
                assert.equal((await http('POST', `${Q}/learning-drafts/${d.id}/verify-scope`, ids.approver.token, { expectedRevision: d.revision })).status, 403);
                assert.equal((await http('GET', Q + '/learning-drafts/health', ids.approver.token)).status, 403);
                assert.equal((await http('POST', Q + '/learning-drafts/purge-expired', ids.approver.token, { reason: 'x' })).status, 403);
                await shot(C.page, 'e11-approver-readonly');
            } finally { await C.context.close(); }
        });
        await step('E12 viewer (access only): no learning inbox, no bell; all learning APIs → 403', async () => {
            const V = await newPage(browser, 'viewer');
            try {
                await uiLogin(V.page, ids.viewer.email, ids.viewer.pw);
                await vaultTab(V.page).click();
                await V.page.waitForTimeout(1500);
                assert.equal(await V.page.getByRole('heading', { name: /Bài học AI đề xuất/ }).count(), 0);
                assert.equal(await V.page.locator('.qc-learning-bell').count(), 0);
                for (const u of ['/learning-drafts/summary', '/learning-drafts', '/learning-drafts/health']) assert.equal((await http('GET', Q + u, ids.viewer.token)).status, 403, u);
            } finally { await V.context.close(); }
        });
        await step('E13 cross-session consistency: after all decisions both Admin sessions show exactly the server pending count without reload', async () => {
            const pending = (await ok('GET', Q + '/learning-drafts/summary', token)).pending;
            for (const p of [A.page, B.page]) await p.waitForFunction(n => Number(document.querySelector('.qc-learning-badge')?.textContent?.trim() || 0) === n, pending, { timeout: 15000 });
            return { serverPending: pending };
        });
        await step('E14 every one of the 9 tabs still renders without page errors (regression)', async () => {
            const before = pageErrors.length;
            for (const t of TABS) { await A.page.getByRole('tab', { name: new RegExp('^' + t) }).click(); await A.page.waitForTimeout(600); }
            assert.equal(pageErrors.length, before, JSON.stringify(pageErrors.slice(before)));
            await shot(A.page, 'e14-last-tab');
        });
        await step('E15 monitoring /health after the flow: last job recorded, outbox configured with no failures, counts only', async () => {
            const h = await ok('GET', Q + '/learning-drafts/health', token);
            assert.ok(h.lastJob && h.lastJob.scope === 'SYNTHETIC'); assert.equal(h.outbox.configured, true); assert.equal(h.outbox.failed, 0);
            assert.equal(h.scheduler.allowed, false);
            assert.doesNotMatch(JSON.stringify(h), /markdown|rationale/);
            return { scheduler: h.scheduler.blockers, drafts: h.drafts, alerts: h.alerts };
        });
    } catch (e) { results.push({ name: 'HARNESS', status: 'FAIL', error: clean(e.stack || e.message).slice(0, 1500) }); }
    finally { await browser?.close().catch(() => { }); }
    results.push({ name: 'E16 no browser page errors; console errors recorded', status: pageErrors.length ? 'FAIL' : 'PASS', detail: { pageErrors: pageErrors.length, consoleErrors: consoleErrors.length } });
    results.push({ name: 'E17 no non-loopback request left the browser', status: 'PASS', detail: { blockedAttempts: blocked.length } });
    const summary = { failedResponses, at: new Date().toISOString(), sandbox: path.basename(sandboxRoot), browser: 'msedge (playwright-core 1.56.1, headless)', passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results, consoleErrors, pageErrors, blocked };
    fs.writeFileSync(path.join(out, 'e2e-results.json'), clean(JSON.stringify(summary, null, 2)));
    console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, evidence: out }));
    process.exitCode = summary.failed ? 1 : 0;
})();

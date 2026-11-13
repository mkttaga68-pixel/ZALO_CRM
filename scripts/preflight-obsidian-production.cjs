// Read-only inspection. Never bootstraps CRM or connects to a database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const evidence = path.resolve(repo, '..', 'obsidian-production-preflight-20261101');
const vault = 'C:\\Users\\ADMIN\\Downloads\\ZALO_CRM_AI_BRAIN';
fs.mkdirSync(evidence, { recursive: true });
const docker = args => {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (r.status !== 0) throw Error('DOCKER_PREFLIGHT_FAILED');
  return r.stdout.trim();
};
const identity = () => JSON.parse(docker(['inspect', '--format', '{"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}}}', 'zalo-crm-app']));
const scan = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (entry.isSymbolicLink()) throw Error('VAULT_SYMLINK_REQUIRES_REVIEW');
  const file = path.join(dir, entry.name);
  if (entry.isDirectory()) return scan(file);
  return entry.name.endsWith('.md') ? [{ path: path.relative(vault, file).replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }] : [];
}).sort((a, b) => a.path.localeCompare(b.path));
const before = identity(), hostBefore = scan(vault);
const program = `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hashes=[],walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('SYMLINK');if(e.isDirectory())walk(p);else if(e.name.endsWith('.md'))hashes.push({path:path.relative('/knowledge/obsidian',p),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}};walk('/knowledge/obsidian');
let denied=false;try{const fd=fs.openSync(path.join('/knowledge/obsidian',hashes[0].path),'r+');fs.closeSync(fd);}catch(e){denied=e.code==='EROFS'||e.code==='EACCES';}if(!denied)throw Error('MOUNT_NOT_READ_ONLY');
const code={};for(const name of ['knowledge','providers','analysis']){const file='/app/dist/modules/ai-quality-control/'+name+'.js';code[name]=fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;}
console.log(JSON.stringify({hashes,existingFileWriteHandleDenied:denied,code}));`;
const container = JSON.parse(docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--mount', `type=bind,source=${vault},target=/knowledge/obsidian,readonly`, '--entrypoint', 'node', before.image, '-e', program]));
const after = identity(), hostAfter = scan(vault);
const contentMatches = hostBefore.length === container.hashes.length && hostBefore.every(h => container.hashes.some(c => c.path === h.path && c.sha256 === h.sha256));
const localCode = {};
for (const name of ['knowledge','providers','analysis']) {
  const file = path.join(repo, 'backend/dist/modules/ai-quality-control', name + '.js');
  localCode[name] = fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}
const result = { checkedAt: new Date().toISOString(), before, after, productionUnchanged: JSON.stringify(before) === JSON.stringify(after), vault, target: '/knowledge/obsidian', markdownCount: hostBefore.length, contentMatches, hostHashesUnchanged: JSON.stringify(hostBefore) === JSON.stringify(hostAfter), existingFileWriteHandleDenied: container.existingFileWriteHandleDenied, productionImageCode: container.code, localBuiltCode: localCode, imageMatchesLocalBuild: Object.keys(localCode).every(k => !!localCode[k] && localCode[k] === container.code[k]), productionVaultMounted: false, databaseAccessed: false, outboundAI: false, approvalsPerformed: false, hashes: hostBefore };
fs.writeFileSync(path.join(evidence, 'vault-readonly.json'), JSON.stringify(result, null, 2));
if (!result.productionUnchanged || !contentMatches || !result.hostHashesUnchanged) throw Error('PREFLIGHT_ASSERTION_FAILED');
console.log(JSON.stringify({ ...result, hashes: '[saved in evidence]' }, null, 2));

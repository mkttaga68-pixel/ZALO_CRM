// Host-side runner. Requires Docker access and read access to the named Vault.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),vault='C:\\Users\\ADMIN\\Downloads\\ZALO_CRM_AI_BRAIN';
const evidence=path.resolve(repo,'..','obsidian-vault-sandbox-evidence-20261101');
fs.mkdirSync(evidence,{recursive:true});
const run=args=>{const result=spawnSync('docker',args,{cwd:repo,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});if(result.status!==0)throw Error('Docker verification failed: '+String(result.stderr||result.stdout||result.error?.message).slice(0,1500));return result.stdout.trim();};
const before=JSON.parse(run(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}}}','zalo-crm-app']));
const image=before.image; // Verify precisely the image already running in CRM.
const result=JSON.parse(run(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,size=64m,mode=1777',
 '--mount',`type=bind,source=${vault},target=/knowledge/obsidian,readonly`,
 '--mount',`type=bind,source=${path.join(__dirname,'verify-obsidian-vault-sandbox.mjs')},target=/verify-obsidian.mjs,readonly`,
 '--entrypoint','node',image,'/verify-obsidian.mjs']));
const after=JSON.parse(run(['inspect','--format','{"id":{{json .Id}},"image":{{json .Image}},"started":{{json .State.StartedAt}}}','zalo-crm-app']));
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Production identity changed during verification; investigate');
const mounts=JSON.parse(run(['inspect','--format','{{json .Mounts}}','zalo-crm-app']));
result.productionVaultMounted=mounts.some(m=>m.Destination==='/knowledge/obsidian');
result.productionContainerUnchanged=true;result.image=image;result.hostVault=vault;
result.testScriptSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'verify-obsidian-vault-sandbox.mjs'))).digest('hex');
fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));

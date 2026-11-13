// Explicit additive AIQC migration. Never called at application boot. No CRM message reads.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Pool}=(()=>{try{return require('pg');}catch{return require('../backend/node_modules/pg');}})();
const apply=process.argv.includes('--apply');
if(!apply&&!process.argv.includes('--check'))throw Error('Use --check or --apply');
const packaged=path.resolve(__dirname,'../prisma/migrations');
const root=process.env.AI_QC_MIGRATION_ROOT||(fs.existsSync(packaged)?packaged:path.resolve(__dirname,'../backend/prisma/migrations'));
const migrations=['20261111140000_ai_qc_department_monitor_config','20261111163000_ai_qc_department_controls','20261111170000_ai_qc_continuous_local','20261111190000_ai_qc_department_schedule'];
(async()=>{const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const c=await pool.connect();try{
  if(!apply){const r=await c.query("SELECT to_regclass('public.ai_qc_department_monitor_config') IS NOT NULL AS configured,to_regclass('public.ai_qc_department_monitor_control') IS NOT NULL AS control");console.log(JSON.stringify(r.rows[0]));return;}
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('aiqc-department-schema',0))");
  await c.query('CREATE TABLE IF NOT EXISTS ai_qc_department_schema_migration(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for(const id of migrations){const sql=fs.readFileSync(path.join(root,id,'migration.sql'),'utf8'),hash=crypto.createHash('sha256').update(sql).digest('hex');
    const old=await c.query('SELECT sha256 FROM ai_qc_department_schema_migration WHERE id=$1',[id]);
    if(old.rows.length){if(old.rows[0].sha256!==hash)throw Error('MIGRATION_CHECKSUM_MISMATCH');continue;}
    // An existing table without our ledger may be an earlier manually installed draft; do not guess its version.
    if(id===migrations[0]&&(await c.query("SELECT to_regclass('public.ai_qc_department_monitor_config') AS name")).rows[0].name)throw Error('UNREGISTERED_DEPARTMENT_SCHEMA_REQUIRES_REVIEW');
    await c.query(sql);await c.query('INSERT INTO ai_qc_department_schema_migration(id,sha256) VALUES($1,$2)',[id,hash]);
  }
  await c.query('COMMIT');console.log(JSON.stringify({applied:true,migrations,scansStarted:0}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('AIQC_DEPARTMENT_MIGRATION_FAILED',e.code||e.message);process.exitCode=1;}finally{c.release();await pool.end();}})();

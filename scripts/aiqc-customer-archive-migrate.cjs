// Explicit additive migration for "Lưu trữ tin nhắn" (customer message archive). Never called at application boot.
// Usage:  DATABASE_URL=... node scripts/aiqc-customer-archive-migrate.cjs --check | --apply
// Inside the app container:  node scripts/aiqc-customer-archive-migrate.cjs --apply   (DATABASE_URL already set)
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Pool}=(()=>{try{return require('pg');}catch{return require('../backend/node_modules/pg');}})();
const apply=process.argv.includes('--apply');
if(!apply&&!process.argv.includes('--check'))throw Error('Use --check or --apply');
const packaged=path.resolve(__dirname,'../prisma/migrations');
const root=process.env.AI_QC_MIGRATION_ROOT||(fs.existsSync(packaged)?packaged:path.resolve(__dirname,'../backend/prisma/migrations'));
const migrations=['20261113200000_ai_qc_customer_message_archive'];
(async()=>{const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const c=await pool.connect();try{
  const state=async()=>(await c.query("SELECT to_regclass('public.ai_qc_customer_message_archive') IS NOT NULL AS archive,to_regclass('public.ai_qc_customer_archive_run') IS NOT NULL AS runs")).rows[0];
  if(!apply){console.log(JSON.stringify(await state()));return;}
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SELECT pg_advisory_xact_lock(hashtextextended('aiqc-customer-archive-schema',0))");
  await c.query('CREATE TABLE IF NOT EXISTS ai_qc_customer_archive_schema_migration(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const applied=[];
  for(const id of migrations){const sql=fs.readFileSync(path.join(root,id,'migration.sql'),'utf8'),hash=crypto.createHash('sha256').update(sql).digest('hex');
    const old=await c.query('SELECT sha256 FROM ai_qc_customer_archive_schema_migration WHERE id=$1',[id]);
    if(old.rows.length){if(old.rows[0].sha256!==hash)throw Error('MIGRATION_CHECKSUM_MISMATCH');continue;}
    // A table without our ledger may be a manual draft; never guess its shape.
    const s=await state();if(s.archive||s.runs)throw Error('UNREGISTERED_CUSTOMER_ARCHIVE_SCHEMA_REQUIRES_REVIEW');
    await c.query(sql);await c.query('INSERT INTO ai_qc_customer_archive_schema_migration(id,sha256) VALUES($1,$2)',[id,hash]);applied.push(id);
  }
  await c.query('COMMIT');console.log(JSON.stringify({applied,state:await state()}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('AIQC_CUSTOMER_ARCHIVE_MIGRATION_FAILED',e.code||e.message);process.exitCode=1;}finally{c.release();await pool.end();}})();

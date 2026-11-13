import { QcError } from './contracts.js';

export type QcStorageMode = 'memory' | 'postgres-sandbox' | 'application';
export function qcStorageMode(env:NodeJS.ProcessEnv=process.env):QcStorageMode {
  const value=env.AI_QC_STORAGE || (env.NODE_ENV==='production'?'application':'memory');
  if(!['memory','postgres-sandbox','application'].includes(value))throw new QcError('AI_QC_STORAGE_CONFIG_INVALID',503);
  if(env.NODE_ENV==='production'&&value!=='application')throw new QcError('AI_QC_PERSISTENT_APPLICATION_STORAGE_REQUIRED',503);
  return value as QcStorageMode;
}

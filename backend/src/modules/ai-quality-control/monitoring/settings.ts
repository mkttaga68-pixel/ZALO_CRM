import {QcError} from '../contracts.js';
import {syntheticQcSandbox} from '../sandbox-profile.js';
import type {MonitoringSettings} from './contracts.js';
export function monitoringSettings(env:NodeJS.ProcessEnv=process.env,verified=false):MonitoringSettings {
 const enabled=env.AI_QC_AUTO_MONITOR_ENABLED==='true';
 if(enabled&&(!verified||env.NODE_ENV!=='test'||env.AI_QC_REAL_DATA_ENABLED!=='false'||env.AI_QC_REAL_API_ENABLED!=='false'||env.AI_QC_OUTBOUND_TEST_APPROVED!=='false'||env.AI_QC_REAL_DATA_OUTBOUND_APPROVED!=='false'||env.AI_QC_AUTO_MONITOR_SYNTHETIC_ONLY==='false'))throw new QcError('MONITORING_SYNTHETIC_PROOF_REQUIRED',503);
 return {enabled,syntheticOnly:true,leaseMs:30000,maxAttempts:4,backoffMs:1000,pollMs:1000};
}
export function runtimeMonitoringSettings(){return monitoringSettings(process.env,syntheticQcSandbox());}

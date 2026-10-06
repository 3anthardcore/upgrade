export const ANALYSIS_MODEL='gpt-6-astra';
export function responseOptions(role){if(!['analysis','review'].includes(role))throw Error('UNKNOWN_MODEL_ROLE');return {model:ANALYSIS_MODEL,reasoning:{effort:'low'},max_output_tokens:role==='analysis'?6144:4096,store:false};}

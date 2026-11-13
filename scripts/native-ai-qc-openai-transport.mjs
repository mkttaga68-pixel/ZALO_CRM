// Testable, API-specific wrapper around a captured fetch. No global mutations here.
export function createOpenAiOnlyFetch({enabled,model,resolve,publicAddress,pin,fetch:transport}){
  return async(input,init={})=>{
    const request=input instanceof Request?input:null,url=new URL(request?request.url:String(input));
    if(!enabled||url.origin!=='https://api.openai.com'||url.pathname!=='/v1/responses'||url.search||url.hash||url.username||url.password)throw Error('OPENAI_SANDBOX_DESTINATION_DENIED');
    const method=String(init.method??request?.method??'GET').toUpperCase();if(method!=='POST')throw Error('OPENAI_SANDBOX_METHOD_DENIED');
    const text=typeof init.body==='string'?init.body:request?await request.text():'';
    if(Buffer.byteLength(text)>1024*1024)throw Error('OPENAI_SANDBOX_BODY_LIMIT');
    let body,source;try{body=JSON.parse(text);source=JSON.parse(body.input);}catch{throw Error('OPENAI_SANDBOX_BODY_INVALID');}
    if(body.model!==model||body.store!==false||body.tools!==undefined||body.text?.format?.type!=='json_schema'||body.text?.format?.strict!==true||
       !['native_ai_quality_control','native_qc_manager_answer'].includes(body.text?.format?.name)||
       !(source.conversation?.source==='SERVER_SYNTHETIC'||source.syntheticOnly===true))throw Error('OPENAI_SANDBOX_CONTRACT_DENIED');
    const answers=await resolve('api.openai.com');if(!answers.length||answers.some(a=>!publicAddress(a.address)))throw Error('OPENAI_SANDBOX_DNS_DENIED');
    const selected=answers.find(a=>a.family===4);if(!selected)throw Error('OPENAI_SANDBOX_PUBLIC_IPV4_REQUIRED');
    pin(selected.address);
    const headers=new Headers(init.headers??request?.headers);headers.delete('host');
    const response=await transport(url.href,{method:'POST',headers,body:text,signal:init.signal??request?.signal,redirect:'error'});
    if(response.status>=300&&response.status<400)throw Error('OPENAI_SANDBOX_REDIRECT_DENIED');
    return response;
  };
}

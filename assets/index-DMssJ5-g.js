(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`clawsembly-host-broker`,t=1,n=`keys`,r=`credentials`,i=`credential-master-v1`,a=16*1024,o;function s(e){return new Promise((t,n)=>{e.addEventListener(`success`,()=>t(e.result),{once:!0}),e.addEventListener(`error`,()=>n(e.error??Error(`IndexedDB request failed`)),{once:!0})})}function c(e){return new Promise((t,n)=>{e.addEventListener(`complete`,()=>t(),{once:!0}),e.addEventListener(`abort`,()=>n(e.error??Error(`IndexedDB transaction aborted`)),{once:!0}),e.addEventListener(`error`,()=>n(e.error??Error(`IndexedDB transaction failed`)),{once:!0})})}async function l(){if(!globalThis.indexedDB)throw Error(`IndexedDB is unavailable in this browser`);let i=indexedDB.open(e,t);return i.addEventListener(`upgradeneeded`,()=>{let e=i.result;e.objectStoreNames.contains(n)||e.createObjectStore(n),e.objectStoreNames.contains(r)||e.createObjectStore(r,{keyPath:`provider`})}),s(i)}async function u(e,t){let n=await l();try{let r=n.transaction(e,`readonly`),i=c(r),a=await s(r.objectStore(e).get(t));return await i,a}finally{n.close()}}async function d(e,t,n){let r=await l();try{let i=r.transaction(e,`readwrite`),a=c(i),o=i.objectStore(e);n===void 0?o.put(t):o.put(t,n),await a}finally{r.close()}}async function f(e,t,n){let r=await l();try{let i=r.transaction(e,`readwrite`),a=c(i);i.objectStore(e).add(t,n),await a}finally{r.close()}}async function p(e,t){let n=await l();try{let r=n.transaction(e,`readwrite`),i=c(r);r.objectStore(e).delete(t),await i}finally{n.close()}}async function m(){let e=await u(n,i);if(e){if(e.type!==`secret`||e.extractable||e.algorithm.name!==`AES-GCM`)throw Error(`stored credential key does not match the vault policy`);return e}let t=await crypto.subtle.generateKey({name:`AES-GCM`,length:256},!1,[`encrypt`,`decrypt`]);try{await f(n,t,i)}catch(e){if(!(e instanceof DOMException)||e.name!==`ConstraintError`)throw e}let r=await u(n,i);if(!r)throw Error(`credential key was not retained by IndexedDB`);return r}async function h(){o??=m();try{return await o}catch(e){throw o=void 0,e}}function g(e){return new TextEncoder().encode(`clawsembly:credential:v1:${e}`)}function _(e){let t=new Uint8Array(e.byteLength);return t.set(e),t.buffer}function v(e,t){if(t.byteLength===0||t.byteLength>e.byteLength)return!1;outer:for(let n=0;n<=e.byteLength-t.byteLength;n+=1){for(let r=0;r<t.byteLength;r+=1)if(e[n+r]!==t[r])continue outer;return!0}return!1}function y(e,t){if(e){if(e.version!==1||e.provider!==t||e.algorithm!==`AES-GCM`||!(e.iv instanceof ArrayBuffer)||e.iv.byteLength!==12||!(e.ciphertext instanceof ArrayBuffer)||e.ciphertext.byteLength<=16||!Number.isFinite(Date.parse(e.createdAt))||!Number.isFinite(Date.parse(e.updatedAt)))throw Error(`stored credential record is invalid`);return e}}async function b(e,t){let n=new TextEncoder().encode(t);if(t.trim().length===0)throw Error(`credential is empty`);if(n.byteLength>a)throw Error(`credential exceeds the 16 KB safety limit`);let i=await h(),o=crypto.getRandomValues(new Uint8Array(12)),s=await crypto.subtle.encrypt({name:`AES-GCM`,iv:o,additionalData:g(e),tagLength:128},i,n),c=y(await u(r,e),e),l=new Date().toISOString(),f={version:1,provider:e,algorithm:`AES-GCM`,iv:_(o),ciphertext:s,createdAt:c?.createdAt??l,updatedAt:l};await d(r,f);let m=y(await u(r,e),e);if(!m||v(new Uint8Array(m.ciphertext),n))throw await p(r,e),Error(`credential ciphertext verification failed`);let b=await crypto.subtle.decrypt({name:`AES-GCM`,iv:new Uint8Array(m.iv),additionalData:g(e),tagLength:128},i,m.ciphertext);if(new TextDecoder(`utf-8`,{fatal:!0}).decode(b)!==t)throw await p(r,e),Error(`credential round-trip verification failed`);return{provider:e,algorithm:f.algorithm,createdAt:f.createdAt,updatedAt:f.updatedAt}}async function x(e){let t=y(await u(r,e),e);return t?{provider:e,algorithm:t.algorithm,createdAt:t.createdAt,updatedAt:t.updatedAt}:void 0}async function S(e,t){let n=y(await u(r,e),e);if(!n)throw Error(`${e} credential is not stored`);let i=await h(),a=await crypto.subtle.decrypt({name:`AES-GCM`,iv:new Uint8Array(n.iv),additionalData:g(e),tagLength:128},i,n.ciphertext);return t(new TextDecoder(`utf-8`,{fatal:!0}).decode(a))}async function C(e){await p(r,e)}async function w(){let e=await h(),t=await u(n,i)instanceof CryptoKey,r=!1;try{await crypto.subtle.exportKey(`raw`,e)}catch{r=!0}let a=`clawsembly-vault-probe-${crypto.randomUUID()}`,o=new TextEncoder().encode(a),s=crypto.getRandomValues(new Uint8Array(12)),c=await crypto.subtle.encrypt({name:`AES-GCM`,iv:s,additionalData:g(`__probe__`),tagLength:128},e,o),l=!v(new Uint8Array(c),o),d=await crypto.subtle.decrypt({name:`AES-GCM`,iv:s,additionalData:g(`__probe__`),tagLength:128},e,c),f=new TextDecoder().decode(d)===a,p=!1;try{await crypto.subtle.decrypt({name:`AES-GCM`,iv:s,additionalData:g(`__wrong_scope__`),tagLength:128},e,c)}catch{p=!0}if(!t||e.extractable||!r||!l||!f||!p)throw Error(`credential vault self-test failed`);return{algorithm:`AES-GCM-256`,cryptoKeyStoredInIndexedDb:!0,keyExtractable:!1,keyExportRejected:!0,plaintextAbsentFromCiphertext:!0,roundTrip:!0,aadMismatchRejected:!0,result:`pass`}}var T=`https://api.openai.com/v1/responses`,E=`gpt-5.6-luna`,D=1e5,O=2*1024*1024,k=6e4,ee=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,A=/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/,j=/^[A-Za-z0-9_-]{1,128}$/,M=class extends Error{status;requestId;constructor(e,t={}){super(e),this.name=`ProviderBrokerError`,this.status=t.status,this.requestId=t.requestId}},te=class{limits;requestsUsed=0;inputCharsUsed=0;outputCharsUsed=0;constructor(e){if(![e.maxRequests,e.maxInputChars,e.maxOutputChars].every(e=>Number.isSafeInteger(e)&&e>0))throw new M(`provider budget limits are invalid`);this.limits={...e}}consumeRequest(e){let t=typeof e.input==`string`?e.input.length:JSON.stringify(e.input).length;if(this.requestsUsed+1>this.limits.maxRequests)throw new M(`provider request budget exhausted`);if(this.inputCharsUsed+t>this.limits.maxInputChars)throw new M(`provider input budget exhausted`);this.requestsUsed+=1,this.inputCharsUsed+=t}consumeOutput(e){if(!Number.isSafeInteger(e)||e<0)throw new M(`provider output budget increment is invalid`);if(this.outputCharsUsed+e>this.limits.maxOutputChars)throw new M(`provider output budget exhausted`);this.outputCharsUsed+=e}snapshot(){return{...this.limits,requestsUsed:this.requestsUsed,inputCharsUsed:this.inputCharsUsed,outputCharsUsed:this.outputCharsUsed}}};function ne(e){if(!ee.test(e.model))throw new M(`provider model identifier is invalid`);if(e.maxOutputTokens!==void 0&&(!Number.isSafeInteger(e.maxOutputTokens)||e.maxOutputTokens<1||e.maxOutputTokens>4096))throw new M(`provider output token limit is invalid`);if(typeof e.input==`string`){if(e.input.length===0)throw new M(`provider input is empty`);if(e.input.length>D)throw new M(`provider input exceeds the 100,000 character limit`)}else{if(!Array.isArray(e.input)||e.input.length===0||e.input.length>512||JSON.stringify(e.input).length>D)throw new M(`provider input item list is invalid`);let t=new Set;for(let n of e.input){if(!n||typeof n!=`object`)throw new M(`provider input item is invalid`);if(`role`in n){if(![`system`,`developer`,`user`,`assistant`].includes(n.role)||typeof n.content!=`string`||n.content.length===0)throw new M(`provider input message is invalid`);continue}if(n.type===`function_call`){if(!j.test(n.call_id)||!A.test(n.name)||typeof n.arguments!=`string`)throw new M(`provider function call input is invalid`);let e;try{e=JSON.parse(n.arguments)}catch{throw new M(`provider function call input arguments are not valid JSON`)}if(!e||typeof e!=`object`||Array.isArray(e)||t.has(n.call_id))throw new M(`provider function call input is invalid`);t.add(n.call_id);continue}if(n.type===`function_call_output`){if(!j.test(n.call_id)||typeof n.output!=`string`||n.output.length===0||!t.has(n.call_id))throw new M(`provider function call output is invalid`);t.delete(n.call_id);continue}throw new M(`provider input item type is invalid`)}}if(e.tools!==void 0){if(!Array.isArray(e.tools)||e.tools.length>16)throw new M(`provider tools exceed the allowlist limit`);for(let t of e.tools)if(t?.type!==`function`||!A.test(t.name)||t.description!==void 0&&(typeof t.description!=`string`||t.description.length>4096)||!t.parameters||typeof t.parameters!=`object`||Array.isArray(t.parameters)||t.strict!==!0)throw new M(`provider tool definition is invalid`);if(JSON.stringify(e.tools).length>D)throw new M(`provider tool definitions exceed the 100,000 character limit`)}return e}function re(e,t){return{model:e.model,input:e.input,store:!1,stream:t,...e.tools?.length?{tools:e.tools}:{},...e.maxOutputTokens===void 0?{}:{max_output_tokens:e.maxOutputTokens}}}async function N(e,t){let n=Number(e.headers.get(`content-length`));if(Number.isFinite(n)&&n>O)throw await e.body?.cancel().catch(()=>void 0),new M(`provider response exceeds the 2 MB safety limit`,{status:e.status});if(!e.body)throw new M(`provider response has no body`,{status:e.status});let r=e.body.getReader(),i=()=>{r.cancel().catch(()=>void 0)};t.aborted?i():t.addEventListener(`abort`,i,{once:!0});let a=[],o=0;try{for(;;){let{done:t,value:n}=await r.read();if(t)break;if(o+=n.byteLength,o>O)throw await r.cancel().catch(()=>void 0),new M(`provider response exceeds the 2 MB safety limit`,{status:e.status});a.push(n)}if(t.aborted)throw new M(`provider request cancelled`,{status:e.status});let n=new Uint8Array(o),i=0;for(let e of a)n.set(e,i),i+=e.byteLength;try{return JSON.parse(new TextDecoder(`utf-8`,{fatal:!0}).decode(n))}catch{throw new M(`provider returned invalid JSON`,{status:e.status})}}catch(n){throw t.aborted?new M(`provider request cancelled`,{status:e.status}):n}finally{t.removeEventListener(`abort`,i)}}async function P(e,t,n,r){let i=ne(t),a=new AbortController,o=()=>a.abort();r?.aborted?o():r?.addEventListener(`abort`,o,{once:!0});let s=!1,c=window.setTimeout(()=>{s=!0,a.abort()},k);try{let t=await n(T,{method:`POST`,headers:{authorization:`Bearer ${e}`,"content-type":`application/json`},body:JSON.stringify(re(i,!1)),cache:`no-store`,credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,signal:a.signal}),r=t.headers.get(`x-request-id`)??void 0;if(!t.ok)throw await t.body?.cancel().catch(()=>void 0),new M(`provider request failed with HTTP ${t.status}`,{status:t.status,requestId:r});if(!t.headers.get(`content-type`)?.toLowerCase().includes(`application/json`))throw await t.body?.cancel().catch(()=>void 0),new M(`provider returned an unsupported content type`,{status:t.status,requestId:r});return await N(t,a.signal)}catch(e){throw s?new M(`provider request timed out`):a.signal.aborted?new M(`provider request cancelled`):e instanceof M?e:new M(`provider network request failed`)}finally{window.clearTimeout(c),r?.removeEventListener(`abort`,o)}}async function ie(e,t,n,r){if(!e.body)throw new M(`provider stream has no body`,{status:e.status});let i=e.body.getReader(),a=new TextDecoder(`utf-8`,{fatal:!0}),o=``,s=0,c=0,l=0,u=0,d=!1,f=new Map,p=()=>{i.cancel().catch(()=>void 0)};n.addEventListener(`abort`,p,{once:!0});let m=async n=>{let a=n.split(`
`).filter(e=>e.startsWith(`data:`)).map(e=>e.slice(5).trimStart()).join(`
`);if(!a||a===`[DONE]`)return;let o;try{o=JSON.parse(a)}catch{throw new M(`provider stream returned invalid JSON`,{status:e.status})}if(o.type===`response.output_text.delta`){if(typeof o.delta!=`string`||o.delta.length===0)throw new M(`provider stream returned an invalid text delta`,{status:e.status});if(c+=o.delta.length,c>D)throw new M(`provider stream output exceeds the 100,000 character limit`,{status:e.status});try{r?.consumeOutput(o.delta.length)}catch(e){throw await i.cancel().catch(()=>void 0),e}l+=1,await t.onTextDelta(o.delta);return}if(o.type===`response.output_item.added`&&o.item?.type===`function_call`){if(typeof o.item.id!=`string`||typeof o.item.call_id!=`string`||typeof o.item.name!=`string`||!A.test(o.item.name)||o.item.arguments!==void 0&&typeof o.item.arguments!=`string`)throw new M(`provider stream returned an invalid function call`,{status:e.status});f.set(o.item.id,{callId:o.item.call_id,name:o.item.name,arguments:o.item.arguments??``});return}if(o.type===`response.function_call_arguments.delta`){if(typeof o.item_id!=`string`||typeof o.delta!=`string`)throw new M(`provider stream returned invalid function arguments`,{status:e.status});let t=f.get(o.item_id);if(!t)throw new M(`provider stream referenced an unknown function call`,{status:e.status});if(t.arguments+=o.delta,t.arguments.length>D)throw new M(`provider function arguments exceed the 100,000 character limit`,{status:e.status});try{r?.consumeOutput(o.delta.length)}catch(e){throw await i.cancel().catch(()=>void 0),e}return}if(o.type===`response.function_call_arguments.done`){let n=typeof o.item?.id==`string`?o.item.id:typeof o.item_id==`string`?o.item_id:``,r=f.get(n);if(!r)throw new M(`provider stream completed an unknown function call`,{status:e.status});let i=typeof o.arguments==`string`?o.arguments:typeof o.item?.arguments==`string`?o.item.arguments:r.arguments;if(r.arguments&&i!==r.arguments)throw new M(`provider stream returned inconsistent function arguments`,{status:e.status});let a;try{a=JSON.parse(i)}catch{throw new M(`provider function arguments are not valid JSON`,{status:e.status})}if(!a||typeof a!=`object`||Array.isArray(a))throw new M(`provider function arguments must be a JSON object`,{status:e.status});u+=1,await t.onFunctionCall?.({...r,arguments:i}),f.delete(n);return}if(o.type===`response.completed`){if(o.response?.status!==void 0&&o.response.status!==`completed`)throw new M(`provider stream completed with an invalid status`,{status:e.status});d=!0;return}if(o.type===`error`||o.type===`response.failed`)throw new M(`provider stream failed`,{status:e.status})};try{for(;;){let{done:t,value:n}=await i.read();if(t)break;if(s+=n.byteLength,s>O)throw await i.cancel().catch(()=>void 0),new M(`provider stream exceeds the 2 MB safety limit`,{status:e.status});o+=a.decode(n,{stream:!0}).replaceAll(`\r
`,`
`);let r=o.split(`

`);o=r.pop()??``;for(let e of r)await m(e)}o+=a.decode(),o.trim()&&await m(o)}catch(t){throw t instanceof M?t:new M(n.aborted?`provider request cancelled`:`provider stream could not be read`,{status:e.status})}finally{n.removeEventListener(`abort`,p)}if(n.aborted)throw new M(`provider request cancelled`,{status:e.status});if(!d)throw new M(`provider stream ended before completion`,{status:e.status});if(f.size>0)throw new M(`provider stream ended with incomplete function calls`,{status:e.status});return{completed:!0,deltaCount:l,outputTextChars:c,functionCallCount:u}}async function F(e,t,n,r,i,a){let o=ne(t);a?.consumeRequest(o);let s=new AbortController,c=()=>s.abort();i?.aborted?c():i?.addEventListener(`abort`,c,{once:!0});let l=!1,u=window.setTimeout(()=>{l=!0,s.abort()},k);try{let t=await n(T,{method:`POST`,headers:{authorization:`Bearer ${e}`,"content-type":`application/json`},body:JSON.stringify(re(o,!0)),cache:`no-store`,credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,signal:s.signal}),i=t.headers.get(`x-request-id`)??void 0;if(!t.ok)throw await t.body?.cancel().catch(()=>void 0),new M(`provider request failed with HTTP ${t.status}`,{status:t.status,requestId:i});if(!t.headers.get(`content-type`)?.toLowerCase().includes(`text/event-stream`))throw await t.body?.cancel().catch(()=>void 0),new M(`provider returned an unsupported streaming content type`,{status:t.status,requestId:i});return await ie(t,r,s.signal,a)}catch(e){throw l?new M(`provider request timed out`):e instanceof M?e:new M(s.signal.aborted?`provider request cancelled`:`provider streaming network request failed`)}finally{window.clearTimeout(u),i?.removeEventListener(`abort`,c)}}async function I(e,t){return S(`openai`,n=>P(n,e,fetch,t))}async function ae(e,t,n,r,i,a){return S(n,n=>F(n,e,t,r,i,a))}function oe(e){if(!e||typeof e!=`object`)throw new M(`provider response is not an object`);let t=e;if(t.status!==`completed`||!Array.isArray(t.output))throw new M(`provider response did not complete`);let n=t.output.flatMap(e=>{if(!e||typeof e!=`object`||e.type!==`message`)return[];let t=e.content;return Array.isArray(t)?t.flatMap(e=>e&&typeof e==`object`&&e.type===`output_text`&&typeof e.text==`string`?[e.text]:[]):[]}).join(``);if(!n)throw new M(`provider response contains no output text`);if(n.length>D)throw new M(`provider output text exceeds the 100,000 character limit`);return n}async function se(){let e=`clawsembly-provider-probe-${crypto.randomUUID()}`,t=``,n,r=async(e,r)=>(t=typeof e==`string`?e:e instanceof URL?e.toString():e.url,n=r,new Response(JSON.stringify({id:`resp_clawsembly_probe`,status:`completed`,output:[{type:`message`,content:[{type:`output_text`,text:`Broker policy passed.`}]}]}),{status:200,headers:{"content-type":`application/json`,"x-request-id":`req_clawsembly_probe`}})),i=await P(e,{model:`clawsembly-policy-probe`,input:`Verify the provider boundary.`},r),a=new Headers(n?.headers),o=JSON.parse(String(n?.body)),s=a.get(`authorization`)===`Bearer ${e}`,c=!JSON.stringify({result:i,body:o,url:t,method:n?.method}).includes(e),l=oe(i)===`Broker policy passed.`,u=!1;try{oe({status:`completed`,output:[]})}catch(e){u=e instanceof M&&e.message.includes(`no output text`)}let d=!1;try{await P(e,{model:`../invalid model`,input:`blocked`},r)}catch(e){d=e instanceof M&&e.message.includes(`model identifier`)}let f=!1,p=async()=>new Response(``,{status:200,headers:{"content-type":`application/json`,"content-length":`2097153`}});try{await P(e,{model:`clawsembly-policy-probe`,input:`bounded`},p)}catch(e){f=e instanceof M&&e.message.includes(`2 MB`)}let m,h=async(e,t)=>{m=t;let n=`${[{type:`response.created`,response:{status:`in_progress`}},{type:`response.output_text.delta`,delta:`Broker `},{type:`response.output_text.delta`,delta:`stream passed.`},{type:`response.completed`,response:{status:`completed`}}].map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}`).join(`

`)}\n\n`;return new Response(n,{status:200,headers:{"content-type":`text/event-stream`,"x-request-id":`req_stream_probe`}})},g=[],_=await F(e,{model:`clawsembly-policy-probe`,input:`Verify typed streaming.`},h,{onTextDelta:e=>{g.push(e)}}),v=JSON.parse(String(m?.body)),y=_.completed&&_.deltaCount===2&&_.functionCallCount===0&&g.join(``)===`Broker stream passed.`&&v.store===!1&&v.stream===!0,b=async()=>{let e={type:`function_call`,id:`fc_probe`,call_id:`call_probe`,name:`agents_list`,arguments:``},t=`${[{type:`response.output_item.added`,item:e},{type:`response.function_call_arguments.delta`,item_id:e.id,delta:`{}`},{type:`response.function_call_arguments.done`,item_id:e.id,arguments:`{}`},{type:`response.completed`,response:{status:`completed`}}].map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}`).join(`

`)}\n\n`;return new Response(t,{status:200,headers:{"content-type":`text/event-stream`}})},x=[],S=(await F(e,{model:`clawsembly-policy-probe`,input:`Verify function streaming.`},b,{onTextDelta:()=>void 0,onFunctionCall:e=>{x.push(e)}})).functionCallCount===1&&x.length===1&&x[0]?.callId===`call_probe`&&x[0]?.name===`agents_list`&&x[0]?.arguments===`{}`,C,w=async(e,t)=>(C=JSON.parse(String(t?.body)),new Response(JSON.stringify({status:`completed`,output:[{type:`message`,content:[{type:`output_text`,text:`Function result input passed.`}]}]}),{status:200,headers:{"content-type":`application/json`}})),E=[{role:`user`,content:`List agents.`},{type:`function_call`,call_id:`call_input_probe`,name:`agents_list`,arguments:`{}`},{type:`function_call_output`,call_id:`call_input_probe`,output:`{"agents":[]}`}];await P(e,{model:`clawsembly-policy-probe`,input:E,maxOutputTokens:128},w);let D=!1;try{await P(e,{model:`clawsembly-policy-probe`,input:[{type:`function_call_output`,call_id:`call_unknown`,output:`{}`}]},w)}catch(e){D=e instanceof M&&e.message.includes(`function call output`)}let k=JSON.stringify(C?.input)===JSON.stringify(E)&&D,ee=!1;try{await P(e,{model:`clawsembly-policy-probe`,input:`blocked`,maxOutputTokens:0},w)}catch(e){ee=e instanceof M&&e.message.includes(`output token limit`)}let A=C?.max_output_tokens===128&&ee,j=new te({maxRequests:1,maxInputChars:16,maxOutputChars:5});j.consumeRequest({model:`budget-probe`,input:`12345678`}),j.consumeOutput(5);let ne=!1,re=!1;try{j.consumeRequest({model:`budget-probe`,input:`1`})}catch(e){ne=e instanceof M&&e.message.includes(`request budget`)}try{j.consumeOutput(1)}catch(e){re=e instanceof M&&e.message.includes(`output budget`)}let N=j.snapshot(),ie=ne&&re&&N.requestsUsed===1&&N.inputCharsUsed===8&&N.outputCharsUsed===5,I=!1,ae=new AbortController,se=async()=>new Response(new ReadableStream({start(e){let t={type:`response.output_text.delta`,delta:`cancel-now`};e.enqueue(new TextEncoder().encode(`event: ${t.type}\ndata: ${JSON.stringify(t)}\n\n`))},cancel(){I=!0}}),{status:200,headers:{"content-type":`text/event-stream`}}),L=!1;try{await F(e,{model:`clawsembly-policy-probe`,input:`Verify cancellation.`},se,{onTextDelta:()=>{ae.abort()}},ae.signal)}catch(e){L=e instanceof M&&e.message.includes(`cancelled`)&&I}let R=!1,ce=async()=>new Response(new ReadableStream({cancel(){R=!0}}),{status:200,headers:{"content-type":`application/json`}}),z=new AbortController,le=P(e,{model:`clawsembly-policy-probe`,input:`Verify stalled body cancellation.`},ce,z.signal);await new Promise(e=>window.setTimeout(e,0)),z.abort();let ue=await Promise.race([le.then(()=>`resolved`,e=>e instanceof M&&e.message.includes(`cancelled`)?`cancelled`:`rejected`),new Promise(e=>window.setTimeout(()=>e(`timeout`),250))])===`cancelled`&&R;if(!(t===`https://api.openai.com/v1/responses`&&n?.method===`POST`&&n.redirect===`error`&&n.credentials===`omit`&&n.referrerPolicy===`no-referrer`&&o.store===!1&&o.stream===!1&&Object.keys(o).sort().join(`,`)===`input,model,store,stream`&&s&&c&&l&&u&&d&&f&&y&&S&&k&&A&&ie&&L&&ue))throw Error(`provider broker policy self-test failed`);return{endpoint:T,method:`POST`,redirectPolicy:`error`,browserCredentials:`omit`,responseLimitBytes:O,store:!1,stream:!1,authorizationApplied:!0,secretRedacted:!0,invalidModelRejected:!0,oversizedResponseRejected:!0,outputTextValidated:!0,invalidOutputRejected:!0,streamingEventsValidated:!0,functionCallEventsValidated:!0,functionResultInputValidated:!0,maxOutputTokensValidated:!0,requestBudgetValidated:!0,cancellationPropagated:!0,bodyCancellationPropagated:!0,result:`pass`}}function L(){let e=document.querySelector(`[data-credential-vault]`),t=document.querySelector(`[data-credential-input]`),n=document.querySelector(`[data-save-credential]`),r=document.querySelector(`[data-clear-credential]`),i=document.querySelector(`[data-vault-health]`),a=document.querySelector(`[data-vault-status]`);if(!e||!t||!n||!r||!i||!a)return;let o=async(e=`Vault verified`)=>{let t=await x(`openai`);i.dataset.state=`pass`,i.textContent=`VAULT + BROKER / PASS`,r.disabled=!t,a.textContent=t?`${e} · OpenAI credential stored · browser host only`:`${e} · no OpenAI credential stored`,window.dispatchEvent(new CustomEvent(`clawsembly:credential-state`,{detail:{provider:`openai`,stored:!!t}}))};Promise.all([w(),se()]).then(()=>o()).catch(e=>{i.dataset.state=`fail`,i.textContent=`VAULT / FAIL`,a.textContent=e instanceof Error?e.message:`Credential vault unavailable`,t.disabled=!0,n.disabled=!0,r.disabled=!0}),e.addEventListener(`submit`,async e=>{e.preventDefault(),n.disabled=!0,n.textContent=`Encrypting…`;try{await b(`openai`,t.value),t.value=``,await o(`Encrypted and stored`)}catch(e){a.textContent=e instanceof Error?e.message:`Credential storage failed`}finally{n.disabled=!1,n.textContent=`Save encrypted`}}),r.addEventListener(`click`,async()=>{r.disabled=!0;try{await C(`openai`),await o(`Credential removed`)}catch(e){a.textContent=e instanceof Error?e.message:`Credential removal failed`,r.disabled=!1}})}var R=`clawsembly-device-identity`,ce=1,z=`identity`,le=`primary`,ue;function de(e){return new Promise((t,n)=>{e.addEventListener(`success`,()=>t(e.result),{once:!0}),e.addEventListener(`error`,()=>n(e.error??Error(`device identity request failed`)),{once:!0})})}function fe(e){return new Promise((t,n)=>{e.addEventListener(`complete`,()=>t(),{once:!0}),e.addEventListener(`abort`,()=>n(e.error??Error(`device identity transaction aborted`)),{once:!0}),e.addEventListener(`error`,()=>n(e.error??Error(`device identity transaction failed`)),{once:!0})})}async function B(){if(!globalThis.indexedDB)throw Error(`IndexedDB is unavailable for device identity`);let e=indexedDB.open(R,ce);return e.addEventListener(`upgradeneeded`,()=>{e.result.objectStoreNames.contains(z)||e.result.createObjectStore(z)}),de(e)}async function V(){let e=await B();try{let t=e.transaction(z,`readonly`),n=fe(t),r=await de(t.objectStore(z).get(le));return await n,r}finally{e.close()}}async function pe(e){let t=await B();try{let n=t.transaction(z,`readwrite`),r=fe(n);n.objectStore(z).add(e,le),await r}finally{t.close()}}function me(e){let t=``;for(let n of e)t+=String.fromCharCode(n);return btoa(t).replaceAll(`+`,`-`).replaceAll(`/`,`_`).replace(/=+$/g,``)}function he(e){return Array.from(e,e=>e.toString(16).padStart(2,`0`)).join(``)}async function H(e){return he(new Uint8Array(await crypto.subtle.digest(`SHA-256`,e)))}function ge(e){return typeof e==`string`?e.trim().replace(/[A-Z]/g,e=>String.fromCharCode(e.charCodeAt(0)+32)):``}function U(e){return[`v3`,e.deviceId,e.clientId,e.clientMode,e.role,e.scopes.join(`,`),String(e.signedAtMs),e.token??``,e.nonce,ge(e.platform),ge(e.deviceFamily)].join(`|`)}function _e(e){return[`v2`,e.deviceId,e.clientId,e.clientMode,e.role,e.scopes.join(`,`),String(e.signedAtMs),e.token??``,e.nonce].join(`|`)}async function ve(e){if(!e)return;if(e.version!==1||!/^[a-f0-9]{64}$/.test(e.deviceId)||!(e.publicKeyRaw instanceof ArrayBuffer)||e.publicKeyRaw.byteLength!==32||!(e.publicKey instanceof CryptoKey)||e.publicKey.type!==`public`||e.publicKey.algorithm.name!==`Ed25519`||!(e.privateKey instanceof CryptoKey)||e.privateKey.type!==`private`||e.privateKey.algorithm.name!==`Ed25519`||e.privateKey.extractable||!Number.isFinite(Date.parse(e.createdAt)))throw Error(`stored browser device identity is invalid`);let t=new Uint8Array(e.publicKeyRaw);if(await H(t)!==e.deviceId)throw Error(`stored browser device id does not match its public key`);let n=new TextEncoder().encode(`openclaw-device-identity-self-check`),r=await crypto.subtle.sign(`Ed25519`,e.privateKey,n);if(!await crypto.subtle.verify(`Ed25519`,e.publicKey,r,n))throw Error(`stored browser device key pair does not match`);return{deviceId:e.deviceId,publicKeyRawBase64Url:me(t),publicKey:e.publicKey,privateKey:e.privateKey,createdAt:e.createdAt}}async function ye(){let e=await ve(await V());if(e)return e;let t=await crypto.subtle.generateKey(`Ed25519`,!1,[`sign`,`verify`]),n=new Uint8Array(await crypto.subtle.exportKey(`raw`,t.publicKey));if(n.byteLength!==32)throw Error(`browser returned an invalid Ed25519 public key`);let r={version:1,deviceId:await H(n),publicKeyRaw:n.buffer,publicKey:t.publicKey,privateKey:t.privateKey,createdAt:new Date().toISOString()};try{await pe(r)}catch(e){if(!(e instanceof DOMException)||e.name!==`ConstraintError`)throw e}let i=await ve(await V());if(!i)throw Error(`browser device identity was not retained by IndexedDB`);return i}async function W(){ue??=ye();try{return await ue}catch(e){throw ue=void 0,e}}async function be(e,t=`v3`){let n=await W(),r={...e,deviceId:n.deviceId},i=t===`v3`?U(r):_e(r),a=new Uint8Array(await crypto.subtle.sign(`Ed25519`,n.privateKey,new TextEncoder().encode(i)));return{id:n.deviceId,publicKey:n.publicKeyRawBase64Url,signature:me(a),signedAt:e.signedAtMs,nonce:e.nonce}}async function G(){let e=await W(),t=await ve(await V());if(!t||t.deviceId!==e.deviceId)throw Error(`browser device identity reload failed`);let n=!1;try{await crypto.subtle.exportKey(`pkcs8`,e.privateKey)}catch{n=!0}let r={clientId:`gateway-client`,clientMode:`backend`,role:`operator`,scopes:[`operator.read`,`operator.write`],signedAtMs:17837952e5,token:`probe-token`,nonce:`clawsembly-nonce`,platform:`Browser`,deviceFamily:`Clawsembly`},i=U({...r,deviceId:e.deviceId}),a=await crypto.subtle.sign(`Ed25519`,e.privateKey,new TextEncoder().encode(i)),o=await crypto.subtle.verify(`Ed25519`,e.publicKey,a,new TextEncoder().encode(i)),s=U({...r,deviceId:e.deviceId,nonce:`wrong-nonce`}),c=!await crypto.subtle.verify(`Ed25519`,e.publicKey,a,new TextEncoder().encode(s)),l=i.startsWith(`v3|${e.deviceId}|gateway-client|backend|operator|operator.read,operator.write|`)&&i.endsWith(`|probe-token|clawsembly-nonce|browser|clawsembly`);if(e.privateKey.extractable||!n||!o||!c||!l)throw Error(`browser device identity self-test failed`);return{algorithm:`Ed25519`,deviceId:e.deviceId,publicKeyBytes:32,privateKeyExtractable:!1,privateKeyExportRejected:!0,indexedDbReload:!0,upstreamV3Payload:!0,signatureVerified:!0,nonceMismatchRejected:!0,result:`pass`}}function xe(){let e=document.querySelector(`[data-device-health]`),t=document.querySelector(`[data-device-id]`);if(!e||!t)return;let n=()=>Promise.all([G(),x(`openclaw-device`)]).then(([n,r])=>{e.dataset.state=`pass`,e.textContent=r?`SIGNATURE + TOKEN / PASS`:`SIGNATURE / PASS`,t.textContent=`${n.deviceId.slice(0,12)}…`,t.title=n.deviceId}).catch(n=>{e.dataset.state=`fail`,e.textContent=`IDENTITY / FAIL`,t.textContent=n instanceof Error?n.message:`Device identity unavailable`});n(),window.addEventListener(`clawsembly:device-token-stored`,()=>{n()})}var Se=`Reply with exactly CLAWSEMBLY_LIVE_OK and nothing else.`,Ce=`2026-07-12`,we=1.25,Te=6,Ee=1.1;function De(){let e=new TextEncoder().encode(Se).byteLength,t=(e*we+128*Te)/1e6*Ee;return{model:E,promptUtf8Bytes:e,maxOutputTokens:128,displayedUpperBoundUsd:Math.ceil(t*1e3)/1e3,pricingCapturedAt:Ce}}async function Oe(e){let t=oe(await I({model:E,input:Se,maxOutputTokens:128},e)).trim();if(t!==`CLAWSEMBLY_LIVE_OK`)throw Error(`live provider returned an unexpected smoke-test response`);return t}function ke(){let e=document.querySelector(`[data-live-provider]`),t=document.querySelector(`[data-live-consent]`),n=document.querySelector(`[data-live-run]`),r=document.querySelector(`[data-live-cancel]`),i=document.querySelector(`[data-live-status]`),a=document.querySelector(`[data-live-output]`),o=document.querySelector(`[data-live-cost]`);if(!e||!t||!n||!r||!i||!a||!o)return;let s=De();o.textContent=`≤ $${s.displayedUpperBoundUsd.toFixed(3)} upper bound · ${s.maxOutputTokens} output tokens · pricing checked ${s.pricingCapturedAt}`;let c=!1,l=!1,u,d=()=>{n.disabled=l||!c||!t.checked,r.disabled=!l,!l&&(i.textContent=c?t.checked?`Live test armed · only the fixed probe prompt will be sent`:`Live test locked · review the disclosure and provide consent`:`Live test locked · save an OpenAI credential first`)},f=async()=>{c=!!await x(`openai`),c||(t.checked=!1),d()};window.addEventListener(`clawsembly:credential-state`,()=>{f()}),t.addEventListener(`change`,d),r.addEventListener(`click`,()=>u?.abort()),n.addEventListener(`click`,async()=>{if(await f(),!c||!t.checked||l)return;l=!0,u=new AbortController,a.hidden=!0,a.textContent=``,n.textContent=`Running live test…`,i.textContent=`Sending fixed probe prompt through the browser-host Responses broker…`,d();let e=`Live provider smoke test failed`;try{let t=await Oe(u.signal);a.textContent=t,a.hidden=!1,e=`Live test passed · completed plain-text output only`}catch(t){e=t instanceof Error?t.message:`Live provider smoke test failed`}finally{l=!1,u=void 0,t.checked=!1,n.textContent=`Run protected live test`,d(),i.textContent=e}}),f()}var Ae=`import fs, { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

const fsBigIntAdapterMarker = Symbol.for("clawsembly.fs-bigint-position-adapter");
const sqliteLoaderMarker = Symbol.for("clawsembly.node-sqlite-polyfill-loader");

export function installFsBigIntPositionAdapter() {
  if (fs.readSync[fsBigIntAdapterMarker]) return;
  const originalReadSync = fs.readSync;
  function readSyncWithBigIntPosition(...args) {
    if (typeof args[4] === "bigint") {
      const position = Number(args[4]);
      if (!Number.isSafeInteger(position)) throw new RangeError("fs.readSync position exceeds safe integer range");
      args[4] = position;
    }
    return Reflect.apply(originalReadSync, this, args);
  }
  Object.defineProperty(readSyncWithBigIntPosition, fsBigIntAdapterMarker, { value: true });
  fs.readSync = readSyncWithBigIntPosition;
  Module.syncBuiltinESMExports?.();
}

function normalizeBoundValue(value) {
  if (typeof value !== "bigint") return value;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError("BigInt parameter exceeds sql.js safe integer range");
  return number;
}

function normalizeParameters(values) {
  if (values.length === 0) return undefined;
  if (values.length === 1 && (Array.isArray(values[0]) || (values[0] && typeof values[0] === "object"))) {
    if (Array.isArray(values[0])) return values[0].map(normalizeBoundValue);
    return Object.fromEntries(Object.entries(values[0]).map(([key, value]) => [key, normalizeBoundValue(value)]));
  }
  return values.map(normalizeBoundValue);
}

export async function installNodeSqlitePolyfill() {
  installFsBigIntPositionAdapter();
  const requireFromAdapter = Module.createRequire(import.meta.url);
  const wasmPath = requireFromAdapter.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({
    locateFile() { return wasmPath; }
  });

  class StatementSync {
    constructor(owner, sourceSQL) {
      this.owner = owner;
      this.sourceSQL = sourceSQL;
      this.readBigInts = false;
    }

    columns() {
      const statement = this.owner.database.prepare(this.sourceSQL);
      try {
        return statement.getColumnNames().map((name) => ({
          column: name,
          database: null,
          name,
          originName: name,
          table: null
        }));
      } finally {
        statement.free();
      }
    }

    all(...values) {
      const statement = this.owner.database.prepare(this.sourceSQL);
      const rows = [];
      try {
        const parameters = normalizeParameters(values);
        if (parameters !== undefined) statement.bind(parameters);
        while (statement.step()) {
          const row = statement.getAsObject();
          if (this.readBigInts) {
            for (const [key, value] of Object.entries(row)) {
              if (typeof value === "number" && Number.isInteger(value)) row[key] = BigInt(value);
            }
          }
          rows.push(row);
        }
        return rows;
      } finally {
        statement.free();
      }
    }

    get(...values) {
      return this.all(...values)[0];
    }

    *iterate(...values) {
      for (const row of this.all(...values)) yield row;
    }

    run(...values) {
      const statement = this.owner.database.prepare(this.sourceSQL);
      try {
        const parameters = normalizeParameters(values);
        if (parameters !== undefined) statement.bind(parameters);
        while (statement.step()) {
          // Consume rows for statements such as INSERT ... RETURNING.
        }
      } finally {
        statement.free();
      }
      const changes = this.owner.database.getRowsModified();
      const lastInsert = this.owner.database.exec("SELECT last_insert_rowid() AS id");
      const lastInsertRowid = Number(lastInsert[0]?.values[0]?.[0] ?? 0);
      this.owner.persist();
      return this.readBigInts
        ? { changes: BigInt(changes), lastInsertRowid: BigInt(lastInsertRowid) }
        : { changes, lastInsertRowid };
    }

    setAllowBareNamedParameters() {
      return this;
    }

    setReadBigInts(enabled) {
      this.readBigInts = Boolean(enabled);
      return this;
    }
  }

  class DatabaseSync {
    constructor(pathname = ":memory:", options = {}) {
      this.path = pathname;
      this.readOnly = Boolean(options.readOnly);
      this.isOpen = true;
      this.transactionDepth = 0;
      const existing = pathname !== ":memory:" && existsSync(pathname) ? readFileSync(pathname) : undefined;
      this.database = existing ? new SQL.Database(existing) : new SQL.Database();
      this.persist();
    }

    exec(sql) {
      this.assertOpen();
      const command = sql.trimStart().split(/\\s+/, 1)[0]?.toUpperCase();
      this.database.run(sql);
      if (command === "BEGIN") {
        this.transactionDepth += 1;
        return;
      }
      if (command === "COMMIT" || command === "ROLLBACK") {
        this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      }
      this.persist();
    }

    prepare(sql) {
      this.assertOpen();
      return new StatementSync(this, sql);
    }

    close() {
      if (!this.isOpen) return;
      this.persist(true);
      this.database.close();
      this.isOpen = false;
    }

    persist(force = false) {
      if (!this.isOpen || this.readOnly || this.path === ":memory:" || (!force && this.transactionDepth > 0)) return;
      mkdirSync(dirname(this.path), { recursive: true });
      const staging = \`\${this.path}.tmp-\${process.pid}\`;
      writeFileSync(staging, this.database.export());
      renameSync(staging, this.path);
    }

    assertOpen() {
      if (!this.isOpen) throw new Error("database is not open");
    }
  }

  const sqliteModule = { DatabaseSync, StatementSync };
  if (!Module._load[sqliteLoaderMarker]) {
    const originalLoad = Module._load;
    function loadWithBrowserSqlite(request, parent, isMain) {
      if (request === "node:sqlite") return loadWithBrowserSqlite[sqliteLoaderMarker];
      return originalLoad.call(this, request, parent, isMain);
    }
    Object.defineProperty(loadWithBrowserSqlite, sqliteLoaderMarker, { value: sqliteModule, writable: true });
    Module._load = loadWithBrowserSqlite;
  } else {
    Module._load[sqliteLoaderMarker] = sqliteModule;
  }

  return sqliteModule;
}
`,je=`import { installNodeSqlitePolyfill } from "./node-sqlite-polyfill.mjs";

await installNodeSqlitePolyfill();

const openclawEntry = new URL("../node_modules/openclaw/openclaw.mjs", import.meta.url);
process.argv = [process.execPath, openclawEntry.pathname, ...process.argv.slice(2)];
await import(openclawEntry.href);
`,Me=`import http from "node:http";

const port = Number(process.env.CLAWSEMBLY_MOCK_PORT ?? 19002);
const responseText = "Clawsembly tool round-trip passed.";
const requiredToolName = "agents_list";
const maxBodyBytes = 1024 * 1024;
let toolCallSequence = 0;

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    sendJson(response, 200, { object: "list", data: [{ id: "mock-v1", object: "model" }] });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "not found" } });
    return;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      sendJson(response, 413, { error: { message: "request too large" } });
      request.destroy();
      return;
    }
  }
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    sendJson(response, 400, { error: { message: "invalid JSON request body" } });
    return;
  }
  const toolNames = Array.isArray(input.tools)
    ? input.tools.map((tool) => tool?.function?.name).filter(Boolean)
    : [];
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const latestUserIndex = messages.findLastIndex((message) => message?.role === "user");
  const currentTurnMessages = latestUserIndex >= 0 ? messages.slice(latestUserIndex + 1) : messages;
  const toolResultMessage = currentTurnMessages.find((message) => message?.role === "tool");
  const hasToolResult = Boolean(toolResultMessage);
  const isCancellationProbe = latestUserIndex >= 0 && JSON.stringify(messages[latestUserIndex]).includes("CANCEL_ME");
  console.log(JSON.stringify({
    event: "request",
    model: input.model,
    stream: input.stream === true,
    messageCount: Array.isArray(input.messages) ? input.messages.length : 0,
    toolCount: toolNames.length,
    toolNames,
    hasToolResult,
    toolResultCallId: toolResultMessage?.tool_call_id ?? null,
    toolResultChars: typeof toolResultMessage?.content === "string" ? toolResultMessage.content.length : 0
  }));

  if (input.stream !== true) {
    sendJson(response, 200, {
      id: "clawsembly-mock",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock-v1",
      choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 }
    });
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const chunk = (delta, finishReason = null) => {
    response.write(\`data: \${JSON.stringify({
      id: "clawsembly-mock",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "mock-v1",
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\\n\\n\`);
  };
  chunk({ role: "assistant" });

  if (isCancellationProbe) {
    chunk({ content: "Cancellation probe started." });
    let completed = false;
    const finish = (event) => {
      if (completed) return;
      completed = true;
      clearTimeout(fallback);
      console.log(JSON.stringify({ event, scenario: "cancellation" }));
    };
    const fallback = setTimeout(() => {
      finish("timeout");
      if (!response.writableEnded) {
        chunk({ content: " Cancellation was not received." });
        chunk({}, "stop");
        response.write("data: [DONE]\\n\\n");
        response.end();
      }
    }, 60_000);
    request.once("aborted", () => finish("request-aborted"));
    response.once("close", () => {
      if (!response.writableEnded) finish("response-closed");
    });
    return;
  }

  if (!hasToolResult) {
    if (!toolNames.includes(requiredToolName)) {
      chunk({ content: \`Required \${requiredToolName} tool was not advertised.\` });
      chunk({}, "stop");
      response.write("data: [DONE]\\n\\n");
      response.end();
      return;
    }
    chunk({
      tool_calls: [{
        index: 0,
        id: \`call_clawsembly_agents_\${++toolCallSequence}\`,
        type: "function",
        function: { name: requiredToolName, arguments: "{}" }
      }]
    });
    chunk({}, "tool_calls");
    response.write("data: [DONE]\\n\\n");
    response.end();
    return;
  }

  chunk({ content: "Clawsembly tool " });
  chunk({ content: "round-trip passed." });
  chunk({}, "stop");
  response.write("data: [DONE]\\n\\n");
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log(JSON.stringify({ event: "ready", port: typeof address === "object" && address ? address.port : port }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 250).unref();
  });
}
`,Ne=`const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const token = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
const sessionKey = "agent:main:clawsembly-probe";
const runSuffix = \`\${Date.now().toString(36)}-\${process.pid}\`;
const completedRunId = \`clawsembly-mock-turn-\${runSuffix}\`;
const cancelledRunId = \`clawsembly-cancel-turn-\${runSuffix}\`;

if (!Number.isInteger(port) || !token) throw new Error("Gateway probe port and token are required");

function withTimeout(promise, label, milliseconds = 30_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(\`\${label} timed out\`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

async function createClient(instance) {
  const socket = new WebSocket(\`ws://127.0.0.1:\${port}\`);
  const pending = new Map();
  const waiters = new Set();
  let requestSequence = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  function sendRequest(method, params, id = \`\${instance}-\${++requestSequence}\`) {
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }

  socket.addEventListener("error", () => readyReject(new Error(\`\${instance} websocket error\`)));
  socket.addEventListener("close", (event) => {
    const error = new Error(\`\${instance} websocket closed (\${event.code}): \${event.reason}\`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.type === "event" && frame.event === "connect.challenge") {
      sendRequest("connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: "gateway-client",
          version: "clawsembly-probe",
          platform: "webcontainer",
          mode: "backend",
          instanceId: instance
        },
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        caps: [],
        auth: { token }
      }, \`\${instance}-connect\`).then((hello) => {
        if (hello?.type !== "hello-ok" || hello.protocol !== 4) throw new Error(\`\${instance} returned an invalid hello\`);
        console.log(JSON.stringify({ event: "hello", instance, protocol: hello.protocol, serverVersion: hello.server?.version }));
        readyResolve(hello);
      }).catch(readyReject);
      return;
    }
    if (frame.type === "res") {
      const waiter = pending.get(frame.id);
      if (!waiter) return;
      pending.delete(frame.id);
      if (frame.ok) waiter.resolve(frame.payload);
      else waiter.reject(new Error(\`\${frame.error?.code ?? "RPC_ERROR"}: \${frame.error?.message ?? "request failed"}\`));
      return;
    }
    if (frame.type === "event") {
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(frame)) continue;
        waiters.delete(waiter);
        waiter.resolve(frame);
      }
    }
  });

  function waitForEvent(predicate, label) {
    return withTimeout(new Promise((resolve) => waiters.add({ predicate, resolve })), label);
  }

  await withTimeout(ready, \`\${instance} connect\`);
  return {
    request(method, params) { return withTimeout(sendRequest(method, params), \`\${instance} \${method}\`); },
    waitForEvent,
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));
      socket.close(1000, "probe reconnect");
      await withTimeout(closed, \`\${instance} close\`, 5_000);
    }
  };
}

function assertHistory(payload, phase) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const serialized = JSON.stringify(messages);
  if (!serialized.includes("Reply with the deterministic mock response.")) throw new Error(\`\${phase} history is missing the user message\`);
  if (!serialized.includes("Clawsembly tool round-trip passed.")) throw new Error(\`\${phase} history is missing the assistant response\`);
  console.log(JSON.stringify({ event: "history", phase, messageCount: messages.length, restored: true }));
}

async function requestAfterStartup(client, method, params) {
  let lastError;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      return await client.request(method, params);
    } catch (error) {
      lastError = error;
      if (!String(error).includes("UNAVAILABLE: chat.history unavailable during gateway startup")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

const first = await createClient("initial");
const finalEvent = first.waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === completedRunId && frame.payload?.state === "final",
  "completed chat event"
);
await first.request("chat.send", {
  sessionKey,
  message: "Reply with the deterministic mock response.",
  deliver: false,
  timeoutMs: 20_000,
  idempotencyKey: completedRunId
});
const finalFrame = await finalEvent;
if (!JSON.stringify(finalFrame.payload.message).includes("Clawsembly tool round-trip passed.")) {
  throw new Error("completed chat response did not match the deterministic fixture");
}
console.log(JSON.stringify({ event: "chat", state: "final", runId: completedRunId, toolRoundTrip: true }));
assertHistory(await requestAfterStartup(first, "chat.history", { sessionKey, limit: 20, maxChars: 20_000 }), "initial");
await first.close();

const reconnected = await createClient("reconnected");
assertHistory(await requestAfterStartup(reconnected, "chat.history", { sessionKey, limit: 20, maxChars: 20_000 }), "reconnected");

const deltaEvent = reconnected.waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "delta",
  "cancellation delta"
);
const abortedEvent = reconnected.waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "aborted",
  "cancellation event"
);
await reconnected.request("chat.send", {
  sessionKey,
  message: "CANCEL_ME after the first streamed delta.",
  deliver: false,
  timeoutMs: 60_000,
  idempotencyKey: cancelledRunId
});
await deltaEvent;
const abortResult = await reconnected.request("chat.abort", { sessionKey, runId: cancelledRunId });
if (abortResult?.aborted !== true || !abortResult.runIds?.includes(cancelledRunId)) throw new Error("chat.abort did not report the active run");
const abortedFrame = await abortedEvent;
console.log(JSON.stringify({
  event: "chat",
  state: abortedFrame.payload.state,
  runId: abortedFrame.payload.runId,
  abortRpc: true
}));
await reconnected.close();

console.log(JSON.stringify({
  ok: true,
  event: "lifecycle",
  history: true,
  reconnect: true,
  cancellation: true,
  toolRoundTrip: true
}));
`,Pe=`import { createInterface } from "node:readline";

const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const token = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
if (!Number.isInteger(port) || !token) throw new Error("Gateway device probe port and token are required");

const client = {
  id: "gateway-client",
  version: "clawsembly-browser-probe",
  platform: "browser",
  mode: "backend",
  instanceId: \`clawsembly-browser-\${Date.now().toString(36)}-\${process.pid}\`
};
const role = "operator";
const scopes = ["operator.read", "operator.write"];
const requestId = "clawsembly-browser-device-connect";
const socket = new WebSocket(\`ws://127.0.0.1:\${port}\`);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let signedConnection;

function readHostSignature() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser host signature timed out")), 15_000);
    input.once("line", (line) => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(line)); }
      catch { reject(new Error("browser host returned invalid signature JSON")); }
    });
  });
}

const finished = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Gateway device identity probe timed out")), 25_000);
  const finish = (value, error) => {
    clearTimeout(timeout);
    input.close();
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "device identity probe complete");
    if (error) reject(error);
    else resolve(value);
  };
  socket.addEventListener("error", () => finish(undefined, new Error("Gateway device probe websocket failed")));
  socket.addEventListener("close", (event) => {
    if (event.code !== 1000) finish(undefined, new Error(\`Gateway device probe closed (\${event.code}): \${event.reason}\`));
  });
  socket.addEventListener("message", async (event) => {
    try {
      const frame = JSON.parse(String(event.data));
      if (frame.type === "event" && frame.event === "connect.challenge") {
        const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce : "";
        if (!nonce) throw new Error("Gateway device challenge has no nonce");
        console.log(\`[device-challenge] \${JSON.stringify({ nonce, client, role, scopes })}\`);
        signedConnection = await readHostSignature();
        socket.send(JSON.stringify({
          type: "req",
          id: requestId,
          method: "connect",
          params: {
            minProtocol: 4,
            maxProtocol: 4,
            client,
            role,
            scopes,
            caps: [],
            auth: { token },
            device: signedConnection.device
          }
        }));
        return;
      }
      if (frame.type === "res" && frame.id === requestId) {
        if (!frame.ok) throw new Error(\`\${frame.error?.code ?? "RPC_ERROR"}: \${frame.error?.message ?? "device connect failed"}\`);
        if (frame.payload?.type !== "hello-ok" || frame.payload.protocol !== 4) throw new Error("device probe received an invalid hello");
        const result = {
          deviceId: frame.payload?.auth?.deviceId ?? signedConnection?.device?.id ?? null,
          protocol: frame.payload.protocol,
          serverVersion: frame.payload.server?.version ?? "unknown",
          signatureVersion: signedConnection?.signatureVersion === "v2" ? "v2" : "v3"
        };
        console.log(\`[device-hello] \${JSON.stringify(result)}\`);
        finish(result);
      }
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error("Gateway device probe failed"));
    }
  });
});

await finished;
`,Fe=`import { createInterface } from "node:readline";
import WebSocket from "ws";

const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const sharedToken = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
if (!Number.isInteger(port) || !sharedToken) throw new Error("Gateway pairing probe port and token are required");

const client = {
  id: "openclaw-control-ui",
  version: "clawsembly-browser-probe",
  platform: "browser",
  mode: "webchat",
  instanceId: \`clawsembly-control-ui-\${Date.now().toString(36)}-\${process.pid}\`
};
const role = "operator";
const scopes = ["operator.read", "operator.write"];
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

function readHostSignature(expectedKind) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser host signature timed out")), 15_000);
    input.once("line", (line) => {
      clearTimeout(timeout);
      try {
        const value = JSON.parse(line);
        if (value?.kind !== expectedKind || !value.device) throw new Error("signature kind mismatch");
        resolve(value);
      } catch {
        reject(new Error("browser host returned invalid signature JSON"));
      }
    });
  });
}

function connect({ phase, authToken }) {
  return new Promise((resolve, reject) => {
    const requestId = \`clawsembly-control-ui-\${phase}\`;
    const socket = new WebSocket(\`ws://127.0.0.1:\${port}\`, { origin: \`http://127.0.0.1:\${port}\` });
    let settled = false;
    const timeout = setTimeout(() => finish(undefined, new Error(\`Gateway \${phase} pairing timed out\`)), 25_000);
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "pairing probe complete");
      if (error) reject(error);
      else resolve(value);
    };

    socket.on("error", () => finish(undefined, new Error(\`Gateway \${phase} websocket failed\`)));
    socket.on("close", (code, reason) => {
      if (!settled && code !== 1000) finish(undefined, new Error(\`Gateway \${phase} closed (\${code}): \${String(reason)}\`));
    });
    socket.on("message", async (raw) => {
      try {
        const frame = JSON.parse(String(raw));
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce : "";
          if (!nonce) throw new Error("Gateway pairing challenge has no nonce");
          const challenge = { phase, nonce, client, role, scopes };
          if (phase === "shared-token") console.log(\`[control-ui-pairing-challenge] \${JSON.stringify(challenge)}\`);
          else console.log(\`[device-token-challenge] \${JSON.stringify({ ...challenge, deviceToken: authToken })}\`);
          const signed = await readHostSignature(phase);
          socket.send(JSON.stringify({
            type: "req",
            id: requestId,
            method: "connect",
            params: {
              minProtocol: 4,
              maxProtocol: 4,
              client,
              role,
              scopes,
              caps: [],
              auth: phase === "shared-token" ? { token: authToken } : { deviceToken: authToken },
              device: signed.device
            }
          }));
          return;
        }
        if (frame.type === "res" && frame.id === requestId) {
          if (!frame.ok) throw new Error(\`\${frame.error?.code ?? "RPC_ERROR"}: \${frame.error?.message ?? "pairing connect failed"}\`);
          if (frame.payload?.type !== "hello-ok" || frame.payload.protocol !== 4) throw new Error("pairing probe received an invalid hello");
          finish({
            protocol: frame.payload.protocol,
            serverVersion: frame.payload.server?.version ?? "unknown",
            deviceToken: typeof frame.payload?.auth?.deviceToken === "string" ? frame.payload.auth.deviceToken : null
          });
        }
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(\`Gateway \${phase} pairing failed\`));
      }
    });
  });
}

const paired = await connect({ phase: "shared-token", authToken: sharedToken });
if (!paired.deviceToken || paired.deviceToken.length < 16) throw new Error("Gateway did not issue a device token after Control UI pairing");
console.log(\`[control-ui-paired] \${JSON.stringify({ protocol: paired.protocol, serverVersion: paired.serverVersion, deviceTokenIssued: true })}\`);

const reconnected = await connect({ phase: "device-token", authToken: paired.deviceToken });
console.log(\`[device-token-reconnect] \${JSON.stringify({
  protocol: reconnected.protocol,
  serverVersion: reconnected.serverVersion,
  authenticatedWith: "device-token",
  result: "pass"
})}\`);
input.close();
`,Ie=`import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { createInterface } from "node:readline";

const port = Number(process.env.CLAWSEMBLY_HOST_BROKER_PORT ?? 19003);
const capability = process.env.CLAWSEMBLY_HOST_BROKER_CAPABILITY;
const maxRequests = Number(process.env.CLAWSEMBLY_HOST_BROKER_MAX_REQUESTS ?? 4);
const maxBodyBytes = 1024 * 1024;
const pending = new Map();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let requestCount = 0;
const callIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const functionNamePattern = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

if (!capability || capability.length < 24) throw new Error("host broker capability is required");

const expectedAuthorization = Buffer.from(\`Bearer \${capability}\`);

function authorizationMatches(header) {
  const actual = Buffer.from(header ?? "");
  return actual.length === expectedAuthorization.length && timingSafeEqual(actual, expectedAuthorization);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function completionChunk(entry, delta, finishReason = null) {
  entry.response.write(\`data: \${JSON.stringify({
    id: entry.completionId,
    object: "chat.completion.chunk",
    created: entry.created,
    model: "browser-host-broker",
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\\n\\n\`);
}

function completeEntry(entry) {
  if (entry.completed) return;
  entry.completed = true;
  pending.delete(entry.id);
  const finishReason = entry.toolCalls.length > 0 ? "tool_calls" : "stop";
  if (entry.stream) {
    completionChunk(entry, {}, finishReason);
    entry.response.write("data: [DONE]\\n\\n");
    entry.response.end();
    return;
  }
  sendJson(entry.response, 200, {
    id: entry.completionId,
    object: "chat.completion",
    created: entry.created,
    model: "browser-host-broker",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: entry.text || null,
        ...(entry.toolCalls.length > 0 ? { tool_calls: entry.toolCalls } : {})
      },
      finish_reason: finishReason
    }]
  });
}

function failEntry(entry) {
  if (entry.completed) return;
  entry.completed = true;
  pending.delete(entry.id);
  if (entry.stream) entry.response.destroy();
  else sendJson(entry.response, 502, { error: { message: "browser host broker rejected the request" } });
}

function readChatContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) throw new Error("unsupported chat content");
  return content.map((part) => {
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    throw new Error("unsupported chat content part");
  }).join("");
}

function toResponsesInput(messages) {
  const result = [];
  for (const message of messages) {
    const role = message?.role;
    if (role === "tool") {
      const output = readChatContent(message.content);
      if (!callIdPattern.test(message.tool_call_id ?? "") || !output) throw new Error("invalid tool result");
      result.push({ type: "function_call_output", call_id: message.tool_call_id, output });
      continue;
    }
    if (!["system", "developer", "user", "assistant"].includes(role)) throw new Error("unsupported chat role");
    const content = readChatContent(message.content);
    if (content) result.push({ role, content });
    if (role !== "assistant" || message.tool_calls == null) continue;
    if (!Array.isArray(message.tool_calls)) throw new Error("invalid tool calls");
    for (const toolCall of message.tool_calls) {
      const fn = toolCall?.type === "function" ? toolCall.function : null;
      if (!callIdPattern.test(toolCall?.id ?? "") || !functionNamePattern.test(fn?.name ?? "")
        || typeof fn?.arguments !== "string") throw new Error("invalid tool call");
      const parsedArguments = JSON.parse(fn.arguments);
      if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)) {
        throw new Error("invalid tool call arguments");
      }
      result.push({
        type: "function_call",
        call_id: toolCall.id,
        name: fn.name,
        arguments: fn.arguments
      });
    }
  }
  if (result.length === 0 || JSON.stringify(result).length > 100_000) throw new Error("invalid broker input");
  return result;
}

input.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    const entry = pending.get(message?.id);
    if (!entry) return;
    if (message.event === "delta" && typeof message.delta === "string" && message.delta.length > 0) {
      entry.text += message.delta;
      if (entry.text.length > 100_000) return failEntry(entry);
      if (entry.stream) completionChunk(entry, { content: message.delta });
      return;
    }
    if (message.event === "tool_call" && typeof message.callId === "string"
      && typeof message.name === "string" && typeof message.arguments === "string") {
      const toolCall = {
        index: entry.toolCalls.length,
        id: message.callId,
        type: "function",
        function: { name: message.name, arguments: message.arguments }
      };
      entry.toolCalls.push(toolCall);
      if (entry.stream) completionChunk(entry, { tool_calls: [toolCall] });
      return;
    }
    if (message.event === "done") return completeEntry(entry);
    if (message.event === "error") return failEntry(entry);
  } catch {
    // Invalid host messages are ignored; their bounded host request times out.
  }
});

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    sendJson(response, 200, { object: "list", data: [{ id: "broker-v1", object: "model" }] });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "not found" } });
    return;
  }
  if (!authorizationMatches(request.headers.authorization)) {
    sendJson(response, 401, { error: { message: "invalid bridge capability" } });
    return;
  }
  if (requestCount >= maxRequests) {
    sendJson(response, 429, { error: { message: "bridge request budget exhausted" } });
    return;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      sendJson(response, 413, { error: { message: "request too large" } });
      request.destroy();
      return;
    }
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed.model !== "broker-v1" || !Array.isArray(parsed.messages)) throw new Error("invalid broker request");
    const responsesInput = toResponsesInput(parsed.messages);
    const latestUserIndex = parsed.messages.findLastIndex((message) => message?.role === "user");
    const currentTurnMessages = latestUserIndex >= 0 ? parsed.messages.slice(latestUserIndex + 1) : parsed.messages;
    const hasToolResult = currentTurnMessages.some((message) => message?.role === "tool");
    const tools = Array.isArray(parsed.tools) ? parsed.tools.flatMap((tool) => {
      const fn = tool?.type === "function" ? tool.function : null;
      if (!fn || typeof fn.name !== "string" || !fn.parameters || typeof fn.parameters !== "object") return [];
      return [{
        type: "function",
        name: fn.name,
        description: typeof fn.description === "string" ? fn.description : undefined,
        parameters: fn.parameters,
        strict: true
      }];
    }) : [];

    requestCount += 1;
    const created = Math.floor(Date.now() / 1000);
    const id = \`broker-\${Date.now().toString(36)}-\${requestCount}\`;
    const entry = {
      id,
      response,
      stream: parsed.stream === true,
      text: "",
      toolCalls: [],
      created,
      completionId: \`chatcmpl-clawsembly-\${created}-\${requestCount}\`,
      completed: false
    };
    pending.set(id, entry);
    if (entry.stream) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      completionChunk(entry, { role: "assistant" });
    }

    const cancel = () => {
      const active = pending.get(id);
      if (!active || active.completed) return;
      active.completed = true;
      pending.delete(id);
      console.log(\`[host-broker-cancel] \${JSON.stringify({ id })}\`);
    };
    request.once("aborted", cancel);
    response.once("close", () => {
      if (!response.writableEnded) cancel();
    });
    console.log(\`[host-broker-request] \${JSON.stringify({
      id,
      model: parsed.model,
      input: responsesInput,
      stream: entry.stream,
      tools,
      hasToolResult
    })}\`);
  } catch {
    sendJson(response, 400, { error: { message: "browser host broker request failed" } });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(\`[host-broker-ready] \${JSON.stringify({ port, maxRequests, streaming: true, credentialInWebContainer: false })}\`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const entry of pending.values()) {
      entry.completed = true;
      entry.response.destroy();
    }
    pending.clear();
    input.close();
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 250).unref();
  });
}
`,Le=`const port = Number(process.env.CLAWSEMBLY_GATEWAY_PORT);
const token = process.env.CLAWSEMBLY_GATEWAY_TOKEN;
const sessionKey = "agent:broker:clawsembly-host-broker-probe";
const runId = \`clawsembly-host-broker-\${Date.now().toString(36)}-\${process.pid}\`;
const cancelledRunId = \`\${runId}-cancel\`;
const expectedText = "Clawsembly browser-host broker tool round-trip passed.";

if (!Number.isInteger(port) || !token) throw new Error("Gateway broker probe port and token are required");

function withTimeout(promise, label, milliseconds = 40_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(\`\${label} timed out\`)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

const socket = new WebSocket(\`ws://127.0.0.1:\${port}\`);
const pending = new Map();
const events = new Set();
let sequence = 0;
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

function request(method, params, id = \`broker-\${++sequence}\`) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

function waitForEvent(predicate) {
  return new Promise((resolve) => events.add({ predicate, resolve }));
}

socket.addEventListener("error", () => readyReject(new Error("broker probe websocket error")));
socket.addEventListener("close", (event) => {
  const error = new Error(\`broker probe websocket closed (\${event.code}): \${event.reason}\`);
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});
socket.addEventListener("message", (event) => {
  const frame = JSON.parse(String(event.data));
  if (frame.type === "event" && frame.event === "connect.challenge") {
    request("connect", {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "gateway-client",
        version: "clawsembly-host-broker-probe",
        platform: "webcontainer",
        mode: "backend",
        instanceId: runId
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [],
      auth: { token }
    }, "broker-connect").then((hello) => {
      if (hello?.type !== "hello-ok" || hello.protocol !== 4) throw new Error("broker probe returned an invalid hello");
      readyResolve(hello);
    }).catch(readyReject);
    return;
  }
  if (frame.type === "res") {
    const waiter = pending.get(frame.id);
    if (!waiter) return;
    pending.delete(frame.id);
    if (frame.ok) waiter.resolve(frame.payload);
    else waiter.reject(new Error(\`\${frame.error?.code ?? "RPC_ERROR"}: \${frame.error?.message ?? "request failed"}\`));
    return;
  }
  if (frame.type === "event") for (const waiter of [...events]) {
    if (!waiter.predicate(frame)) continue;
    events.delete(waiter);
    waiter.resolve(frame);
  }
});

await withTimeout(ready, "broker probe connect");
const deltaEvent = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === runId && frame.payload?.state === "delta"
), "broker delta event");
const finalEvent = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === runId && frame.payload?.state === "final"
), "broker final event");
await withTimeout(request("chat.send", {
  sessionKey,
  message: "Reply through the browser-host provider broker.",
  deliver: false,
  timeoutMs: 30_000,
  idempotencyKey: runId
}), "broker chat.send");
await deltaEvent;
const finalFrame = await finalEvent;
if (!JSON.stringify(finalFrame.payload?.message).includes(expectedText)) throw new Error("browser-host broker response did not reach OpenClaw");

const cancellationDelta = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "delta"
), "broker cancellation delta");
const cancellationAborted = withTimeout(waitForEvent(
  (frame) => frame.event === "chat" && frame.payload?.runId === cancelledRunId && frame.payload?.state === "aborted"
), "broker cancellation aborted");
await withTimeout(request("chat.send", {
  sessionKey,
  message: "BROKER_CANCEL_ME after the first streamed delta.",
  deliver: false,
  timeoutMs: 30_000,
  idempotencyKey: cancelledRunId
}), "broker cancellation chat.send");
await cancellationDelta;
const abortResult = await withTimeout(request("chat.abort", { sessionKey, runId: cancelledRunId }), "broker chat.abort");
if (abortResult?.aborted !== true || !abortResult.runIds?.includes(cancelledRunId)) {
  throw new Error("browser-host broker chat.abort did not report the active run");
}
console.log(\`[host-broker-abort] \${JSON.stringify({ runId: cancelledRunId })}\`);
await cancellationAborted;

console.log(JSON.stringify({
  event: "host-broker-turn",
  state: "final",
  provider: "clawsembly-browser-host/broker-v1",
  response: expectedText,
  streaming: true,
  deltaObserved: true,
  toolRoundTrip: true,
  cancellation: true,
  abortRpc: true,
  result: "pass"
}));

if (socket.readyState !== WebSocket.CLOSED) {
  const closed = new Promise((resolve) => socket.addEventListener("close", resolve, { once: true }));
  socket.close(1000, "broker probe complete");
  await withTimeout(closed, "broker probe close", 5_000);
}
`,Re=`import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

async function measureTree(root) {
  const result = { root, bytes: 0, files: 0, directories: 0, symlinks: 0 };
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    result.directories += 1;
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      const metadata = await lstat(target);
      result.bytes += metadata.size;
      if (entry.isSymbolicLink()) result.symlinks += 1;
      else result.files += 1;
    }
  }
  return result;
}

const nodeModules = await measureTree("node_modules");
const npmCache = await measureTree(path.join(homedir(), ".npm"));
console.log(JSON.stringify({ nodeModules, npmCache }));
`,ze=`import crypto from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function readRawEd25519PublicKey(key) {
  if (typeof key === "string" && !key.includes("BEGIN")) {
    const normalized = key.replaceAll("-", "+").replaceAll("_", "/");
    const raw = Buffer.from(normalized + "=".repeat((4 - normalized.length % 4) % 4), "base64");
    return raw.byteLength === 32 ? raw : undefined;
  }
  const publicKey = key?.type === "public" && typeof key.export === "function" ? key : crypto.createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "ed25519") return undefined;
  const der = Buffer.from(publicKey.export({ type: "spki", format: "der" }));
  if (der.byteLength !== ED25519_SPKI_PREFIX.byteLength + 32
    || !der.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)) return undefined;
  return der.subarray(ED25519_SPKI_PREFIX.byteLength);
}

export function verifyEd25519WithNoble(data, key, signature) {
  const rawPublicKey = readRawEd25519PublicKey(key);
  if (!rawPublicKey) return false;
  try {
    const signatureBytes = typeof signature === "string"
      ? Buffer.from(signature.replaceAll("-", "+").replaceAll("_", "/"), "base64")
      : Buffer.from(signature);
    return ed25519.verify(signatureBytes, Buffer.from(data), rawPublicKey);
  } catch {
    return false;
  }
}
`,Be=`import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const IMPORT_MARKER = 'import crypto from "node:crypto";';
const VERIFY_MARKER = 'return crypto.verify(null, Buffer.from(payload, "utf8"), key, sig);';
const VERIFY_TAIL_MARKER = \`\${VERIFY_MARKER}\\n\\t} catch {\\n\\t\\treturn false;\\n\\t}\`;
const FALLBACK_IMPORT = 'import { verifyEd25519WithNoble } from "../../../adapter/ed25519-verify-adapter.mjs";';

export function patchOpenClawEd25519Source(source) {
  if (source.includes(FALLBACK_IMPORT)) return source;
  if (!source.includes(IMPORT_MARKER) || !source.includes(VERIFY_TAIL_MARKER)) {
    throw new Error("OpenClaw Ed25519 verifier markers changed; refusing to patch");
  }
  return source
    .replace(IMPORT_MARKER, \`\${IMPORT_MARKER}\\n\${FALLBACK_IMPORT}\`)
    .replace(
      VERIFY_TAIL_MARKER,
      \`let nativeValid = false;\\n\\t\\ttry { nativeValid = crypto.verify(null, Buffer.from(payload, "utf8"), key, sig); } catch {}\\n\\t\\treturn nativeValid || verifyEd25519WithNoble(Buffer.from(payload, "utf8"), publicKey, sig);\\n\\t} catch {\\n\\t\\treturn verifyEd25519WithNoble(Buffer.from(payload, "utf8"), publicKey, signatureBase64Url);\\n\\t}\`
    );
}

export function patchInstalledOpenClaw(root = process.cwd()) {
  const dist = path.join(root, "node_modules", "openclaw", "dist");
  const candidates = fs.readdirSync(dist).filter((name) => name.startsWith("device-identity-") && name.endsWith(".js"));
  const patchedTargets = [];
  let changed = false;
  for (const name of candidates) {
    const target = path.join(dist, name);
    const source = fs.readFileSync(target, "utf8");
    if (!source.includes(VERIFY_TAIL_MARKER) && !source.includes(FALLBACK_IMPORT)) continue;
    const patched = patchOpenClawEd25519Source(source);
    if (patched !== source) {
      fs.writeFileSync(target, patched);
      changed = true;
    }
    patchedTargets.push(path.relative(root, target));
  }
  if (patchedTargets.length === 0) throw new Error("OpenClaw Ed25519 verifier module was not found");
  return { target: patchedTargets[0], targets: patchedTargets, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = patchInstalledOpenClaw();
  console.log(JSON.stringify({ adapter: "ed25519-noble-fallback", ...result, result: "pass" }));
}
`,Ve=`clawsembly-mock-state.bin`,He=`clawsembly-mock-state.v1`,K=new TextEncoder().encode(`CLAWBKP1`),q=K.byteLength+4,Ue=20*1024*1024,We=16*1024;function Ge(e){if(e.byteLength===0)throw Error(`state snapshot is empty`);if(e.byteLength>Ue)throw Error(`state snapshot exceeds the 20 MB safety limit`);return e}function Ke(e,t){return e.byteLength===t.byteLength&&e.every((e,n)=>e===t[n])}function qe(e){return Array.from(new Uint8Array(e),e=>e.toString(16).padStart(2,`0`)).join(``)}async function Je(e){let t=new Uint8Array(e.byteLength);return t.set(e),qe(await crypto.subtle.digest(`SHA-256`,t.buffer))}function Ye(e){if(!e||typeof e!=`object`)throw Error(`backup manifest is not an object`);let t=e;if(t.format!==`clawsembly.mock-state`||t.version!==1)throw Error(`unsupported Clawsembly backup format`);if(t.scope!==`.clawsembly-openclaw`)throw Error(`backup scope is not supported`);if(typeof t.createdAt!=`string`||!Number.isFinite(Date.parse(t.createdAt)))throw Error(`backup timestamp is invalid`);if(typeof t.openclawVersion!=`string`||!t.openclawVersion)throw Error(`backup OpenClaw version is missing`);if(t.snapshot?.encoding!==`webcontainer-export-binary`||!Number.isSafeInteger(t.snapshot.bytes)||typeof t.snapshot.sha256!=`string`||!/^[a-f0-9]{64}$/.test(t.snapshot.sha256))throw Error(`backup snapshot metadata is invalid`);return t}async function Xe(){if(typeof navigator.storage.getDirectory!=`function`)throw Error(`OPFS is unavailable in this browser`);return navigator.storage.getDirectory()}async function Ze(e){try{let t=await(await(await Xe()).getFileHandle(e)).getFile();return new Uint8Array(await t.arrayBuffer())}catch(e){if(e instanceof DOMException&&e.name===`NotFoundError`)return;throw e}}async function Qe(e,t){let n=await(await(await Xe()).getFileHandle(e,{create:!0})).createWritable(),r=new Uint8Array(t.byteLength);r.set(t),await n.write(r.buffer),await n.close()}async function $e(e,t,n=new Date){Ge(e);let r={format:`clawsembly.mock-state`,version:1,createdAt:n.toISOString(),openclawVersion:t,scope:`.clawsembly-openclaw`,snapshot:{encoding:`webcontainer-export-binary`,bytes:e.byteLength,sha256:await Je(e)}},i=new TextEncoder().encode(JSON.stringify(r));if(i.byteLength>We)throw Error(`backup manifest exceeds the safety limit`);let a=new Uint8Array(q+i.byteLength+e.byteLength);return a.set(K,0),new DataView(a.buffer).setUint32(K.byteLength,i.byteLength,!1),a.set(i,q),a.set(e,q+i.byteLength),a}async function J(e){if(e.byteLength<q||!Ke(e.subarray(0,K.byteLength),K))throw Error(`not a Clawsembly backup`);let t=new DataView(e.buffer,e.byteOffset,e.byteLength).getUint32(K.byteLength,!1);if(t===0||t>We||q+t>=e.byteLength)throw Error(`backup manifest length is invalid`);let n;try{n=JSON.parse(new TextDecoder(`utf-8`,{fatal:!0}).decode(e.subarray(q,q+t)))}catch{throw Error(`backup manifest is invalid JSON`)}let r=Ye(n),i=Ge(e.slice(q+t));if(r.snapshot.bytes!==i.byteLength)throw Error(`backup snapshot length does not match its manifest`);if(await Je(i)!==r.snapshot.sha256)throw Error(`backup snapshot checksum does not match its manifest`);return{manifest:r,snapshot:i}}async function et(e){await J(e);let t=e.slice(),n=t.byteLength-1;t[n]=(t[n]??0)^1;let r=!1;try{await J(t)}catch(e){r=e instanceof Error&&e.message.includes(`checksum`)}let i=e.slice(),a=new DataView(i.buffer).getUint32(K.byteLength,!1),o=new TextDecoder().decode(i.subarray(q,q+a)).indexOf(`"version":1`);if(o<0)throw Error(`backup version marker is missing`);i[q+o+11-1]=50;let s=!1;try{await J(i)}catch(e){s=e instanceof Error&&e.message.includes(`unsupported`)}if(!r||!s)throw Error(`backup negative validation probe failed`);return{checksumMismatchRejected:!0,unknownVersionRejected:!0}}async function tt(e){let t=await e.export(`.clawsembly-openclaw`,{format:`binary`});if(!(t instanceof Uint8Array))throw Error(`WebContainer returned a non-binary state snapshot`);return Ge(t)}async function nt(e,t){await Qe(He,await $e(e,t))}async function rt(){let e=await Ze(He);if(e)return(await J(e)).snapshot;let t=await Ze(Ve);if(!t)return;let n=Ge(t);return await nt(n,document.documentElement.dataset.openclawVersion??`unknown`),await(await Xe()).removeEntry(Ve).catch(()=>void 0),n}async function it(e){let t=await Ze(He);if(t)return await J(t),t;let n=await rt();if(!n)return;let r=await $e(n,e);return await Qe(He,r),r}async function at(e){let t=await J(e);return await Qe(He,e),t}async function ot(){let e=await Xe();for(let t of[He,Ve])await e.removeEntry(t).catch(e=>{if(!(e instanceof DOMException)||e.name!==`NotFoundError`)throw e})}function st(e){return e<1024?`${e} B`:`${(e/1024).toFixed(1)} KB`}var ct=`clawsembly-local-probe-token`,lt=`clawsembly-ephemeral-host-broker-probe`;function Y(e){return e.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g,``).replace(/\r/g,``)}function X(e,t){e.textContent=`${e.textContent??``}${Y(t)}`.slice(-12e3),e.scrollTop=e.scrollHeight}function Z(e,t,n){let r=Array.from(document.querySelectorAll(`[data-probe-output] li`))[e];if(!r)return;r.dataset.state=t;let i=r.querySelector(`em`);i&&(i.textContent=n)}async function ut(e){let t=await e.spawn(`node`,[`--version`]),n=``,r=t.output.pipeTo(new WritableStream({write(e){n+=e}})),i=await t.exit;return await r,{code:i,output:n.trim()}}async function dt(e,t,n,r=2){let i={code:-1,output:``};for(let a=1;a<=r;a+=1){let o=await e.spawn(t,n),s=``,c=o.output.pipeTo(new WritableStream({write(e){s+=e}})),l=await o.exit;if(await c,i={code:l,output:s},l===0)return{...i,attempts:a};a<r&&await new Promise(e=>window.setTimeout(e,250))}return{...i,attempts:r}}async function ft(e){let t=[`const { DatabaseSync } = require("node:sqlite")`,`const db = new DatabaseSync(":memory:")`,`console.log(JSON.stringify({ close: typeof db.close, exec: typeof db.exec, prepare: typeof db.prepare }))`,`if (typeof db.close === "function") db.close()`].join(`;`),n=await e.spawn(`node`,[`-e`,t],{env:{NODE_NO_WARNINGS:`1`}}),r=``,i=n.output.pipeTo(new WritableStream({write(e){r+=e}})),a=await n.exit;if(await i,a!==0)throw Error(`node:sqlite probe exited with ${a}: ${Y(r).trim()}`);let o=Y(r).trim().split(`
`).find(e=>e.startsWith(`{`));if(!o)throw Error(`node:sqlite probe returned no JSON result`);return JSON.parse(o)}async function pt(e){let t=[`import fs from 'node:fs'`,`import path from 'node:path'`,`const root = '.clawsembly-openclaw'`,`function walk(directory) {`,`  const files = []`,`  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {`,`    const target = path.join(directory, entry.name)`,`    if (entry.isDirectory()) files.push(...walk(target))`,`    else files.push(target)`,`  }`,`  return files`,`}`,`const transcripts = walk(root).filter((file) => file.endsWith('.jsonl'))`,`const content = transcripts.map((file) => fs.readFileSync(file, 'utf8')).join('\\n')`,`const result = { transcriptFiles: transcripts.length, userMessage: content.includes('Reply with the deterministic mock response.'), assistantMessage: content.includes('Clawsembly tool round-trip passed.') }`,`console.log(JSON.stringify(result))`,`if (!result.transcriptFiles || !result.userMessage || !result.assistantMessage) process.exit(1)`].join(`
`),n=await e.spawn(`node`,[`--input-type=module`,`-e`,t]),r=``,i=n.output.pipeTo(new WritableStream({write(e){r+=e}})),a=await n.exit;await i;let o=Y(r).trim().split(`
`).find(e=>e.startsWith(`{`));if(a!==0||!o)throw Error(`recovered transcript verification failed: ${r.trim()}`);return JSON.parse(o)}async function mt(e,t,n){let r=await e.spawn(`node`,[`adapter/gateway-device-identity-probe.mjs`],{env:{NO_COLOR:`1`,CLAWSEMBLY_GATEWAY_PORT:String(t),CLAWSEMBLY_GATEWAY_TOKEN:n}}),i=r.input.getWriter(),a=``,o=``,s=``,c=r.output.pipeTo(new WritableStream({async write(e){a+=e,o+=e;let t=o.split(`
`);o=t.pop()??``;for(let e of t){if(!e.startsWith(`[device-challenge] `))continue;let t=JSON.parse(e.slice(19)),r=Date.now(),a=await be({clientId:t.client.id,clientMode:t.client.mode,role:t.role,scopes:t.scopes,signedAtMs:r,token:n,nonce:t.nonce,platform:t.client.platform,deviceFamily:t.client.deviceFamily},`v3`);s=a.id,await i.write(`${JSON.stringify({device:a,signatureVersion:`v3`})}\n`),await i.close()}}})),l=await r.exit;if(await c,l!==0)throw Error(`browser-host device handshake exited with ${l}: ${Y(a).trim()}`);let u=Y(a).split(`
`).find(e=>e.startsWith(`[device-hello] `));if(!u)throw Error(`browser-host device handshake returned no hello: ${a.trim()}`);let d=JSON.parse(u.slice(15)),f=await G();if(!s||s!==f.deviceId||d.protocol!==4)throw Error(`browser-host device identity did not match the Gateway handshake`);return{deviceId:f.deviceId,...d}}async function ht(e,t,n){let r=await e.spawn(`node`,[`adapter/gateway-control-ui-pairing-probe.mjs`],{env:{NO_COLOR:`1`,CLAWSEMBLY_GATEWAY_PORT:String(t),CLAWSEMBLY_GATEWAY_TOKEN:n}}),i=r.input.getWriter(),a=``,o=``,s=``,c=!1,l=``,u=r.output.pipeTo(new WritableStream({async write(e){o+=Y(e);let t=o.split(`
`);o=t.pop()??``;for(let e of t){if(e.startsWith(`[control-ui-pairing-challenge] `)){let t=JSON.parse(e.slice(31)),r=await be({clientId:t.client.id,clientMode:t.client.mode,role:t.role,scopes:t.scopes,signedAtMs:Date.now(),token:n,nonce:t.nonce,platform:t.client.platform,deviceFamily:t.client.deviceFamily});s=r.id,await i.write(`${JSON.stringify({kind:`shared-token`,device:r})}\n`),a+=`[control-ui-pairing-challenge] browser-host signature supplied
`;continue}if(e.startsWith(`[device-token-challenge] `)){let t=JSON.parse(e.slice(25));if(typeof t.deviceToken!=`string`||t.deviceToken.length<16)throw Error(`Gateway returned an invalid device token`);c=!0,l=t.deviceToken,await b(`openclaw-device`,t.deviceToken);let n=await S(`openclaw-device`,async e=>be({clientId:t.client.id,clientMode:t.client.mode,role:t.role,scopes:t.scopes,signedAtMs:Date.now(),token:e,nonce:t.nonce,platform:t.client.platform,deviceFamily:t.client.deviceFamily}));if(n.id!==s)throw Error(`paired device identity changed before token reconnect`);await i.write(`${JSON.stringify({kind:`device-token`,device:n})}\n`),await i.close(),a+=`[device-token-challenge] encrypted by browser host; plaintext suppressed
`;continue}a+=`${e}\n`}}})),d=await r.exit;if(await u,o&&!o.startsWith(`[device-token-challenge] `)&&(a+=o),d!==0)throw Error(`Control UI pairing probe exited with ${d}: ${a.trim()}`);let f=a.split(`
`).find(e=>e.startsWith(`[control-ui-paired] `)),p=a.split(`
`).find(e=>e.startsWith(`[device-token-reconnect] `));if(!f||!p||!c)throw Error(`Control UI pairing probe returned incomplete evidence`);let m=JSON.parse(f.slice(20)),h=JSON.parse(p.slice(25)),g=await x(`openclaw-device`),_=await G();if(!g||!l||a.includes(l)||!s||s!==_.deviceId||m.protocol!==4||m.deviceTokenIssued!==!0||h.protocol!==4||h.authenticatedWith!==`device-token`||h.result!==`pass`)throw Error(`browser-host Control UI pairing evidence did not satisfy policy`);return{deviceId:_.deviceId,protocol:m.protocol,serverVersion:m.serverVersion,deviceTokenIssued:!0,deviceTokenEncryptedAtRest:!0,deviceTokenReconnect:!0,tokenPlaintextLogged:!1}}var gt=`modulepreload`,_t=function(e){return`/clawsembly/`+e},vt={},yt=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e=document.getElementsByTagName(`link`),i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href}r=o(t.map(t=>{if(t=_t(t,n),t=s(t),t in vt)return;vt[t]=!0;let r=t.endsWith(`.css`);for(let n=e.length-1;n>=0;n--){let i=e[n];if(i.href===t&&(!r||i.rel===`stylesheet`))return}let i=document.createElement(`link`);if(i.rel=r?`stylesheet`:gt,r||(i.as=`script`),i.crossOrigin=``,i.href=t,a&&i.setAttribute(`nonce`,a),document.head.appendChild(i),r)return new Promise((e,n)=>{i.addEventListener(`load`,e),i.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${t}`)))})}))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})};function bt({gatewayButton:e,installOutput:t,budgetRequestsInput:n,budgetInputCharsInput:r,budgetOutputCharsInput:i,getActiveContainer:a,setActiveContainer:o,getInstallPerformance:s,showStoredState:c}){e?.addEventListener(`click`,async()=>{let l=a();if(!l||!t)return;e.disabled=!0,e.textContent=`Starting Gateway…`;let u=(e,t)=>{let n=Number(e?.value??t);return Number.isSafeInteger(n)&&n>0?n:t},d={maxRequests:u(n,4),maxInputChars:u(r,1e5),maxOutputChars:u(i,1e5)};for(let e of[n,r,i])e&&(e.disabled=!0);X(t,`
$ node adapter/openclaw-bootstrap.mjs --dev gateway --allow-unconfigured --token <ephemeral-probe-token>
`);let f,p,m,h,g,_,v,y=0,x=0,S=!1;try{let n=s();if(!n)throw Error(`install performance evidence is unavailable`);let r=`sk-clawsembly-host-broker-${crypto.randomUUID()}`;await b(`broker-probe`,r);let i={gateway:{controlUi:{allowedOrigins:[`http://127.0.0.1:19001`,`http://localhost:19001`]}},agents:{defaults:{model:{primary:`clawsembly-mock/mock-v1`},skipBootstrap:!0},list:[{id:`main`,default:!0,workspace:`~/.openclaw/workspace-dev`},{id:`broker`,workspace:`~/.openclaw/workspace-broker`,model:`clawsembly-browser-host/broker-v1`}]},models:{mode:`merge`,providers:{"clawsembly-mock":{baseUrl:`http://127.0.0.1:19002/v1`,apiKey:`clawsembly-local`,api:`openai-completions`,models:[{id:`mock-v1`,name:`Clawsembly deterministic mock`,reasoning:!1,input:[`text`],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:12e4,maxTokens:8192}]},"clawsembly-browser-host":{baseUrl:`http://127.0.0.1:19003/v1`,apiKey:lt,api:`openai-completions`,models:[{id:`broker-v1`,name:`Clawsembly browser-host Responses bridge`,reasoning:!1,input:[`text`],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:12e4,maxTokens:8192}]}}},tools:{allow:[`agents_list`]}};await l.fs.mkdir(`.clawsembly-openclaw`,{recursive:!0}),await l.fs.writeFile(`.clawsembly-openclaw/openclaw.json`,JSON.stringify(i,null,2));let a,u=new Promise(e=>{a=e});h=await l.spawn(`node`,[`adapter/mock-openai-server.mjs`],{env:{NO_COLOR:`1`,CLAWSEMBLY_MOCK_PORT:`19002`}}),g=h.output.pipeTo(new WritableStream({write(e){X(t,`[mock-provider] ${e}`),e.includes(`"event":"ready"`)&&a?.()}}));let w=await Promise.race([u.then(()=>`ready`),h.exit.then(()=>`exit`),new Promise(e=>window.setTimeout(()=>e(`timeout`),5e3))]);if(w!==`ready`)throw Error(`mock provider did not start (${w})`);let D,O=new Promise(e=>{D=e}),k=``,ee=0,A=0,j=0,M=0,ne=0,re=0,N=0,P=0,ie=0,F=new te({...d}),I=new Map,oe=[];_=await l.spawn(`node`,[`adapter/host-broker-openai-server.mjs`],{env:{NO_COLOR:`1`,CLAWSEMBLY_HOST_BROKER_PORT:`19003`,CLAWSEMBLY_HOST_BROKER_CAPABILITY:lt,CLAWSEMBLY_HOST_BROKER_MAX_REQUESTS:`4`}});let se=_.input.getWriter(),L=Promise.resolve(),R=e=>(L=L.then(()=>se.write(`${JSON.stringify(e)}\n`)),L);v=_.output.pipeTo(new WritableStream({write(e){k+=Y(e);let n=k.split(`
`);k=n.pop()??``;for(let e of n){if(e.startsWith(`[host-broker-ready] `)){D?.(),X(t,`${e}\n`);continue}if(e.startsWith(`[host-broker-cancel] `)){let n=JSON.parse(e.slice(21)),r=n.id?I.get(n.id):void 0;r&&!r.signal.aborted&&(N+=1,r.abort()),X(t,`[host-broker-cancel] provider AbortSignal triggered
`);continue}if(!e.startsWith(`[host-broker-request] `)){e.trim()&&X(t,`[host-broker-process] ${e}\n`);continue}let n=JSON.parse(e.slice(22));ee+=1;let i=new AbortController;I.set(n.id,i);let a=(async()=>{try{if(n.model!==`broker-v1`||n.stream!==!0||!Array.isArray(n.tools)||n.tools.length!==1||n.tools[0]?.name!==`agents_list`||n.tools[0]?.strict!==!0)throw Error(`unapproved bridge request`);let e=typeof n.input==`string`?n.input:JSON.stringify(n.input),a=e.includes(`BROKER_CANCEL_ME`);n.hasToolResult&&(re+=1),await ae({model:E,input:n.input,tools:n.tools},async(e,t)=>{let i=typeof e==`string`?e:e instanceof URL?e.toString():e.url,o=new Headers(t?.headers),s=JSON.parse(String(t?.body)),c=s.tools,l=s.input,u=Array.isArray(l)?l:[],d=u.filter(e=>`type`in e&&e.type===`function_call`),f=u.filter(e=>`type`in e&&e.type===`function_call_output`).every(e=>e.type===`function_call_output`&&d.some(t=>t.type===`function_call`&&t.call_id===e.call_id)),p=u.findLastIndex(e=>`role`in e&&e.role===`user`),m=u.findLastIndex(e=>`type`in e&&e.type===`function_call_output`)>p;if(!(o.get(`authorization`)===`Bearer ${r}`&&i===`https://api.openai.com/v1/responses`&&t?.method===`POST`&&t.redirect===`error`&&t.credentials===`omit`&&t.referrerPolicy===`no-referrer`&&s.model===`gpt-5.6-luna`&&s.store===!1&&s.stream===!0&&Array.isArray(c)&&c.length===1&&c[0]?.name===`agents_list`&&Array.isArray(l)&&f&&m===n.hasToolResult))throw Error(`browser host broker policy mismatch`);A+=1;let h=new TextEncoder,g=e=>h.encode(`event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`);return new Response(new ReadableStream({start(e){if(e.enqueue(g({type:`response.created`,response:{status:`in_progress`}})),a){e.enqueue(g({type:`response.output_text.delta`,delta:`Broker cancellation started.`}));return}if(!n.hasToolResult){let t={type:`function_call`,id:`fc_clawsembly_agents`,call_id:`call_clawsembly_broker_agents`,name:`agents_list`,arguments:``};e.enqueue(g({type:`response.output_item.added`,item:t})),e.enqueue(g({type:`response.function_call_arguments.delta`,item_id:t.id,delta:`{}`})),e.enqueue(g({type:`response.function_call_arguments.done`,item_id:t.id,arguments:`{}`})),e.enqueue(g({type:`response.completed`,response:{status:`completed`}})),e.close();return}e.enqueue(g({type:`response.output_text.delta`,delta:`Clawsembly browser-host `})),e.enqueue(g({type:`response.output_text.delta`,delta:`broker tool round-trip passed.`})),e.enqueue(g({type:`response.completed`,response:{status:`completed`}})),e.close()},cancel(){P+=1}}),{status:200,headers:{"content-type":`text/event-stream`,"x-request-id":`req_host_broker_probe`}})},`broker-probe`,{onTextDelta:async e=>{j+=1,await R({id:n.id,event:`delta`,delta:e})},onFunctionCall:async e=>{ne+=1,await R({id:n.id,event:`tool_call`,...e})}},i.signal,F),M+=1,await R({id:n.id,event:`done`}),X(t,`[host-broker-request] ${JSON.stringify({modelAlias:n.model,hostModel:E,inputChars:e.length,streaming:!0,credentialInWebContainer:!1,result:`pass`})}\n`)}catch{i.signal.aborted&&(ie+=1),await R({id:n.id,event:`error`}).catch(()=>void 0),i.signal.aborted||X(t,`[host-broker-request] rejected by browser-host policy
`)}finally{I.delete(n.id)}})();oe.push(a)}}}));let ce=await Promise.race([O.then(()=>`ready`),_.exit.then(()=>`exit`),new Promise(e=>window.setTimeout(()=>e(`timeout`),5e3))]);if(ce!==`ready`)throw Error(`browser-host provider bridge did not start (${ce})`);let z=new Promise(e=>{f=l?.on(`server-ready`,(t,n)=>e({port:t,url:n}))}),le,ue=new Promise(e=>{le=e}),de=``,fe=performance.now();p=await l.spawn(`node`,[`adapter/openclaw-bootstrap.mjs`,`--dev`,`gateway`,`--allow-unconfigured`,`--token`,ct],{env:{CI:`1`,NO_COLOR:`1`,OPENCLAW_SKIP_CHANNELS:`1`,OPENCLAW_STATE_DIR:`.clawsembly-openclaw`}}),m=p.output.pipeTo(new WritableStream({write(e){X(t,e),de=`${de}${Y(e)}`.slice(-2e3),de.includes(`[gateway] ready`)&&le?.()}}));let B=await Promise.race([z.then(e=>({kind:`ready`,ready:e})),p.exit.then(e=>({kind:`exit`,code:e})),new Promise(e=>window.setTimeout(()=>e({kind:`timeout`}),4e4))]);if(B.kind===`exit`)throw Error(`Gateway exited before readiness with ${B.code}`);if(B.kind===`timeout`)throw Error(`Gateway did not open a port within 40 seconds`);y=Math.round(performance.now()-fe),X(t,`\n[server-ready] ${B.ready.url} (port ${B.ready.port})\n`);let V=await dt(l,`node`,[`--input-type=module`,`-e`,[`const url = "http://127.0.0.1:${B.ready.port}/healthz"`,`let lastError = 'not ready'`,`for (let attempt = 0; attempt < 20; attempt += 1) {`,`  try {`,`    const response = await fetch(url)`,`    const body = await response.text()`,`    if (response.ok) { console.log(JSON.stringify({ status: response.status, body })); process.exit(0) }`,"    lastError = `HTTP ${response.status}`",`  } catch (error) { lastError = error instanceof Error ? error.message : String(error) }`,`  await new Promise((resolve) => setTimeout(resolve, 1000))`,`}`,`console.error(lastError)`,`process.exit(1)`].join(`
`)]);if(X(t,`[healthz] ${V.output.trim()}${V.attempts>1?` [attempts=${V.attempts}]`:``}\n`),V.code!==0)throw Error(`internal /healthz probe failed`);let pe=await dt(l,`node`,[`--input-type=module`,`-e`,[`const url = "http://127.0.0.1:${B.ready.port}/readyz"`,`let lastError = 'not ready'`,`for (let attempt = 0; attempt < 60; attempt += 1) {`,`  try {`,`    const response = await fetch(url)`,`    const body = await response.text()`,`    if (response.ok) { console.log(JSON.stringify({ status: response.status, body })); process.exit(0) }`,"    lastError = `HTTP ${response.status}: ${body}`",`  } catch (error) { lastError = error instanceof Error ? error.message : String(error) }`,`  await new Promise((resolve) => setTimeout(resolve, 500))`,`}`,`console.error(lastError)`,`process.exit(1)`].join(`
`)]);if(X(t,`[readyz] ${pe.output.trim()}${pe.attempts>1?` [attempts=${pe.attempts}]`:``}\n`),pe.code!==0)throw Error(`internal /readyz probe failed`);let me=await Promise.race([ue.then(()=>`ready`),p.exit.then(()=>`exit`),new Promise(e=>window.setTimeout(()=>e(`timeout`),3e4))]);if(me!==`ready`)throw Error(`Gateway did not reach protocol readiness (${me})`);x=Math.round(performance.now()-fe),X(t,`[gateway-ready] protocol services available
`);let he=await mt(l,B.ready.port,ct);X(t,`[device-handshake] ${JSON.stringify({deviceId:he.deviceId,protocol:he.protocol,serverVersion:he.serverVersion,signatureVersion:he.signatureVersion,privateKeyInWebContainer:!1,result:`pass`})}\n`);let H=await ht(l,B.ready.port,ct);X(t,`[device-pairing] ${JSON.stringify({deviceId:H.deviceId,protocol:H.protocol,serverVersion:H.serverVersion,deviceTokenIssued:H.deviceTokenIssued,deviceTokenEncryptedAtRest:H.deviceTokenEncryptedAtRest,deviceTokenReconnect:H.deviceTokenReconnect,tokenPlaintextLogged:H.tokenPlaintextLogged,result:`pass`})}\n`),window.dispatchEvent(new CustomEvent(`clawsembly:device-token-stored`));let ge=await l.spawn(`node`,[`adapter/gateway-host-broker-turn-probe.mjs`],{env:{NO_COLOR:`1`,CLAWSEMBLY_GATEWAY_PORT:String(B.ready.port),CLAWSEMBLY_GATEWAY_TOKEN:ct}}),U=``,_e=``,ve=ge.output.pipeTo(new WritableStream({write(e){let n=Y(e);U+=n,_e+=n;let r=_e.split(`
`);_e=r.pop()??``;for(let e of r){if(!e.startsWith(`[host-broker-abort] `))continue;let n=[...I.values()].find(e=>!e.signal.aborted);n&&(N+=1,n.abort(),X(t,`[host-broker-cancel] provider AbortSignal triggered
`))}}})),ye=await ge.exit;await ve,await Promise.all(oe),await L;let W=F.snapshot(),be=Y(U).trim().split(`
`).find(e=>e.startsWith(`{`));if(ye!==0||!be)throw Error(`browser-host broker turn failed: ${Y(U).trim()}`);let G=JSON.parse(be);if(G.event!==`host-broker-turn`||G.state!==`final`||G.streaming!==!0||G.deltaObserved!==!0||G.toolRoundTrip!==!0||G.cancellation!==!0||G.abortRpc!==!0||G.result!==`pass`||ee!==3||A!==3||M!==2||ne!==1||re!==1||j<3||N!==1||P!==1||ie!==1||W.requestsUsed!==3||W.inputCharsUsed<=0||W.inputCharsUsed>W.maxInputChars||W.outputCharsUsed<=0||W.outputCharsUsed>W.maxOutputChars||(t.textContent??``).includes(r))throw Error(`browser-host broker turn evidence did not satisfy policy`);X(t,`[host-broker-turn] ${JSON.stringify({openclawAgent:`broker`,providerAlias:`clawsembly-browser-host/broker-v1`,hostModel:E,endpoint:T,store:!1,streaming:!0,typedDeltas:!0,toolRoundTrip:!0,responsesFunctionResultInput:!0,budget:W,cancellationPropagated:!0,credentialInWebContainer:!1,credentialPlaintextLogged:!1,responseReachedOpenClaw:!0,result:`pass`})}\n`),await C(`broker-probe`);let xe=await l.spawn(`node`,[`adapter/gateway-lifecycle-probe.mjs`],{env:{NO_COLOR:`1`,CLAWSEMBLY_GATEWAY_PORT:String(B.ready.port),CLAWSEMBLY_GATEWAY_TOKEN:ct}}),Se=``,Ce=xe.output.pipeTo(new WritableStream({write(e){Se+=e}})),we=await xe.exit;if(await Ce,X(t,`[lifecycle] ${Se.trim()}\n`),we!==0)throw Error(`Gateway lifecycle probe failed`);if(e.textContent=`Persisting state…`,p){try{p.kill()}catch{}await p.exit.catch(()=>void 0),await m?.catch(()=>void 0),p=void 0,m=void 0}if(h){try{h.kill()}catch{}await h.exit.catch(()=>void 0),await g?.catch(()=>void 0),h=void 0,g=void 0}if(_){try{_.kill()}catch{}await _.exit.catch(()=>void 0),await v?.catch(()=>void 0),_=void 0,v=void 0}f?.(),f=void 0;let Te=await tt(l),Ee=document.documentElement.dataset.openclawVersion??`unknown`;await nt(Te,Ee);let De=await it(Ee);if(!De)throw Error(`versioned state backup was not persisted`);let Oe=await J(De),ke=await et(De);c(Te),l.teardown(),o(void 0);let{WebContainer:Ae}=await yt(async()=>{let{WebContainer:e}=await import(`./dist-B34b4zPA.js`);return{WebContainer:e}},[]),je=await Ae.boot({coep:`credentialless`});await je.fs.mkdir(`.clawsembly-openclaw`,{recursive:!0});let Me=await rt();if(!Me)throw Error(`OPFS snapshot disappeared before recovery`);await je.mount(Me,{mountPoint:`.clawsembly-openclaw`});let Ne=await pt(je);o(je),X(t,`[opfs-recovery] ${JSON.stringify({snapshotBytes:Te.byteLength,backupVersion:Oe.manifest.version,integrity:`sha256`,...ke,...Ne,runtimeRestart:!0,result:`pass`})}\n`),X(t,`[runtime-performance] ${JSON.stringify({...n,gatewayPortReadyMs:y,gatewayProtocolReadyMs:x,result:`pass`})}\n`),S=!0,e.textContent=`Runtime + recovery passed`}catch(n){X(t,`\n[probe failed] ${n instanceof Error?n.message:`unknown Gateway error`}\n`),e.textContent=`Gateway probe failed`}finally{for(let e of[n,r,i])e&&(e.disabled=!1);if(p){try{p.kill()}catch{}await p.exit.catch(()=>void 0),await m?.catch(()=>void 0)}if(h){try{h.kill()}catch{}await h.exit.catch(()=>void 0),await g?.catch(()=>void 0)}if(_){try{_.kill()}catch{}await _.exit.catch(()=>void 0),await v?.catch(()=>void 0)}await C(`broker-probe`).catch(()=>void 0),f?.(),window.setTimeout(()=>{e.disabled=S},1800)}})}var Q,xt,St;function Ct(){let e=document.querySelector(`[data-run-probe]`),t=document.querySelector(`[data-run-openclaw-probe]`),n=document.querySelector(`[data-run-gateway-probe]`),r=document.querySelector(`[data-install-output]`),i=document.querySelector(`[data-export-state]`),a=document.querySelector(`[data-import-state]`),o=document.querySelector(`[data-clear-state]`),s=document.querySelector(`[data-storage-status]`),c=document.querySelector(`[data-budget-requests]`),l=document.querySelector(`[data-budget-input]`),u=document.querySelector(`[data-budget-output]`);if(!e)return;let d=(e,t)=>{xt=e,i&&(i.disabled=!e),s&&(s.textContent=t??(e?`Saved mock state: ${st(e.byteLength)} · v1 verified · origin-private storage`:`No saved mock state`))};rt().then(e=>d(e)).catch(e=>d(void 0,e instanceof Error?e.message:`Unable to inspect saved state`)),i?.addEventListener(`click`,async()=>{let e=document.documentElement.dataset.openclawVersion??`unknown`,t=await it(e);if(!t)return;let n=new Uint8Array(t.byteLength);n.set(t);let r=URL.createObjectURL(new Blob([n.buffer],{type:`application/vnd.clawsembly.backup`})),i=document.createElement(`a`);i.href=r,i.download=`clawsembly-mock-state-${e}.clawsembly-backup`,i.click(),URL.revokeObjectURL(r)}),a?.addEventListener(`change`,async()=>{let e=a.files?.[0];if(e)try{let t=await at(new Uint8Array(await e.arrayBuffer()));d(t.snapshot,`Imported v${t.manifest.version} mock state: ${st(t.snapshot.byteLength)} · OpenClaw ${t.manifest.openclawVersion}`)}catch(e){d(xt,e instanceof Error?e.message:`State import failed`)}finally{a.value=``}}),o?.addEventListener(`click`,async()=>{try{await ot(),d(void 0)}catch(e){d(xt,e instanceof Error?e.message:`Unable to clear saved state`)}}),e.addEventListener(`click`,async()=>{e.disabled=!0,e.textContent=`Running preflight…`;let r=window.crossOriginIsolated,i=typeof SharedArrayBuffer<`u`;if(Z(0,r?`pass`:`fail`,String(r)),Z(1,i?`pass`:`fail`,i?`available`:`unavailable`),!r||!i){Z(2,`fail`,`host headers required`),Z(3,`fail`,`not attempted`),Z(4,`fail`,`not attempted`),e.textContent=`Host is not isolated`;return}try{Q?.teardown(),Q=void 0,t&&(t.disabled=!0),n&&(n.disabled=!0),Z(2,`running`,`booting…`);let{WebContainer:r}=await yt(async()=>{let{WebContainer:e}=await import(`./dist-B34b4zPA.js`);return{WebContainer:e}},[]);Q=await r.boot({coep:`credentialless`});let i=await rt();i&&(await Q.fs.mkdir(`.clawsembly-openclaw`,{recursive:!0}),await Q.mount(i,{mountPoint:`.clawsembly-openclaw`}),d(i,`Mounted saved mock state: ${st(i.byteLength)}`)),Z(2,`pass`,`ready`),Z(3,`running`,`spawning…`);let a=await ut(Q);if(a.code!==0||!a.output.startsWith(`v`))throw Error(a.output||`node exited with ${a.code}`);Z(3,`pass`,a.output),Z(4,`running`,`probing…`);let o=await ft(Q);Z(4,o.close===`function`&&o.exec===`function`&&o.prepare===`function`?`pass`:`fail`,`close=${o.close}; exec=${o.exec}; prepare=${o.prepare}`),e.textContent=`Probe complete`,t&&(t.disabled=!1,t.textContent=`Install pinned OpenClaw`)}catch(t){Z(2,`fail`,(t instanceof Error?t.message:`unknown boot error`).slice(0,80)),Z(3,`fail`,`not available`),Z(4,`fail`,`not available`),e.textContent=`Probe failed`}finally{window.setTimeout(()=>{e.disabled=!1,e.textContent=`Run again`},1800)}}),t?.addEventListener(`click`,async()=>{if(!Q||!r)return;let e=document.documentElement.dataset.openclawVersion;if(e){t.disabled=!0,t.textContent=`Installing…`,St=void 0,r.hidden=!1,r.textContent=`$ npm install openclaw@${e}\n`;try{await Q.mount({"package.json":{file:{contents:JSON.stringify({name:`clawsembly-probe`,private:!0,dependencies:{openclaw:e,"sql.js":`1.14.1`,"@noble/curves":`2.2.0`,ws:`8.21.0`}},null,2)}},adapter:{directory:{"node-sqlite-polyfill.mjs":{file:{contents:Ae}},"ed25519-verify-adapter.mjs":{file:{contents:ze}},"openclaw-ed25519-source-patch.mjs":{file:{contents:Be}},"openclaw-bootstrap.mjs":{file:{contents:je}},"mock-openai-server.mjs":{file:{contents:Me}},"gateway-lifecycle-probe.mjs":{file:{contents:Ne}},"gateway-device-identity-probe.mjs":{file:{contents:Pe}},"gateway-control-ui-pairing-probe.mjs":{file:{contents:Fe}},"host-broker-openai-server.mjs":{file:{contents:Ie}},"gateway-host-broker-turn-probe.mjs":{file:{contents:Le}},"measure-install-footprint.mjs":{file:{contents:Re}}}}});let i=performance.now(),a=performance.now(),o=await Q.spawn(`npm`,[`install`,`--no-audit`,`--no-fund`,`--no-progress`,`--loglevel`,`warn`],{env:{CI:`1`,NO_COLOR:`1`}}),s=o.output.pipeTo(new WritableStream({write(e){X(r,e)}})),c=await o.exit;if(await s,c!==0)throw Error(`npm install exited with ${c}`);let l=Math.round(performance.now()-a),u=JSON.parse(await Q.fs.readFile(`node_modules/openclaw/package.json`,`utf8`)),d=Object.keys(u.dependencies??{}),f=[];try{f=await Q.fs.readdir(`node_modules/openclaw/node_modules`)}catch{f=[]}X(r,`\n[dependency-tree] ${d.length} declared; ${f.length} nested entries installed\n`);let p=0;if(d.includes(`json5`)&&!f.includes(`json5`)){X(r,`[adapter] WebContainer npm omitted the published nested dependency tree; installing the pinned package prefix explicitly.
`);let e=performance.now(),t=await Q.spawn(`npm`,[`install`,`--prefix`,`node_modules/openclaw`,`--omit=dev`,`--omit=optional`,`--ignore-scripts`,`--no-audit`,`--no-fund`,`--no-progress`,`--loglevel`,`warn`],{env:{CI:`1`,NO_COLOR:`1`}}),n=t.output.pipeTo(new WritableStream({write(e){X(r,e)}})),i=await t.exit;if(await n,i!==0)throw Error(`nested dependency install exited with ${i}`);p=Math.round(performance.now()-e)}let m=Math.round(performance.now()-i);X(r,`
$ npm install # warm-cache measurement
`);let h=performance.now(),g=await Q.spawn(`npm`,[`install`,`--no-audit`,`--no-fund`,`--no-progress`,`--loglevel`,`error`],{env:{CI:`1`,NO_COLOR:`1`}}),_=``,v=g.output.pipeTo(new WritableStream({write(e){_+=e}})),y=await g.exit;if(await v,y!==0)throw Error(`warm npm install exited with ${y}: ${Y(_).trim()}`);let b=Math.round(performance.now()-h),x=await dt(Q,`node`,[`adapter/measure-install-footprint.mjs`]),S=Y(x.output).trim().split(`
`).find(e=>e.startsWith(`{`));if(x.code!==0||!S)throw Error(`install footprint measurement failed: ${x.output.trim()}`);let C=JSON.parse(S);St={coldRootInstallMs:l,nestedRepairMs:p,coldTotalMs:m,warmInstallMs:b,nodeModules:C.nodeModules,npmCache:C.npmCache},X(r,`[install-performance] ${JSON.stringify(St)}\n`),X(r,`
$ npx --no-install openclaw --version
`);let w=await Q.spawn(`npx`,[`--no-install`,`openclaw`,`--version`]),T=``,E=w.output.pipeTo(new WritableStream({write(e){T+=e}})),D=await w.exit;if(await E,X(r,T),D!==0)throw Error(`OpenClaw version check exited with ${D}`);let O=await Q.spawn(`node`,[`adapter/openclaw-ed25519-source-patch.mjs`]),k=``,ee=O.output.pipeTo(new WritableStream({write(e){k+=e}})),A=await O.exit;if(await ee,X(r,`[source-patch] ${k.trim()}\n`),A!==0)throw Error(`Ed25519 source patch failed`);t.textContent=`Install probe passed`,n&&(n.disabled=!1,n.textContent=`Run lifecycle probe`)}catch(e){let n=e instanceof Error?e.message:`unknown install error`;X(r,`\n[probe failed] ${n}\n`),t.textContent=`Install probe failed`}finally{window.setTimeout(()=>{t.disabled=!1},1800)}}}),bt({gatewayButton:n,installOutput:r,budgetRequestsInput:c,budgetInputCharsInput:l,budgetOutputCharsInput:u,getActiveContainer:()=>Q,setActiveContainer:e=>{Q=e},getInstallPerformance:()=>St,showStoredState:d}),window.addEventListener(`beforeunload`,()=>Q?.teardown(),{once:!0})}var wt=e=>Array.from(document.querySelectorAll(e)),$=(e,t)=>wt(e).forEach(e=>{e.textContent=t});function Tt(e){return`${(e/1e6).toFixed(1)} MB`}function Et(e){let t=document.querySelector(`[data-checks]`);t&&t.replaceChildren(...e.map(e=>{let t=document.createElement(`div`);t.className=`check-row`;let n=document.createElement(`span`);n.className=`check-state check-${e.status}`,n.setAttribute(`aria-label`,e.status),n.textContent=e.status;let r=document.createElement(`strong`);r.textContent=e.label;let i=document.createElement(`p`);return i.textContent=e.detail,t.append(n,r,i),t}))}function Dt(e){return e===0?`±0`:`${e>0?`+`:`−`}${Math.abs(e)}`}function Ot(e){return e===0?`baseline`:`${e>0?`+`:`−`}${(Math.abs(e)/1e6).toFixed(1)} MB`}function kt(e){let t=document.querySelector(`[data-release-history]`);if(!t)return;t.replaceChildren(...e.releases.map(e=>{let t=document.createElement(`a`);t.className=`release-row`,t.href=`/clawsembly/data/${e.reportPath}`,t.setAttribute(`aria-label`,`${e.channel} OpenClaw ${e.version} ${e.status} report`);let n=document.createElement(`span`);n.className=`release-channel release-channel-${e.channel}`,n.textContent=e.channel;let r=document.createElement(`div`);r.className=`release-identity`;let i=document.createElement(`strong`);i.textContent=e.version;let a=document.createElement(`span`);a.textContent=e.runtimeEvidence?`runtime evidenced`:`static inspection only`,r.append(i,a);let o=document.createElement(`div`);o.className=`release-metrics`;let s=document.createElement(`span`);s.textContent=Ot(e.deltaFromStable.unpackedBytes);let c=document.createElement(`span`);c.textContent=`${Dt(e.deltaFromStable.directDependencyCount)} deps`;let l=document.createElement(`span`);l.textContent=`${Dt(e.deltaFromStable.nativeRiskCount)} native risks`,o.append(s,c,l);let u=document.createElement(`span`);u.className=`release-checks`,u.textContent=`${e.checks.pass} pass / ${e.checks.warn} warn / ${e.checks.pending} pending`;let d=document.createElement(`span`);d.className=`release-state release-state-${e.status}`,d.textContent=e.status;let f=document.createElement(`span`);return f.className=`release-arrow`,f.setAttribute(`aria-hidden`,`true`),f.textContent=`↗`,t.append(n,r,o,u,d,f),t})),$(`[data-release-generated]`,new Intl.DateTimeFormat(`en`,{dateStyle:`medium`,timeStyle:`short`}).format(new Date(e.generatedAt)));let n=document.querySelector(`[data-release-index]`);n&&(n.href=`/clawsembly/data/release-history.json`)}async function At(){let e=await fetch(`/clawsembly/data/release-history.json`,{cache:`no-store`});if(!e.ok)throw Error(`Release history request failed: ${e.status}`);kt(await e.json())}async function jt(){let e=await fetch(`/clawsembly/data/compatibility.json`,{cache:`no-store`});if(!e.ok)throw Error(`Compatibility report request failed: ${e.status}`);let t=await e.json();document.documentElement.dataset.openclawVersion=t.artifact.version,$(`[data-package]`,t.artifact.package),$(`[data-version]`,t.artifact.version),$(`[data-status]`,t.status.toUpperCase()),$(`[data-node-engine]`,t.artifact.nodeEngine),$(`[data-tarball]`,Tt(t.artifact.tarballBytes)),$(`[data-unpacked]`,Tt(t.artifact.unpackedBytes)),$(`[data-dependencies]`,String(t.artifact.directDependencyCount)),$(`[data-browser-baseline]`,t.target.browserBaseline),$(`[data-generated]`,new Intl.DateTimeFormat(`en`,{dateStyle:`medium`,timeStyle:`short`}).format(new Date(t.generatedAt)));let n=document.querySelector(`.status-light`);n&&(n.classList.remove(`status-probing`,`status-supported`,`status-partial`,`status-unsupported`),n.classList.add(`status-${t.status}`)),Et(t.checks)}function Mt(){let e=new IntersectionObserver(t=>{for(let n of t)n.isIntersecting&&(n.target.classList.add(`is-visible`),e.unobserve(n.target))},{threshold:.18});wt(`.reveal`).forEach(t=>e.observe(t))}function Nt(){let e=document.querySelector(`.scroll-progress`);if(!e)return;let t=()=>{let t=document.documentElement.scrollHeight-window.innerHeight;e.style.transform=`scaleX(${t>0?window.scrollY/t:0})`};window.addEventListener(`scroll`,t,{passive:!0}),t()}function Pt(){let e=document.querySelector(`[data-orbit]`);!e||window.matchMedia(`(prefers-reduced-motion: reduce)`).matches||window.addEventListener(`pointermove`,t=>{let n=(t.clientX/window.innerWidth-.5)*8,r=(t.clientY/window.innerHeight-.5)*-8;e.style.setProperty(`--tilt-x`,`${r}deg`),e.style.setProperty(`--tilt-y`,`${n}deg`)},{passive:!0})}function Ft(){let e=document.querySelector(`[data-copy-report]`);e?.addEventListener(`click`,async()=>{let t=new URL(`/clawsembly/data/compatibility.json`,window.location.href).toString();if(e.dataset.mode===`open`){window.open(t,`_blank`,`noopener`);return}let n=!1;try{await navigator.clipboard.writeText(t),n=!0}catch{let e=document.createElement(`textarea`);e.value=t,e.setAttribute(`readonly`,``),e.style.position=`fixed`,e.style.opacity=`0`,document.body.append(e),e.select(),n=document.execCommand(`copy`),e.remove()}e.textContent=n?`Copied`:`Open report`,n||(e.dataset.mode=`open`),n&&window.setTimeout(()=>{e.textContent=`Copy report URL`},1600)})}jt().catch(e=>{$(`[data-status]`,`REPORT ERROR`);let t=document.querySelector(`[data-checks]`);t&&(t.textContent=e instanceof Error?e.message:`Unable to load compatibility evidence.`)}).finally(()=>{Ct(),L(),ke(),xe()}),At().catch(e=>{let t=document.querySelector(`[data-release-history]`);t&&(t.textContent=e instanceof Error?e.message:`Unable to load release history.`)}),Mt(),Nt(),Pt(),Ft();
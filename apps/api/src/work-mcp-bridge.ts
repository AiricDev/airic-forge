/** Ephemeral loopback MCP transport. Business policy remains in the supplied use-case callbacks. */
import {createServer} from "node:http";
import {once} from "node:events";
import {randomBytes} from "node:crypto";
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {CallToolRequestSchema,ListToolsRequestSchema,type CallToolResult} from "@modelcontextprotocol/sdk/types.js";
export interface BridgeTool {name:string;description:string;inputSchema:Record<string,unknown>;invoke(input:Record<string,unknown>):Promise<CallToolResult>;}
export async function openWorkMcpBridge(tools:BridgeTool[]) {
  const token=randomBytes(32).toString("hex");let active=true;
  const pending=new Set<Promise<unknown>>();
  const http=createServer((req,res)=>{
    if(!active || req.headers.authorization!==`Bearer ${token}`){res.writeHead(401).end();return;}
    if(req.method!=="POST"){res.writeHead(405).end();return;}
    const run=(async()=>{
      const server=new Server({name:"forge-work",version:"1"},{capabilities:{tools:{}}});
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:tools.map(({name,description,inputSchema})=>({name,description,inputSchema:{...inputSchema,type:"object" as const}}))}));
      server.setRequestHandler(CallToolRequestSchema,async request=>{
        if(!active)throw Error("WorkBridgeClosed");
        const tool=tools.find(t=>t.name===request.params.name);if(!tool)throw Error("ToolNotAvailable");
        return tool.invoke(request.params.arguments??{});
      });
      const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      res.on('close',()=>{void transport.close();void server.close();});
      await server.connect(transport);await transport.handleRequest(req,res);
    })().catch(()=>{if(!res.headersSent)res.writeHead(500).end();else res.end();});
    pending.add(run);void run.finally(()=>pending.delete(run));
  });
  http.listen(0,"127.0.0.1");await once(http,"listening");const address=http.address();
  if(!address||typeof address==='string')throw Error('BridgeBindFailed');
  return {url:`http://127.0.0.1:${address.port}/mcp`,token,
    async close(){active=false;await Promise.allSettled([...pending]);await new Promise<void>(resolve=>{http.close(()=>resolve());http.closeAllConnections();});}};
}

/** Preserve validated App image blocks as MCP image content rather than base64 text. */
export function toMcpTool(tool:import('@airic-forge/domain').WorkAgentTool,supportsImages:boolean):BridgeTool {
  return {name:tool.capability.id,description:tool.capability.description,inputSchema:tool.capability.inputSchema,
    invoke:async params=>{const result=await tool.invoke(params);return {content:['asset.read','asset.read-location'].includes(tool.capability.id)?materialToolContent(result,supportsImages):[{type:'text',text:JSON.stringify(result)}]};}};
}
import {materialToolContent} from './material-tool-content.js';

/** Minimal synthetic protocol for component tests. Not a mirror of any integrated App catalog. */
import type { AppToolSnapshot, ForgeUseCases } from "@airic-forge/domain";
export async function acknowledgeCheckpoint(useCases: ForgeUseCases, ticket: string) {
 const progress=(await useCases.sessionHistory(ticket)).progress;
 if(progress.waiting&&progress.checkpoint)await useCases.checkpointFeedback(ticket,{checkpointId:progress.checkpoint.id,kind:"approve",note:"Synthetic user checked the step"},`ack-${progress.checkpoint.id}`);
}
export const initialCapabilityIds=["workspace.context","entry.context","entry.history","command.receipt","command.context","entry.begin","entry.update","entry.reopen","entry.create","document.read","document.search","document.read-location"];
export function testCatalog(digest="accepted"):AppToolSnapshot {
 return {id:"catalog",appId:"sample-app",domainRelease:"sample/v1",digest,discoveredAt:"",tools:initialCapabilityIds.map(id=>({id,title:id,description:"Synthetic component fixture",kind:["entry.begin","entry.update","entry.reopen","entry.create"].includes(id)?"command":"query",inputSchema:{type:"object"},outputSchema:{type:"object"},...(["entry.begin","entry.update","entry.reopen","entry.create"].includes(id)?{receiptScope:id}:{})}))};
}

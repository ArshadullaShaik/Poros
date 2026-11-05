import { addr,bool,bytes,defineSchema,i32,key,str,u64,type Schema } from '@arkiv-network/sdk/schema';
import type { Kind } from './backend.ts';
export const NAMESPACE='ethmumbai.strategyhub.v1';
export const CHAIN_ID=7794095;
export const DURABLE_LIFETIME_DAYS=180;
export const CHAT_LIFETIME_DAYS=45;
const Versions=defineSchema(`${NAMESPACE}.versions`,{
  schemaVersion:i32(),strategyId:str().indexed(),requestId:str().indexed(),isRoot:bool().indexed(),
  rootVersion:key().indexed().optional(),parentVersion:key().indexed().optional(),
  forkSource:key().indexed().optional(),forkSourceHash:str().optional(),community:key().indexed().optional(),
  name:str(),nameSearch:str().indexed(),category:str().indexed(),executionChainId:u64().indexed(),
  tokenIn:addr(),tokenOut:addr(),contentHash:str().indexed(),record:bytes(),
});
const Communities=defineSchema(`${NAMESPACE}.communities`,{
  schemaVersion:i32(),requestId:str().indexed(),name:str(),nameSearch:str().indexed(),record:bytes(),
});
const Posts=defineSchema(`${NAMESPACE}.posts`,{
  schemaVersion:i32(),requestId:str().indexed(),community:key().indexed(),strategyVersion:key().indexed().optional(),record:bytes(),
});
// SDK's inferred columns reference a private declaration type; keep it behind this boundary.
export const Schemas:Record<Kind,Schema>={versions:Versions,communities:Communities,posts:Posts};

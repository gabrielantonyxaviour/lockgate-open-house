import {describe,expect,it} from 'vitest';
import {chainEventFromLog,recentEventRange} from '../src/chain/events';
import {DEPLOYMENT} from '../src/chain/config';
const hash=`0x${'11'.repeat(32)}`;
const log=()=>({address:DEPLOYMENT.platform,transactionHash:hash,blockNumber:100n,logIndex:2,eventName:'ExitAdvanced',args:{usdgOut:990000n}});
describe('bounded chain activity',()=>{
 it('limits the inclusive range to 10000 blocks',()=>{const r=recentEventRange(100000n);expect(r.toBlock-r.fromBlock+1n).toBe(10000n);expect(recentEventRange(10n)).toEqual({fromBlock:0n,toBlock:10n});expect(()=>recentEventRange(-1n)).toThrow();});
 it('preserves actual hash, log identifier and exact units',()=>{const event=chainEventFromLog(log());expect(event).toMatchObject({id:`${hash}:2`,hash,blockNumber:100n,kind:'exit',amount:990000n});expect(event?.description).toContain('0.99 USDG');});
 it('ignores reorged, pending and unknown events',()=>{expect(chainEventFromLog({...log(),removed:true})).toBeNull();expect(chainEventFromLog({...log(),blockNumber:null})).toBeNull();expect(chainEventFromLog({...log(),transactionHash:null})).toBeNull();expect(chainEventFromLog({...log(),eventName:'Unrelated'})).toBeNull();});
 it('rejects malformed money instead of making a financial claim',()=>{expect(chainEventFromLog({...log(),args:{usdgOut:0.99}})).toBeNull();expect(chainEventFromLog({...log(),args:{usdgOut:-1n}})).toBeNull();expect(chainEventFromLog({...log(),args:{}})).toBeNull();});
 it('distinguishes partner withdrawal and reserve withdrawal using actual event argument names',()=>{expect(chainEventFromLog({...log(),eventName:'Withdrawn',args:{assets:1000000n}})?.kind).toBe('partner');expect(chainEventFromLog({...log(),eventName:'Withdrawn',args:{amount:1000000n}})?.kind).toBe('reserve');});
 it('does not present a configured credit limit as cash movement',()=>{const event=chainEventFromLog({...log(),eventName:'SourceUpdated',args:{limit:1000000000n}});expect(event?.kind).toBe('control');expect(event?.amount).toBeUndefined();});
});

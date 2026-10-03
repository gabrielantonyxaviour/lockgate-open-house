import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadSnapshot,publicClient} from '../src/chain/client';
import {DEPLOYMENT} from '../src/chain/config';
const owner='0x1111111111111111111111111111111111111111';
const failed='0x2222222222222222222222222222222222222222';
afterEach(()=>vi.restoreAllMocks());
describe('snapshot availability boundaries',()=>{
 it('keeps readable platforms and gas balance when another source or optional facility fails',async()=>{
  vi.spyOn(publicClient,'getChainId').mockResolvedValue(421614);
  vi.spyOn(publicClient,'getBlock').mockResolvedValue({number:123n,timestamp:1000n} as never);
  const native=vi.spyOn(publicClient,'getBalance').mockResolvedValue(20n);
  const read=vi.spyOn(publicClient,'readContract').mockImplementation(async ({address,functionName})=>{
   if(address && [failed,DEPLOYMENT.vaultA,DEPLOYMENT.vaultB,DEPLOYMENT.facility].includes(address)) throw new Error('Source unavailable');
   const values:Record<string,unknown>={sources:[failed,DEPLOYMENT.platform],owner,issuer:owner,name:'Readable platform',share:owner,paused:false,gated:false,blocked:false,registered:true,
    requestsOf:[],firstOpen:0n,queueLength:0n,advanceCount:0n,previewSettlement:[1n,0n,0n,0n],balanceOf:12n};
   return (values[functionName]??0n) as never;
  });
  const snapshot=await loadSnapshot(owner);
  expect(snapshot.platforms).toHaveLength(1);expect(snapshot.platforms[0].address).toBe(DEPLOYMENT.platform);
  expect(snapshot.usdgBalance).toBe(12n);expect(snapshot.nativeBalance).toBe(20n);expect(snapshot.facility).toBeUndefined();
  expect(snapshot.warnings.some(w=>w.includes(failed))).toBe(true);expect(snapshot.warnings.some(w=>w.includes('Institutional facility'))).toBe(true);
  expect(native).toHaveBeenCalledWith({address:owner,blockNumber:123n});
  expect(read.mock.calls.every(([call])=>call.blockNumber===123n)).toBe(true);
 });
});

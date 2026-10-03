import {afterEach,describe,expect,it,vi} from 'vitest';
import {subscribeWallet,walletChainId} from '../src/chain/wallet';
const address='0x1111111111111111111111111111111111111111';
afterEach(()=>vi.unstubAllGlobals());
function provider(){const handlers=new Map<string,(value:unknown)=>void>();const request=vi.fn();const removeListener=vi.fn();vi.stubGlobal('window',{ethereum:{request,on:(name:string,fn:(value:unknown)=>void)=>handlers.set(name,fn),removeListener}});return {handlers,request,removeListener};}
describe('injected wallet event boundary',()=>{
 it('handles malformed accounts without an uncaught provider callback',()=>{const p=provider();const accounts=vi.fn();const unsubscribe=subscribeWallet(accounts,vi.fn());const emit=p.handlers.get('accountsChanged')!;expect(()=>emit([address,'malformed'])).not.toThrow();expect(accounts).toHaveBeenLastCalledWith([]);emit({account:address});expect(accounts).toHaveBeenLastCalledWith([]);emit([address]);expect(accounts).toHaveBeenLastCalledWith([address]);unsubscribe();expect(p.removeListener).toHaveBeenCalledTimes(2);});
 it('uses unsupported network state for malformed and unsafe network IDs',()=>{const p=provider();const chain=vi.fn();subscribeWallet(vi.fn(),chain);const emit=p.handlers.get('chainChanged')!;expect(()=>emit('0x20000000000000')).not.toThrow();expect(chain).toHaveBeenLastCalledWith(0);emit('invalid');expect(chain).toHaveBeenLastCalledWith(0);emit('0x66eee');expect(chain).toHaveBeenLastCalledWith(421614);});
 it('rejects unsafe network IDs from wallet requests instead of rounding them',async()=>{const p=provider();p.request.mockResolvedValue('0x20000000000000');await expect(walletChainId()).rejects.toThrow('safe integer');});
});

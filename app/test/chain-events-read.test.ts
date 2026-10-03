import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getChainId:vi.fn(),getBlockNumber:vi.fn(),readContract:vi.fn(),getLogs:vi.fn()}));
vi.mock('../src/chain/client',()=>({publicClient:mocks,errorMessage:(e:Error)=>e.message}));
import {loadEvents} from '../src/chain/events';
import {DEPLOYMENT} from '../src/chain/config';
const created='0x3333333333333333333333333333333333333333';
beforeEach(()=>{vi.resetAllMocks();mocks.getChainId.mockResolvedValue(421614);mocks.getBlockNumber.mockResolvedValue(100000n);mocks.readContract.mockResolvedValue([DEPLOYMENT.platform,created]);mocks.getLogs.mockResolvedValue([]);});
describe('deployed platform activity discovery',()=>{
 it('reads new platform events and facility events at the same recent block range',async()=>{
  const result=await loadEvents();
  expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({functionName:'sources',blockNumber:100000n}));
  expect(mocks.getLogs).toHaveBeenCalledWith(expect.objectContaining({address:created,fromBlock:90001n,toBlock:100000n}));
  expect(mocks.getLogs).toHaveBeenCalledWith(expect.objectContaining({address:DEPLOYMENT.facility}));expect(result.warnings).toEqual([]);
 });
 it('reports partial discovery and preserves other activity when the source list fails',async()=>{
  mocks.readContract.mockRejectedValue(new Error('RPC source list failed'));const result=await loadEvents();
  expect(result.warnings[0]).toContain('incomplete');expect(mocks.getLogs).toHaveBeenCalledWith(expect.objectContaining({address:DEPLOYMENT.platform}));
 });
 it('keeps successful sources and reports the individual source failure',async()=>{
  mocks.getLogs.mockImplementation(async ({address})=>{if(address===created)throw new Error('unsupported');return [];});
  const result=await loadEvents();expect(result.warnings).toHaveLength(1);expect(result.warnings[0]).toContain(created);
 });
});

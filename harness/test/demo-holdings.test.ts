import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAbiParameters, encodeEventTopics, type Abi, type Hex } from 'viem';
import { allHoldings } from '../src/demo/holdings.js';
import { artifact, manifest, publicClient } from '../src/demo/shared.js';
import { profile } from '../src/demo/store.js';

test('Issued position names survive registry discovery without trusting another originator',async()=>{
 const m=manifest(),account='0x1111111111111111111111111111111111111111';
 const id=`0x${'ab'.repeat(32)}` as Hex,identity=`0x${'cd'.repeat(32)}` as Hex;
 const p=profile(account),before=p.minted,oldLogs=publicClient.getLogs,oldHead=publicClient.getBlockNumber;
 const metadata={id,identityId:'alex-morgan',name:'Alder Private Credit TEST position',originator:m.originators[0].name,originatorAddress:m.originators[0].address,units:'100000'};
 p.minted=[metadata];
 publicClient.getBlockNumber=(async()=>BigInt(m.deploymentBlock??'0')) as typeof oldHead;
 publicClient.getLogs=(async()=>[{topics:encodeEventTopics({abi:artifact('DemoRegistry').abi as Abi,eventName:'HoldingRegistered',args:{id,originator:m.originators[0].address,identity}}),data:encodeAbiParameters([{type:'uint256'}],[100000000000n])}]) as typeof oldLogs;
 try{
  const [holding]=await allHoldings();
  assert.equal(holding.name,'Alder Private Credit');assert.equal(holding.instrument,'Private credit claim');assert.equal(holding.units,100000000000n);
  metadata.originatorAddress=m.originators[1].address;
  assert.equal((await allHoldings())[0].name,'Investment position');
 }finally{p.minted=before;publicClient.getLogs=oldLogs;publicClient.getBlockNumber=oldHead;}
});

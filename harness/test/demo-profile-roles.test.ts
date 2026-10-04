import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeProfileRole, completedRoles } from '../src/demo/profile-roles.js';
import type { ProfileRecord } from '../src/demo/store.js';

function investor(): ProfileRecord {
 return { role: 'investor', identityId: 'lucas-chen', firstHoldingProfileId: 'lucas-chen', agreements: {}, receipts: [], offers: [], minted: [] };
}
test('Legacy verified investor adds provider and retains all wallet records through persistence and switching', () => {
 const p = investor();
 const account='0x1111111111111111111111111111111111111111' as const, hash=`0x${'a'.repeat(64)}` as const;
 p.receipts.push({id:'exit-receipt',title:'Early payout received',status:'confirmed',hash,amount:'96030',createdAt:'2026-10-04T12:00:00Z',account});
 p.minted.push({id:hash,identityId:'lucas-chen',name:'Alder Private Credit',originator:'Alder Credit Platform',originatorAddress:account,units:'100000'});
 p.agreements.vehicle={digest:hash,amount:'100',signature:hash,message:'Exact signed subscription',signedAt:'2026-10-04T12:00:00Z'};
 p.offers.push({id:'offer-1',account,vehicleId:'vehicle',holdingId:hash,quote:{payout:'96030'},residualUnits:'1000',originatorSignature:hash,investorSignature:hash,signedAt:'2026-10-04T12:00:00Z',agreement:{id:'signed-exit',version:'1',title:'Early exit agreement',text:'Exact signed exit letter',digest:hash,signed:true,accepted:true},createdAt:'2026-10-04T12:00:00Z'});
 const protectedRecords = { identityId: p.identityId, firstHoldingProfileId: p.firstHoldingProfileId, agreements: p.agreements, receipts: p.receipts, offers: p.offers, minted: p.minted };
 assert.deepEqual(completedRoles(p, true), ['investor']);
 changeProfileRole(p, 'provider', 'create', true);
 assert.deepEqual(p.roles, ['investor', 'provider']);
 assert.equal(p.role, 'provider');
 for (const [key, value] of Object.entries(protectedRecords)) assert.equal(p[key as keyof ProfileRecord], value, `${key} retained by reference`);
 const reloaded: ProfileRecord = JSON.parse(JSON.stringify(p));
 changeProfileRole(reloaded, 'investor', 'switch', true);
 assert.equal(reloaded.role, 'investor');
 assert.deepEqual(completedRoles(reloaded, true), ['investor', 'provider']);
 changeProfileRole(reloaded, 'provider', 'switch', true);
 assert.equal(reloaded.role, 'provider');
 assert.deepEqual(reloaded.identityId, 'lucas-chen');
 for (const [key,value] of Object.entries(protectedRecords)) assert.deepEqual(reloaded[key as keyof ProfileRecord],value,`${key} survives persistence`);
});
test('Duplicate profile creation is rejected without mutating any records', () => {
 const p = investor(), before = JSON.stringify(p);
 assert.throws(() => changeProfileRole(p, 'investor', 'create', true), { code: 'PROFILE_EXISTS', status: 409 });
 assert.equal(JSON.stringify(p), before);
});
test('An unfinished retail role can resume and cannot be switched to as a completed profile', () => {
 const p = investor();
 assert.deepEqual(completedRoles(p, false), []);
 assert.throws(() => changeProfileRole(p, 'investor', 'switch', false), { code: 'PROFILE_NOT_FOUND', status: 404 });
 changeProfileRole(p, 'investor', 'create', false);
 assert.deepEqual(p.roles, []);
 assert.deepEqual(completedRoles(p, true), ['investor']);
});
test('Missing profile switches and unapproved institutions never grant roles', () => {
 const p = investor(), before = JSON.stringify(p);
 assert.throws(() => changeProfileRole(p, 'provider', 'switch', true), { code: 'PROFILE_NOT_FOUND', status: 404 });
 for (const role of ['originator', 'manager'] as const) {
  for (const intent of ['create', 'switch'] as const) assert.throws(() => changeProfileRole(p, role, intent, true), { code: 'INVITATION_REQUIRED', status: 403 });
 }
 assert.equal(JSON.stringify(p), before);
});
test('Expired identity does not erase previously completed memberships', () => {
 const p = investor();
 changeProfileRole(p, 'provider', 'create', true);
 assert.deepEqual(completedRoles(p, false), ['investor', 'provider']);
 changeProfileRole(p, 'investor', 'switch', false);
 assert.deepEqual(p.roles, ['investor', 'provider']);
});

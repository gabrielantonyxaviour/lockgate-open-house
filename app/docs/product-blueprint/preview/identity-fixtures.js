// Fictional fixtures only. No provider authentication, document verification or signature occurs.
const fixtureRows = [
  ['alex-morgan','Alex Morgan','Singapore',0,'match'],
  ['priya-menon','Priya Menon','India',1,'match'],
  ['lucas-chen','Lucas Chen','Singapore',2,'match'],
  ['sofia-reyes','Sofia Reyes','Spain',3,'match'],
  ['daniel-okafor','Daniel Okafor','United Kingdom',0,'match'],
  ['hana-kim','Hana Kim','South Korea',1,'match'],
  ['amara-wilson','Amara Wilson','Canada',2,'match'],
  ['mateo-silva','Mateo Silva','Portugal',3,'match'],
  ['nisha-rao','Nisha Rao','Singapore',0,'mismatch'],
  ['elias-haddad','Elias Haddad','United Arab Emirates',0,'empty'],
];
export const demoProfiles = fixtureRows.map(([id,name,jurisdiction,originator,fixtureCase],index)=>{
  const number=String(index+1).padStart(3,'0');
  return Object.freeze({id,name,jurisdiction,originator,fixtureCase,
    identityRef:`TEST-IDENTITY-${number}`,accountRef:`TEST-ACCOUNT-${number}`,walletRef:`TEST-WALLET-${number}`,
    walletLabel:`TEST wallet ${number}`,attestationRef:`TEST-KYC-${number}`,
    issuer:'TEST-IDENTITY-REVIEWER',verification:'preverified-test',expires:'31 December 2026',
  });
});
// Minimal adapter attestations contain no other holder's name, balance or private record.
const accountAttestations = new Map(demoProfiles.map(p=>[p.id,{
  issuer:'TEST-ORIGINATOR-ADAPTER',identityRef:p.identityRef,accountRef:p.accountRef,walletRef:p.walletRef,
  holdingOwners:p.fixtureCase==='empty'?[]:[p.fixtureCase==='mismatch'
    ?{identityRef:'TEST-OTHER-SUBJECT',accountRef:'TEST-OTHER-ACCOUNT',walletRef:'TEST-OTHER-WALLET'}
    :{identityRef:p.identityRef,accountRef:p.accountRef,walletRef:p.walletRef}],
}]));
export const profileFor = s => demoProfiles.find(p=>p.id===s.profileId)||null;
export function holdingAccess(s){
  const profile=profileFor(s);
  if(!profile)return {status:'kyc-required'};
  const source=accountAttestations.get(profile.id);
  const verified=profile.issuer==='TEST-IDENTITY-REVIEWER'&&profile.verification==='preverified-test';
  const binding=source?.issuer==='TEST-ORIGINATOR-ADAPTER'&&source.identityRef===profile.identityRef&&source.accountRef===profile.accountRef&&source.walletRef===profile.walletRef;
  if(!verified||!binding)return {status:'mismatch'};
  if(!source.holdingOwners.length)return {status:'empty'};
  const owner=source.holdingOwners.find(h=>h.identityRef===profile.identityRef&&h.accountRef===profile.accountRef&&h.walletRef===profile.walletRef);
  if(!owner)return {status:'mismatch'};
  if(s.originator!==profile.originator)return {status:'no-position'};
  return {status:'matched',profile,holdingRef:`TEST-HOLDING-${profile.identityRef.slice(-3)}`,faceValue:100000,originator:profile.originator};
}
export const protectedExitScreens=new Set(['link','positions','setup','amount','offers','review','agreement','approval','settlement','receipt','updated','history']);
export const protectedProviderScreens=new Set(['agreement','subscription','funding','position','withdrawal','records']);

export const vehicleApproved=s=>Boolean(profileFor(s)&&s.vehicleId&&s.providerApproval?.identityRef===profileFor(s).identityRef&&s.providerApproval?.vehicleId===s.vehicleId);

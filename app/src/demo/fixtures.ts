import type { DemoRole, Identity } from './types';
import { ArrowUpRight, Building2, BriefcaseBusiness, Diamond } from 'lucide-react';
export const roles = [
 {id:'investor' as DemoRole,title:'Exit investor',description:'Explore an earlier payout from an investment you already hold.',cta:'Get Started',icon:ArrowUpRight},
 {id:'originator' as DemoRole,title:'Originating fund / platform',description:'Discuss connecting your assets and enabling earlier investor exits.',cta:'Talk to us',icon:Building2},
 {id:'manager' as DemoRole,title:'Licensed investment firm',description:'Discuss your mandate and a managed onboarding for your firm.',cta:'Talk to us',icon:BriefcaseBusiness},
 {id:'provider' as DemoRole,title:'Capital provider',description:'Explore approved vehicles and invest through an eligible firm.',cta:'Get Started',icon:Diamond},
];
const people = [
 ['alex-morgan','Alex Morgan','Singapore'],['priya-menon','Priya Menon','India'],
 ['lucas-chen','Lucas Chen','Singapore'],['sofia-reyes','Sofia Reyes','Spain'],
 ['daniel-okafor','Daniel Okafor','United Kingdom'],['hana-kim','Hana Kim','South Korea'],
 ['amara-wilson','Amara Wilson','Canada'],['mateo-silva','Mateo Silva','Portugal'],
 ['nisha-rao','Nisha Rao','Singapore'],['elias-haddad','Elias Haddad','United Arab Emirates'],
];
/** Fictional choices only; selecting one succeeds only after the authenticated API persists its binding. */
export const identities:Identity[]=people.map(([id,name,jurisdiction],index)=>({id,name,jurisdiction,identityRef:`TEST-IDENTITY-${String(index+1).padStart(3,'0')}`,fixtureCase:index===8?'mismatch':index===9?'empty':'match'}));

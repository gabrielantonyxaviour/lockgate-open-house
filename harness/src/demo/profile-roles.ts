import type { ProfileRecord, ProfileRole } from './store.js';

export type ProfileIntent = 'create' | 'switch';
const retail = (role?: ProfileRole) => role === 'investor' || role === 'provider';
function fail(message: string, code: string, status: number): never {
 throw Object.assign(new Error(message), { code, status });
}
/** A legacy active retail role is complete only after its wallet identity is bound. */
export function completedRoles(profile: ProfileRecord, bound: boolean): ProfileRole[] {
 const roles = [...new Set(profile.roles ?? [])];
 if (bound && retail(profile.role) && !roles.includes(profile.role!)) roles.push(profile.role!);
 return roles;
}
/** Changes only profile membership and active role; all wallet-owned records remain intact. */
export function changeProfileRole(profile: ProfileRecord, role: ProfileRole, intent: ProfileIntent, bound: boolean, institutionApproved = false) {
 const roles = completedRoles(profile, bound);
 if (!retail(role) && !institutionApproved) fail('Send an enquiry to discuss institutional access. Our team will contact you.', 'INSTITUTION_ACCOUNT_REQUIRED', 403);
 const exists = roles.includes(role);
 if (intent === 'create' && exists) fail('Profile already exists for this wallet', 'PROFILE_EXISTS', 409);
 if (intent === 'switch' && !exists) fail('Complete this profile before switching to it', 'PROFILE_NOT_FOUND', 404);
 profile.role = role;
 profile.roles = [...new Set([...roles, ...((bound || institutionApproved) ? [role] : [])])];
}

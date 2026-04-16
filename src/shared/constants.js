// World/player constants. Both v1a and (eventually) v1b's JS port read
// from here so balance changes hit one place.

export const WORLD_W = 3000;
export const WORLD_H = 3000;
export const PLAYER_SPEED = 150;
export const PLAYER_RADIUS = 14;
export const PLAYER_MAX_HP = 100;

export const XP_RADIUS = 6;
export const XP_MAGNET_RANGE = 80;
export const XP_MAGNET_SPEED = 400;

// Hard cap on client-side particle count. At wave 25+ with VFX active,
// uncapped arrays grow to 1000+ entries and stall the decay loop.
// When at cap, safeParticlePush drops the oldest particle (shift) and
// emits one PARTICLE_OVERFLOW debug log per tick for the perf harness.
export const MAX_PARTICLES = 600;

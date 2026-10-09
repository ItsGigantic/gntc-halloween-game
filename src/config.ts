// Every tunable in one place. Units are metres; the jack-o-lantern model is 1.5 m wide.
export const CONFIG = {
  player: {
    startRadius: 0.55,
    accel: 34,
    jumpSpeed: 6.5,
    gravity: 26,
    friction: 5.5,
    maxSpeedBase: 8,
    maxSpeedPerRadius: 0.7,
    maxAttachedVisible: 150,
  },
  camera: {
    distBase: 4.5,
    distPerRadius: 3.3,
    heightBase: 2.8,
    heightPerRadius: 2.1,
    posLerp: 5,
    dirLerp: 3.2,
    lookAhead: 1.2,
    fov: 55,
  },
  world: {
    size: 72, // arena is size x size, centred on origin
  },
  rules: {
    lives: 3,
    comboWindow: 1.3,
    comboMax: 8,
    invulnSeconds: 2.5,
    /** Golden shield power-up: seconds of invincibility, and the first one drops after this long. */
    powerSeconds: 8,
    powerFirstAt: 38,
    shedFraction: 0.15,
    pickRatio: 1.15,
    /** Ball radius / skull radius before a static skull can be crushed instead of hurting. */
    crushRatio: 7,
    maxGainFrac: 0.065,
    gainSlope: 0.8,
  },
  render: {
    maxPixelRatio: 1.5,
    mobilePixelRatio: 1.5,
    /** Hard directional shadow maps (desktop); touch devices use instanced blob shadows instead. */
    shadowMaps: true,
    shadowMapSize: 2048,
    shadowMapSizeMobile: 1024,
    shadowExtent: 34,
  },
};

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

export const GAME_URL = 'https://www.itsgigantic.com/halloween';

import * as THREE from 'three';
import { PostGrade } from '../game/grade';
import { buildHolidayScene } from './scene';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const grade = new PostGrade(2, 2, 4);

buildHolidayScene(renderer, grade).then((s) => {
  (window as unknown as { __holiday: unknown }).__holiday = s;
  const t = Number(new URLSearchParams(location.search).get('t') ?? 0);
  (document.getElementById('preview') as HTMLImageElement).src = s.frame(t).toDataURL('image/png');
  document.title = 'Holiday loop ready';
});

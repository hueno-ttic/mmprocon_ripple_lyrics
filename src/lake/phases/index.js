import { PhaseMist } from './PhaseMist.js';
import { PhaseClouds } from './PhaseClouds.js';
import { PhaseRain } from './PhaseRain.js';
import { PhasePuddles } from './PhasePuddles.js';
import { PhaseStream } from './PhaseStream.js';
import { PhaseLake } from './PhaseLake.js';

// 「川」フェーズは構成変更で廃止し、小川→湖へ直接遷移する。
export const PHASE_CLASSES = [
    PhaseMist,
    PhaseClouds,
    PhaseRain,
    PhasePuddles,
    PhaseStream,
    PhaseLake,
];

import { PhaseMist } from './PhaseMist.js';
import { PhaseClouds } from './PhaseClouds.js';
import { PhaseRain } from './PhaseRain.js';
import { PhasePuddles } from './PhasePuddles.js';
import { PhaseStream } from './PhaseStream.js';
import { PhaseLake } from './PhaseLake.js';

// 「川」(PhaseRiver)は構成変更で進行から外し、小川→湖へ直接遷移する。
// 将来の再利用に備え src/lake/phases/PhaseRiver.js のファイル自体は残置している。
export const PHASE_CLASSES = [
    PhaseMist,
    PhaseClouds,
    PhaseRain,
    PhasePuddles,
    PhaseStream,
    PhaseLake,
];

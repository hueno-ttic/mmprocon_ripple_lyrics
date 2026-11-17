// Accent colors follow the redesign art direction (Ripple Lyrics scene design)
export const PHASES = [
    { id: 0, name: '晴れ',   nameEn: 'clear sky', color: '#6CB04A' },
    { id: 1, name: '雲',     nameEn: 'clouds', color: '#5C9EE0' },
    { id: 2, name: '雨',     nameEn: 'rain', color: '#8FA6B6' },
    { id: 3, name: '水たまり', nameEn: 'puddles', color: '#5AA0DC' },
    { id: 4, name: '小川',   nameEn: 'stream', color: '#3FB0C4' },
    // 「川」フェーズは構成変更で廃止。小川から直接「湖」へ遷移する。
    { id: 5, name: '湖',     nameEn: 'lake', color: '#39C5BB' },
];

// 音量の初期値(0..100)。VolumeControl のスライダーと、曲/BGM/効果音の実音量で共通にする。
export const DEFAULT_VOLUME = 35;

export const CONSTANTS = {
    LAKE_RADIUS: 10,
    RIPPLE_RADIUS: 3
};

// Accent colors follow the redesign art direction (Ripple Lyrics scene design)
export const PHASES = [
    { id: 0, name: '晴れ',   nameEn: 'clear sky', color: '#6CB04A' },
    { id: 1, name: '雲',     nameEn: 'clouds', color: '#5C9EE0' },
    { id: 2, name: '雨',     nameEn: 'rain', color: '#8FA6B6' },
    { id: 3, name: '水たまり', nameEn: 'puddles', color: '#5AA0DC' },
    { id: 4, name: '小川',   nameEn: 'stream', color: '#3FB0C4' },
    { id: 5, name: '川',     nameEn: 'river', color: '#33A7E0' },
    { id: 6, name: '湖',     nameEn: 'lake', color: '#39C5BB' },
];

export const PHASE_TRANSITION_DURATION = 3000;

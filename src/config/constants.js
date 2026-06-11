export const CONSTANTS = {
    LAKE_RADIUS: 10,
    RIPPLE_RADIUS: 3
};

export const PHASES = [
    { id: 0, name: '水蒸気', nameEn: 'mist', color: '#1a1a2e' },
    { id: 1, name: '雲',     nameEn: 'clouds', color: '#0a1525' },
    { id: 2, name: '雨',     nameEn: 'rain', color: '#0c1a2a' },
    { id: 3, name: '水たまり', nameEn: 'puddles', color: '#0f2035' },
    { id: 4, name: '小川',   nameEn: 'stream', color: '#102a45' },
    { id: 5, name: '川',     nameEn: 'river', color: '#142e50' },
    { id: 6, name: '湖',     nameEn: 'lake', color: '#1a4070' },
];

export const PHASE_TRANSITION_DURATION = 3000;

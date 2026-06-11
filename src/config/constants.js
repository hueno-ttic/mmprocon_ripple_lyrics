export const CONSTANTS = {
    LAKE_RADIUS: 10,
    RIPPLE_RADIUS: 3
};

export const PHASES = [
    { id: 0, name: '晴れ',   nameEn: 'clear sky', color: '#BFE3FF' },
    { id: 1, name: '雲',     nameEn: 'clouds', color: '#ADBDD1' },
    { id: 2, name: '雨',     nameEn: 'rain', color: '#46525F' },
    { id: 3, name: '水たまり', nameEn: 'puddles', color: '#A8B5BE' },
    { id: 4, name: '小川',   nameEn: 'stream', color: '#AFD4DC' },
    { id: 5, name: '川',     nameEn: 'river', color: '#A2C8E8' },
    { id: 6, name: '湖',     nameEn: 'lake', color: '#AEE0F8' },
];

export const PHASE_TRANSITION_DURATION = 3000;

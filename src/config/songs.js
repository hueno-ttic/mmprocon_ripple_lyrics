export const SONGS = [
  {
    id: 'kotaete',
    title: 'こたえて',
    artist: 'imie',
    vocal: '初音ミク',
    songUrl: 'https://piapro.jp/t/6W2N/20251215164617',
    lyricUrl: 'https://piapro.jp/t/9o24',
    video: {
      beatId: 4827293,
      chordId: 2963754,
      repetitiveSegmentId: 3086261,
      lyricId: 126519,
      lyricDiffId: 28645
    },
    themeQuestion: 'あなたが僕ならばどんな答えを出すでしょうか',
    color: '#7F77DD',
    thumbnail: 'assets/thumbnails/kotaete.jpg',
    waterBehavior: 'boiling',
    tutorial: {
      steps: [
        { icon: '🛸', text: 'ミクが先導する回廊を、音楽とともに駆け抜けます' },
        { icon: '✨', text: '流れる歌詞にタッチすると共鳴し、光がミクへ届きます' },
        { icon: '❓', text: 'サビのたびに「問い」が届きます — 答えを選ぶと世界が混色されます(全3回)' },
        { icon: '🎨', text: '3つの答えが混ざり合い、ラストに「あなたの答えの色」が世界を満たします' },
      ]
    }
  },
  {
    id: 'after',
    title: 'アフター・ザ・カーテン',
    artist: 'Rulmry',
    vocal: '初音ミク',
    songUrl: 'https://piapro.jp/t/zoqO/20251214200738',
    lyricUrl: 'https://piapro.jp/t/EVO2',
    video: {
      beatId: 4827294,
      chordId: 2963755,
      repetitiveSegmentId: 3086262,
      lyricId: 126591,
      lyricDiffId: 28627
    },
    themeQuestion: '終わりの後に何が残るのか',
    color: '#1D9E75',
    thumbnail: 'assets/thumbnails/after.jpg',
    waterBehavior: 'residue',
    tutorial: {
      steps: [
        { icon: '🔦', text: '指やマウスでスポットライトを動かし、暗闇に隠れた歌詞とミクを照らそう' },
        { icon: '🎉', text: '歌詞をじっくり照らし切ると、光って弾け、紙吹雪となって舞い降ります' },
        { icon: '🕯', text: '弾けた歌詞は客席の灯にもなり、終わりの後も消えずに残り続けます' },
      ]
    }
  },
  {
    id: 'shutter',
    title: 'シャッターチャンス',
    artist: '夜未アガリ',
    vocal: '初音ミク & 鏡音リン',
    songUrl: 'https://piapro.jp/t/PNpQ/20251209170719',
    lyricUrl: 'https://piapro.jp/t/wyWv',
    video: {
      beatId: 4827295,
      chordId: 2963756,
      repetitiveSegmentId: 3086263,
      lyricId: 126542,
      lyricDiffId: 28628
    },
    themeQuestion: 'この瞬間を永遠にできるか',
    color: '#D85A30',
    thumbnail: 'assets/thumbnails/shutter.jpg',
    waterBehavior: 'freeze',
    tutorial: {
      steps: [
        { icon: '🎬', text: 'スタート前に被写体(ミク or リン)を選びます' },
        { icon: '📸', text: 'クリックまたはEnterキーでシャッター。動き回る被写体を画面に収めよう' },
        { icon: '⭐', text: 'サビ中やビートぴったりで撮ると★ベストショット — 被写体が笑顔になります' },
        { icon: '🎞️', text: '撮った写真は曲の終盤にフィルムロールとなって戻ってきます(最大12枚)' },
      ]
    }
  },
  {
    id: 'orchestra',
    title: '世界最後の音楽隊',
    artist: '夏山よつぎ × ど～ぱみん',
    vocal: '初音ミク',
    songUrl: 'https://piapro.jp/t/B3yJ/20251215061727',
    lyricUrl: 'https://piapro.jp/t/9U-6',
    video: {
      beatId: 4827296,
      chordId: 2963757,
      repetitiveSegmentId: 3086264,
      lyricId: 126594,
      lyricDiffId: 28629
    },
    themeQuestion: '空はどんな色？あなたはどんなカタチ？',
    color: '#185FA5',
    thumbnail: 'assets/thumbnails/orchestra.jpg',
    waterBehavior: 'evaporate',
    tutorial: {
      steps: [
        { icon: '✨', text: '浮かぶ歌詞に触れると、言葉の意味に応じた色のオーブが生まれる' },
        { icon: '🧪', text: '集めたオーブは左端のゲージに色の層として積もっていく' },
        { icon: '🎆', text: 'サビでオーブはすべて花火に！多く集めるほど夜空は大連鎖に' },
      ]
    }
  },
  {
    id: 'tricktology',
    title: 'トリツクロジー',
    artist: '鶴三',
    vocal: '鏡音リン',
    songUrl: 'https://piapro.jp/t/QBdL/20251215094303',
    lyricUrl: 'https://piapro.jp/t/Nixq',
    video: {
      beatId: 4827297,
      chordId: 2963758,
      repetitiveSegmentId: 3086265,
      lyricId: 126593,
      lyricDiffId: 28630
    },
    themeQuestion: '水面に立つあたし、水面に映るあたし<br>どっちが本物なのかな',
    bareQuestion: true,        // 問いの言葉をカギ括弧で囲まない（issue #30 コメント）
    holdResultUntilTap: true,  // リザルトはタップするまで維持（issue #30）
    color: '#3f9fd6',          // 冷たい水色（issue #30）
    thumbnail: 'assets/thumbnails/tricktology.jpg',
    waterBehavior: 'mirror',
    tutorial: {
      steps: [
        { icon: '🌙', text: '月が天をめぐり、水面と地上の世界が入れ替わっていく' },
        { icon: '👆', text: '地上に昇る歌詞／水面に逆さまに映る歌詞をタップ — その世界の月が満ちていく' },
        { icon: '🌕', text: 'やがて月が水に沈み「本物はどっち？」あなたが選んだ世界が本物になり、もう一人は光になって溶ける' },
      ]
    }
  },
  {
    id: 'takeover',
    title: 'TAKEOVER',
    artist: 'Twinfield',
    vocal: '初音ミク',
    songUrl: 'https://piapro.jp/t/E2i3/20251215092113',
    lyricUrl: 'https://piapro.jp/t/zxWP',
    video: {
      beatId: 4827298,
      chordId: 2963759,
      repetitiveSegmentId: 3086266,
      lyricId: 126533,
      lyricDiffId: 28631
    },
    themeQuestion: '世界を変えるのは誰か',
    color: '#FF3A3A',
    thumbnail: 'assets/thumbnails/takeover.jpg',
    waterBehavior: 'explosion',
    tutorial: {
      steps: [
        { icon: '💻', text: '赤く暗号化された歌詞をクリック(タップ)して解読します' },
        { icon: '🔓', text: '4秒以内に連続解読でコンボ！解読した歌詞は緑に、世界も徐々に奪還される' },
        { icon: '✨', text: '曲の終盤、解読した歌詞が爆散して初音ミクが実体化する' },
      ]
    }
  }
];



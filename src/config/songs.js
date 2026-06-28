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
    color: '#FFC83D',
    thumbnail: 'assets/thumbnails/kotaete.jpg',
    startHint: 'クリック連打で葉っぱを伸ばして、ミクを空へ！',
    // 他5曲(通常曲)を全てクリアした後に、湖へ静かに現れるシークレット曲。
    // 通常の「水の循環」の旅(晴れ→…→小川→湖)には数えず、エンディング後の隠し体験とする。
    secret: true,
    tutorial: {
      steps: [
        { icon: '🌻', text: 'まだ行けるよモード ── これはネタ寄りの“暴走”モードです' },
        { icon: '👆', text: 'クリック連打で答えの葉っぱを伸ばそう。伸ばすほどミクが上へ' },
        { icon: '🚀', text: '伸ばしすぎると、ミクが空へ超ジャンプでぶっ飛びます' },
        { icon: '☀️', text: '光は空の片側から射し、葉っぱは光のほうへ伸びていきます' },
        { icon: '✨', text: 'ミクは落ちません。最後はどうなる…？ まだ行けるよ！' },
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
        { icon: '⭐', text: '被写体を画面に良く収めて、サビ／象徴的な歌詞が映る瞬間に撮ると★ベストショット — 笑顔になります' },
        { icon: '🎞️', text: '撮った写真は曲の終盤、1枚のコンタクトシートに集約されます(★は丸印付き・最大12枚)' },
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
        { icon: '🌙', text: '画面の上が地上、水にうつる下が水面の世界。月が空をめぐり、ときどき上と下がまるごと入れかわる' },
        { icon: '👆', text: '浮かんでくる歌詞をタップしよう。上の歌詞なら地上の月、逆さまの歌詞なら水面の月が、その分だけ満ちていく' },
        { icon: '🌕', text: '最後に月が水へ沈むと、多くタップして満ちた月の世界が「本物」に。もう一人のあたしは、光になって溶けていく' },
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

// ── シークレット曲(こたえて)まわりの構成ヘルパー ───────────────────────────
// 通常曲(secret 以外)を主たる「水の循環」の旅とする。通常曲5曲を全てクリアすると
// 湖に到達=エンディングが流れ、その時はじめて湖にシークレット曲が姿を現す。

// 通常曲(=選曲画面に常時並ぶ5曲)。曲の並び順は SONGS の定義順を保つ。
export const NORMAL_SONGS = SONGS.filter(s => !s.secret);
// シークレット曲(こたえて)。解放後のみ選曲画面の末尾に追加される。
export const SECRET_SONGS = SONGS.filter(s => s.secret);

// 指定IDがシークレット曲か。
export function isSecretSong(songId) {
  return SECRET_SONGS.some(s => s.id === songId);
}

// 通常曲(5曲)を全てクリア済みか。シークレット解放/エンディング判定に使う。
export function areNormalSongsComplete(completedSongs = []) {
  return NORMAL_SONGS.every(s => completedSongs.includes(s.id));
}

// 選曲画面に出す曲。通常曲は常に表示。シークレット曲は解放(=通常曲を全クリア)後のみ末尾へ。
export function getSelectableSongs(completedSongs = []) {
  return areNormalSongsComplete(completedSongs)
    ? [...NORMAL_SONGS, ...SECRET_SONGS]
    : [...NORMAL_SONGS];
}



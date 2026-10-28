import { songKeys, isSameSong } from './src/audio/songMatch.ts';

function isSongInQueueOrPlayed(song, queue, playLog, onAir) {
  if (!song) return false;
  const sId = song.id;
  const sUrl = song.url;
  const sTitle = (song.title || '').trim().toLowerCase();
  const sKeys = song.title ? songKeys({ title: song.title, artist: song.artist, url: song.url }) : [];

  const matches = (other) => {
    if (!other) return false;
    if (sId && other.id && sId === other.id) return true;
    if (sUrl && other.url && sUrl === other.url) return true;
    if (sTitle && other.title && sTitle === other.title.trim().toLowerCase()) return true;
    if (sKeys.length > 0 && other.title && isSameSong(sKeys, songKeys({ title: other.title, artist: other.artist, url: other.url }))) return true;
    return false;
  };

  for (const q of queue) {
    if (matches(q)) return true;
  }
  for (const p of playLog) {
    if (matches(p)) return true;
  }
  if (onAir && matches(onAir)) return true;
  return false;
}

const rawBangers = [
  { id: 'b1', title: 'Song In Queue', artist: 'Artist A', url: 'https://youtube.com/watch?v=11111111111' },
  { id: 'b2', title: 'Song In History', artist: 'Artist B', url: 'https://youtube.com/watch?v=22222222222' },
  { id: 'b3', title: 'Song On Air', artist: 'Artist C', url: 'https://youtube.com/watch?v=33333333333' },
  { id: 'b4', title: 'Fresh Banger', artist: 'Artist D', url: 'https://youtube.com/watch?v=44444444444' },
];

const queue = [
  { id: 'q1', title: 'Song In Queue (Official Video)', artist: 'Artist A', url: 'https://youtube.com/watch?v=11111111111' },
];

const playLog = [
  { id: 'p1', title: 'Song In History', artist: 'Artist B', url: 'https://youtube.com/watch?v=22222222222' },
];

const onAir = { id: 'd1', title: 'Song On Air', artist: 'Artist C', url: 'https://youtube.com/watch?v=33333333333' };

const filtered = rawBangers.filter((b) => !isSongInQueueOrPlayed(b, queue, playLog, onAir));

console.log('Filtered Bangers Count:', filtered.length);
console.log('Filtered Bangers:', filtered.map((f) => f.title));

if (filtered.length !== 1 || filtered[0].title !== 'Fresh Banger') {
  console.error('FAIL: Expected only Fresh Banger to remain!');
  process.exit(1);
} else {
  console.log('PASS: Successfully excluded songs in queue, previously played, and on-air from Top Bangers!');
}

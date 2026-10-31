/**
 * A song's language from its title and artist alone. Used by both the browser (the rhythm plan)
 * and the server (offline Up Next), so it lives outside src/ and server/.
 */
export const SONG_LANGUAGES = ['punjabi', 'hindi', 'english', 'spanish', 'other', 'unknown'] as const;
export type SongLanguage = (typeof SONG_LANGUAGES)[number];

const PUNJABI_HINT =
  /[਀-੿]|\b(punjabi|bhangra|jatt|jatti|gabru|munda|kudi|diljit|sidhu|moose ?wala|aujla|ap dhillon|shubh|guru randhawa|mankirt|gurdas|babbu maan|ammy virk|jass manak|harrdy sandhu|b praak|garry sandhu|panjabi mc|jazzy b|parmish|karan aujla|amrit maan|gippy|sukh-e|mannat noor|nimrat|speed records|white hill|desi melodies|geet mp3|rehaan records|jass records|brown boys|humble music)\b/i;
const HINDI_HINT =
  /[ऀ-ॿ]|\b(bollywood|hindi|arijit|neha kakkar|badshah|honey singh|atif aslam|shreya ghoshal|sonu nigam|kk|shaan|vishal|pritam|t-series|sangeet|haryanvi|zee music|sony music india|tips official|yrf|saregama|eros now)\b/i;
const SPANISH_HINT = /\b(reggaeton|despacito|bad bunny|j balvin|daddy yankee|shakira|maluma|luis fonsi|ozuna|karol g|rosal[ií]a)\b/i;

/**
 * The language from the script, title words and well-known artists. `sure` when one of those
 * matched; then it wins over the AI (the AI's misses in testing were exactly such songs, e.g.
 * Sidhu Moose Wala as Hindi) and the AI isn't asked. Otherwise it's only a guess ("English" for
 * plain Latin-alphabet titles) and the AI's answer is used when it has one.
 */
export function guessLanguage(title: string, artist: string): { language: SongLanguage; sure: boolean } {
  const text = `${title} ${artist}`;
  if (PUNJABI_HINT.test(text)) return { language: 'punjabi', sure: true };
  if (HINDI_HINT.test(text)) return { language: 'hindi', sure: true };
  if (SPANISH_HINT.test(text)) return { language: 'spanish', sure: true };
  return { language: /^[\x20-\x7E]+$/.test(text) ? 'english' : 'other', sure: false };
}

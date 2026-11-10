import { describe, expect, it } from 'vitest';
import { describeApiFailure } from '../src/audio/engine/apiErrors';
import { isNetworkError } from '../server/audioSource';

describe('describeApiFailure', () => {
  it('says the sources were unreachable when every source failed to connect', () => {
    const msg = describeApiFailure(
      'Error: No audio source could provide this song (yt.chocolatemoo53.com: fetch failed; api.piped.private.coffee: fetch failed)',
      'search'
    );
    expect(msg).toMatch(/couldn't reach the audio sources/);
  });

  it('suggests another upload when the sources answered but lack this one', () => {
    const msg = describeApiFailure('Error: No audio source could provide this song (yt.chocolatemoo53.com: HTTP 404; api.piped.private.coffee: HTTP 500)', 'download');
    expect(msg).toMatch(/don't have this upload/);
  });

  it('says the source refused the audio when the download itself gets an HTTP error', () => {
    const msg = describeApiFailure('Error: HTTP 403', 'download', 502);
    expect(msg).toMatch(/refused it \(HTTP 403\)/);
    expect(msg).toMatch(/already on this laptop still play/);
  });

  it('falls back to the server details', () => {
    expect(describeApiFailure('', 'search', 502)).toBe('search failed (HTTP 502)');
  });
});

describe('isNetworkError (extra retries only for unreachable sources)', () => {
  it('matches connection failures, not HTTP errors or slow timeouts', () => {
    expect(isNetworkError('yt.example.com: fetch failed')).toBe(true);
    expect(isNetworkError('getaddrinfo ENOTFOUND yt.example.com')).toBe(true);
    expect(isNetworkError('yt.example.com: HTTP 500')).toBe(false);
    expect(isNetworkError('The operation was aborted due to timeout')).toBe(false);
  });
});

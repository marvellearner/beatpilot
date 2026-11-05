import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../server/paths';

describe('Party Console Queue in Mobile Remote View', () => {
  const remoteViewPath = path.join(ROOT_DIR, 'src', 'remote', 'MobileRemoteView.tsx');
  const remoteViewSource = fs.readFileSync(remoteViewPath, 'utf-8');

  it('renders party-console-queue container and preserves remote-queue compatibility', () => {
    expect(remoteViewSource).toContain('id="party-console-queue"');
    expect(remoteViewSource).toContain('id="remote-queue"');
  });

  it('renders party-console-queue-list and item elements matching QA selectors', () => {
    expect(remoteViewSource).toContain('id="party-console-queue-list"');
    expect(remoteViewSource).toContain('id={`party-console-queue-item-${item.id}`}');
    expect(remoteViewSource).toContain('id="party-console-queue-empty"');
  });

  it('renders party-console-sort-harmonic-btn and party-console-refresh-queue-btn', () => {
    expect(remoteViewSource).toContain('id="party-console-sort-harmonic-btn"');
    expect(remoteViewSource).toContain('id="party-console-refresh-queue-btn"');
  });

  it('renders party-console-artist-focus filter chip with clear focus action', () => {
    expect(remoteViewSource).toContain('id="party-console-artist-focus"');
    expect(remoteViewSource).toContain("type: 'CMD_CLEAR_FOCUS'");
  });

  it('embeds SongSearchDropdown with NLP search inside party-console-queue', () => {
    expect(remoteViewSource).toContain('<SongSearchDropdown');
    expect(remoteViewSource).toContain("type: 'CMD_SET_SONG_FILTER'");
  });

  it('supports MIX, Play Next, and Remove actions on queue rows', () => {
    expect(remoteViewSource).toContain('MIX NOW');
    expect(remoteViewSource).toContain('title="Play Next (Move to top)"');
    expect(remoteViewSource).toContain('title="Remove from queue"');
  });
});


import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real setMedia entry point without starting WebView2 or connecting a display.
const app = readFileSync(new URL('../src/SamaLcd/wwwroot/app.js', import.meta.url), 'utf8');
const start = app.indexOf('const FIT =');
const end = app.indexOf('function renderGallery', start);
assert.ok(start >= 0 && end > start);
const mediaCode = app.slice(start, end);

function scene() {
  let now = 0;
  const context = {performance: {now: () => now}, esc: s => s};
  runInNewContext(mediaCode, context);
  const el = {
    dataset: {}, video: null, renders: 0,
    set innerHTML(html) {
      this.renders++;
      this.video = html.includes('<video') ? {
        duration: 120, currentTime: 0, seeking: false, paused: false,
        play() { this.paused = false; return Promise.resolve(); }
      } : null;
    },
    querySelector() { return this.video; }
  };
  const media = seconds => ({url: 'video.mp4', kind: 'video', fit: 'stretch', playbackSeconds: seconds});
  return {el, media, update: m => context.setMedia(el, m), advance: ms => {now += ms;}};
}

test('opening the preview joins a video already playing on the panel', () => {
  const s = scene();
  s.update(s.media(47));
  assert.equal(s.el.video.currentTime, 47);
});

test('same-file restart and large drift seek without rebuilding the video', () => {
  const s = scene();
  s.update(s.media(47));
  s.update(s.media(0.1));
  assert.equal(s.el.video.currentTime, 0.1);
  assert.equal(s.el.renders, 1);
  s.el.video.currentTime = 6;
  s.update(s.media(38));
  assert.equal(s.el.video.currentTime, 38);
});

test('hidden-window drift is corrected when frame messages resume', () => {
  const s = scene();
  s.update(s.media(5));
  s.advance(30000);
  s.update(s.media(35));
  assert.equal(s.el.video.currentTime, 35);
});

test('delayed metadata uses the most recent clock and includes loading time', () => {
  const s = scene();
  s.update(s.media(5));
  s.el.video.duration = NaN;
  s.el.video.currentTime = 0;
  s.advance(2000);
  s.update(s.media(7));
  s.advance(3000);
  s.el.video.duration = 120;
  s.el.video.onloadedmetadata();
  assert.equal(s.el.video.currentTime, 10);
});

test('loop boundary and small clock differences do not cause extra seeks', () => {
  const s = scene();
  s.update(s.media(119.9));
  s.el.video.currentTime = 119.9;
  s.update(s.media(120.1));
  assert.equal(s.el.video.currentTime, 119.9);
  s.update(s.media(242));
  assert.equal(s.el.video.currentTime, 2);
  s.el.video.currentTime = 2.2;
  s.update(s.media(242.1));
  assert.equal(s.el.video.currentTime, 2.2);
});

test('missing clock leaves an independent preview running and clears stale synchronization', () => {
  const s = scene();
  s.update(s.media(30));
  s.update(s.media(null));
  s.advance(10000);
  s.el.video.oncanplay();
  assert.equal(s.el.video.currentTime, 30);
  s.update(null);
  assert.equal(s.el.video, null);
});

test('unavailable metadata and seeking wait, paused browser playback resumes', () => {
  const s = scene();
  s.update(s.media(10));
  s.el.video.duration = Infinity;
  s.update(s.media(20));
  assert.equal(s.el.video.currentTime, 10);
  s.el.video.duration = 120;
  s.el.video.seeking = true;
  s.update(s.media(30));
  assert.equal(s.el.video.currentTime, 10);
  s.el.video.seeking = false;
  s.el.video.paused = true;
  s.el.video.oncanplay();
  assert.equal(s.el.video.currentTime, 30);
  assert.equal(s.el.video.paused, false);
});

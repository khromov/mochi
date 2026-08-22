// Rendered into the page via {@html} in PersistentVideo.svelte, so it runs on initial parse of every
// page — including after a cross-document navigation — resuming the video with no hydration bundle.
// The closing script tag is split across concatenation here rather than assembled in the .svelte file,
// since a literal one there would close that file's own script block early.
export const persistentVideoScript =
  `<script>(function () {
  var KEY = 'mochi-vt-video-time';
  var video =
    (document.currentScript &&
      document.currentScript.parentElement &&
      document.currentScript.parentElement.querySelector('video.vt-video')) ||
    document.querySelector('video.vt-video');
  if (!video) return;

  // sessionStorage can throw in some privacy modes; the video then simply
  // restarts on each navigation instead of resuming.
  var saved = null;
  try {
    saved = sessionStorage.getItem(KEY);
  } catch {}
  if (saved) {
    var t = parseFloat(saved);
    var restore = function () {
      if (Number.isFinite(t)) video.currentTime = t;
    };
    if (video.readyState >= 1) restore();
    else video.addEventListener('loadedmetadata', restore, { once: true });
  }

  window.addEventListener('pagehide', function () {
    try {
      sessionStorage.setItem(KEY, String(video.currentTime));
    } catch {}
  });
})();</scr` + `ipt>`;

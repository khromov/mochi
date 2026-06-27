// Inline boot script for the persistent video, authored as a raw string and
// rendered into the page via {@html} in PersistentVideo.svelte. Because it's
// part of the server-rendered HTML it runs on initial parse of every page —
// including the page the browser lands on after a cross-document navigation —
// so the video resumes at the saved timestamp with no hydration bundle.
//
// The full <script> wrapper lives here (the closing tag is split across a
// concatenation so it never appears verbatim) rather than being assembled in
// the .svelte file: a literal closing script tag inside a Svelte
// <script lang="ts"> block would close it early.
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

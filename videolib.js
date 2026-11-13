/* Video lectures: separate progress and offline files from the audio library. */
window.VideoLibrary = (() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url = (file, version) => `videos/${encodeURIComponent(file)}?v=${version}`;
  const tabs = '<nav class="lecture-switch" aria-label="Lecture format"><a href="#/audio">Audio</a><a href="#/videos" aria-current="page">Videos</a></nav>';
  function mount({ view, id, pref, store, go, toast }) {
    let disposed = false, video = null, objectUrls = [], lastSaved = -1;
    const controller = new AbortController();
    const positionKey = id ? `videoPos.${id}` : null;
    const save = () => {
      if (video && video.readyState && Number.isFinite(video.currentTime)) pref.set(positionKey, video.currentTime);
    };
    const cleanup = () => {
      disposed = true; controller.abort(); save();
      document.removeEventListener('visibilitychange', save);
      window.removeEventListener('pagehide', save);
      if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
      objectUrls.forEach(u => URL.revokeObjectURL(u));
    };
    const blobUrl = b => { const u = URL.createObjectURL(b); objectUrls.push(u); return u; };
    view.innerHTML = '<div class="head"><h1>Lectures</h1></div>' + tabs + '<p role="status">Loading videos…</p>';
    (async () => {
      const res = await fetch('videos/index.json', { cache: 'no-cache', signal: controller.signal });
      if (!res.ok) throw new Error('Video library unavailable');
      const { videos } = await res.json();
      if (disposed) return;
      if (!id) {
        const row = l => `<a class="row video-row" href="#/watch/${encodeURIComponent(l.id)}"><div class="label"><div class="t">${esc(l.title)}</div><div class="s">${AudioLib.fmtLong(l.duration)} · ${Math.round(l.bytes / 1e6)} MB${pref.get(`videoPos.${l.id}`, 0) > 5 ? ' · Resume ' + AudioLib.fmt(pref.get(`videoPos.${l.id}`, 0)) : ''}</div></div><span aria-hidden="true">▶</span></a>`;
        const courses = [...new Set(videos.map(l => l.course))];  // grouped by course, in index order
        view.innerHTML = '<div class="head"><div><h1>Lectures</h1><div class="sub">Animated lessons · final reviews</div></div></div>' + tabs +
          courses.map(c => `<div class="group-title">${esc(c)}</div><div class="group">` + videos.filter(l => l.course === c).map(row).join('') + '</div>').join('');
        return;
      }
      const l = videos.find(v => v.id === id);
      if (!l) { go('#/videos'); return; }
      const key = `videos/${l.id}/${l.version}`;
      const [saved, captions] = await Promise.all([store.getMedia(key), store.getMedia(key + '/captions')]);
      if (disposed) return;
      view.innerHTML = `<div class="head"><div><a href="#/videos">← Videos</a><h1>${esc(l.title)}</h1><div class="sub">${esc(l.course)} · ${AudioLib.fmtLong(l.duration)}</div></div></div>
        <video class="lecture-video" controls playsinline preload="metadata" aria-label="${esc(l.title)}"><track kind="captions" srclang="en" label="English"></video>
        <div class="video-controls"><button class="btn secondary" data-skip="-15">−15 sec</button><label>Speed <select aria-label="Playback speed">${AudioLib.SPEEDS.map(v => `<option value="${v}">${v}×</option>`).join('')}</select></label><button class="btn secondary" data-skip="15">+15 sec</button></div>
        <p class="small video-note">${esc(l.reviewNote)}</p>
        <div class="video-actions"><button class="btn secondary" id="v-offline"></button><a href="${url(l.transcript, l.version)}">Read transcript</a></div>
        <p id="v-status" role="status" class="small"></p>
        <div class="group-title">Chapters</div><div class="group">${l.chapters.map((c, i) => `<button class="row video-chapter" data-chapter="${i}"><span class="val">${AudioLib.fmt(c.t)}</span><span class="label">${esc(c.title)}</span></button>`).join('')}</div>`;
      video = view.querySelector('video');
      const status = view.querySelector('#v-status'), speed = view.querySelector('select'), offline = view.querySelector('#v-offline');
      let hasOffline = !!saved, pendingSeek = null;
      const paintOffline = () => { offline.textContent = hasOffline ? 'Remove offline copy' : `Save offline · ${Math.round(l.bytes / 1e6)} MB`; };
      paintOffline();
      speed.value = String(pref.get('videoSpeed', 1));
      if (!speed.value) speed.value = '1';
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = pendingSeek === null ? AudioLib.resumeAt(pref.get(positionKey, 0), video.duration) : pendingSeek;
        pendingSeek = null; video.playbackRate = +speed.value;
      });
      video.addEventListener('error', () => { status.textContent = 'Could not load this video. Connect to the internet or use a saved offline copy.'; });
      video.addEventListener('timeupdate', () => {
        if (Math.abs(video.currentTime - lastSaved) >= 5) { save(); lastSaved = video.currentTime; }
        const active = AudioLib.chapterAt(l.chapters, video.currentTime);
        view.querySelectorAll('[data-chapter]').forEach(b => b.toggleAttribute('aria-current', +b.dataset.chapter === active));
      });
      video.addEventListener('pause', save); video.addEventListener('seeked', save); video.addEventListener('ended', () => pref.set(positionKey, 0));
      document.addEventListener('visibilitychange', save); window.addEventListener('pagehide', save);
      video.querySelector('track').src = captions ? blobUrl(captions) : url(l.captions, l.version);
      video.src = saved ? blobUrl(saved) : url(l.file, l.version);
      speed.addEventListener('change', () => { video.playbackRate = +speed.value; pref.set('videoSpeed', +speed.value); });
      view.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => { if (video.readyState) video.currentTime = AudioLib.skipTo(video.currentTime, +b.dataset.skip, video.duration); }));
      view.querySelectorAll('[data-chapter]').forEach(b => b.addEventListener('click', () => {
        const t = l.chapters[+b.dataset.chapter].t;
        if (video.readyState) video.currentTime = t; else pendingSeek = t;
        video.play().catch(() => { status.textContent = 'Press Play to start the video.'; });
      }));
      offline.addEventListener('click', async () => {
        offline.disabled = true;
        try {
          if (hasOffline) {
            await store.delMedia(key); await store.delMedia(key + '/captions'); hasOffline = false;
          } else {
            status.textContent = 'Saving video and captions…';
            const results = await Promise.all([l.file, l.captions].map(async f => {
              const r = await fetch(url(f, l.version), { signal: controller.signal });
              if (!r.ok) throw new Error('Download failed'); return r.blob();
            }));
            if (disposed) return;
            await store.putMedia(key + '/captions', results[1]);
            await store.putMedia(key, results[0]); hasOffline = true;
          }
          if (!disposed) { paintOffline(); status.textContent = hasOffline ? 'Video and captions saved for offline playback.' : 'Offline copy removed.'; }
        } catch (e) { if (!disposed) status.textContent = 'Could not save: ' + e.message; }
        finally { if (!disposed) offline.disabled = false; }
      });
    })().catch(e => {
      if (!disposed) view.innerHTML = '<div class="head"><h1>Lectures</h1></div>' + tabs + '<p>Could not load videos. Open Recall while online, then try again.</p>';
    });
    return cleanup;
  }
  return { mount };
})();

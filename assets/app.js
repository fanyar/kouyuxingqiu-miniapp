const chapterList = document.getElementById("chapter-list");
const chapterGrid = document.getElementById("chapters");
const reader = document.getElementById("reader");
const backButton = document.getElementById("back-button");
const readerLabel = document.getElementById("reader-label");
const readerTitle = document.getElementById("reader-title");
const sentenceList = document.getElementById("sentences");
const playButton = document.getElementById("play-button");
const playIcon = document.getElementById("play-icon");
const pauseIcon = document.getElementById("pause-icon");
const rewindButton = document.getElementById("rewind-button");
const progressInput = document.getElementById("progress");
const currentTimeLabel = document.getElementById("current-time");
const totalTimeLabel = document.getElementById("total-time");
const alignButton = document.getElementById("align-button");
const resetEstimateButton = document.getElementById("reset-estimate");

let chapters = [];
let currentChapter = null;
let audio = null;
let sentenceTimes = [];
let activeSentenceId = null;
let playbackIntent = null;
let pendingSeek = null;
let alignMode = false;
let progressSaveTime = 0;

function storageKey(id) {
  return `kouyu-progress-${id}`;
}

function overridesKey(id) {
  return `kouyu-times-${id}-${currentChapter?.timingVersion || "default"}`;
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function parseMarkedText(text) {
  const fragment = document.createDocumentFragment();
  const parts = text.split(/(\[[^\]]+\])/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("[") && part.endsWith("]")) {
      const span = document.createElement("span");
      span.className = "accent";
      span.textContent = part.slice(1, -1);
      fragment.append(span);
    } else {
      fragment.append(part);
    }
  }
  return fragment;
}

function loadSavedTimes(chapter) {
  try {
    return JSON.parse(localStorage.getItem(overridesKey(chapter.id))) || {};
  } catch {
    return {};
  }
}

function applyTimes(chapter) {
  currentChapter = chapter;
  const saved = loadSavedTimes(chapter);
  sentenceTimes = chapter.sentences.map((sentence) => ({
    ...sentence,
    start: saved[sentence.id]?.start ?? sentence.start,
    end: saved[sentence.id]?.end ?? sentence.end
  }));
}

function applyPendingSeek() {
  if (!audio || pendingSeek == null || audio.readyState < 1) return;
  const seekableEnd = audio.seekable.length ? audio.seekable.end(audio.seekable.length - 1) : 0;
  if (seekableEnd < pendingSeek) return;
  audio.currentTime = pendingSeek;
  pendingSeek = null;
}

function saveTimes(chapter) {
  const saved = {};
  sentenceTimes.forEach(({ id, start, end }) => {
    saved[id] = { start, end };
  });
  localStorage.setItem(overridesKey(chapter.id), JSON.stringify(saved));
}

function renderChapterCards() {
  chapterGrid.replaceChildren();
  chapters.forEach((chapter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chapter-card";
    const saved = JSON.parse(localStorage.getItem(storageKey(chapter.id)) || "null");
    button.innerHTML = `
      <span class="chapter-badge">${chapter.letter}</span>
      <span class="chapter-name">${chapter.title}</span>
      <span class="chapter-meta">${chapter.sentences.length} 句 · ${formatTime(chapter.duration)}${
        saved ? ` · 上次 ${formatTime(saved.currentTime)}` : ""
      }</span>
    `;
    button.addEventListener("click", () => openChapter(chapter.id));
    chapterGrid.append(button);
  });
}

function renderSentences() {
  sentenceList.replaceChildren();
  sentenceTimes.forEach((sentence) => {
    const item = document.createElement("li");
    item.dataset.id = sentence.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sentence";
    button.dataset.id = sentence.id;
    button.innerHTML = `
      <svg class="pointer" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9h10"/><path d="M9 15h6"/><circle cx="16" cy="17" r="3"/><path d="m11 3 1 6h-4l1-6z"/></svg>
      <span class="sentence-text"></span>
    `;
    button.querySelector(".sentence-text").append(parseMarkedText(sentence.text));
    button.addEventListener("click", () => handleSentenceClick(sentence));
    item.append(button);
    sentenceList.append(item);
  });
}

function setPlayIcon(isPlaying) {
  playIcon.hidden = isPlaying;
  pauseIcon.hidden = !isPlaying;
  playButton.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
  playButton.title = isPlaying ? "暂停" : "播放";
}

function setActiveSentence(id) {
  if (activeSentenceId === id) return;
  activeSentenceId = id;
  sentenceList.querySelectorAll(".sentence").forEach((node) => {
    const isActive = Number(node.dataset.id) === id;
    node.classList.toggle("active", isActive);
    if (isActive) {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

function sentenceAt(time) {
  return sentenceTimes.find(({ start, end }) => time >= start && time < end);
}

function updateCurrentTime() {
  const time = audio.currentTime;
  currentTimeLabel.textContent = formatTime(time);
  progressInput.value = Math.round((time / (audio.duration || currentChapter.duration)) * 1000);

  if (!alignMode && (!playbackIntent || playbackIntent.type === "chapter")) {
    const sentence = sentenceAt(time);
    setActiveSentence(sentence?.id ?? null);
  }

  if (playbackIntent?.type === "sentence" && time >= playbackIntent.end) {
    audio.pause();
  }

  if (time - progressSaveTime > 1 || time < progressSaveTime) {
    progressSaveTime = time;
    localStorage.setItem(storageKey(currentChapter.id), JSON.stringify({
      currentTime: time,
      updatedAt: Date.now()
    }));
  }
}

function configureAudio(chapter, startTime = 0) {
  audio?.pause();
  audio = new Audio(chapter.audio);
  audio.preload = "metadata";
  playbackIntent = null;
  pendingSeek = startTime > 0 ? startTime : null;

  audio.addEventListener("loadedmetadata", () => {
    totalTimeLabel.textContent = formatTime(audio.duration || chapter.duration);
    applyPendingSeek();
  });
  audio.addEventListener("canplay", applyPendingSeek);
  audio.addEventListener("canplaythrough", applyPendingSeek);
  audio.addEventListener("progress", applyPendingSeek);
  audio.addEventListener("timeupdate", updateCurrentTime);
  audio.addEventListener("play", () => setPlayIcon(true));
  audio.addEventListener("pause", () => setPlayIcon(false));
  audio.addEventListener("ended", () => {
    setPlayIcon(false);
    localStorage.setItem(storageKey(chapter.id), JSON.stringify({
      currentTime: 0,
      updatedAt: Date.now()
    }));
  });
}

function seekTo(time) {
  const safeTime = Math.max(0, Math.min(time, audio.duration || currentChapter.duration));
  pendingSeek = safeTime;
  applyPendingSeek();
}

function openChapter(id) {
  const chapter = chapters.find((item) => item.id === id);
  if (!chapter) return;

  currentChapter = chapter;
  applyTimes(chapter);
  renderSentences();
  readerLabel.textContent = `Level 1 · ${chapter.letter}`;
  readerTitle.textContent = chapter.title;
  chapterList.hidden = true;
  reader.hidden = false;
  backButton.hidden = false;
  window.scrollTo({ top: 0 });

  let startTime = 0;
  try {
    startTime = JSON.parse(localStorage.getItem(storageKey(id)))?.currentTime || 0;
  } catch {
    startTime = 0;
  }
  configureAudio(chapter, startTime);
  currentTimeLabel.textContent = formatTime(startTime);
  totalTimeLabel.textContent = formatTime(chapter.duration);
  progressInput.value = Math.round((startTime / chapter.duration) * 1000);
}

function closeChapter() {
  audio?.pause();
  chapterList.hidden = false;
  reader.hidden = true;
  backButton.hidden = true;
  currentChapter = null;
  renderChapterCards();
}

async function handleSentenceClick(sentence) {
  if (alignMode) {
    const markTime = audio.currentTime;
    const index = sentenceTimes.findIndex((item) => item.id === sentence.id);
    sentenceTimes[index].start = markTime;
    const previous = sentenceTimes[index - 1];
    if (previous) previous.end = Math.max(previous.start + 0.3, markTime - 0.12);
    const next = sentenceTimes[index + 1];
    if (!next) sentenceTimes[index].end = Math.min(markTime + 4, currentChapter.duration);
    saveTimes(currentChapter);
    setActiveSentence(sentence.id);
    return;
  }

  const startTime = Math.max(0, sentence.start - 0.08);
  seekTo(startTime);
  playbackIntent = {
    type: "sentence",
    end: sentence.end + 0.18
  };
  setActiveSentence(sentence.id);
  await audio.play();
}

playButton.addEventListener("click", async () => {
  if (!currentChapter) return;
  if (audio.paused) {
    playbackIntent = { type: "chapter" };
    await audio.play();
  } else {
    audio.pause();
  }
});

rewindButton.addEventListener("click", () => {
  if (!currentChapter) return;
  playbackIntent = { type: "chapter" };
  seekTo(audio.currentTime - 5);
});

progressInput.addEventListener("input", () => {
  if (!currentChapter) return;
  const ratio = Number(progressInput.value) / 1000;
  seekTo(ratio * (audio.duration || currentChapter.duration));
  if (!audio.paused) playbackIntent = { type: "chapter" };
});

alignButton.addEventListener("click", () => {
  alignMode = !alignMode;
  alignButton.setAttribute("aria-pressed", String(alignMode));
  audio?.pause();
  playbackIntent = null;
});

resetEstimateButton.addEventListener("click", () => {
  if (!currentChapter) return;
  localStorage.removeItem(overridesKey(currentChapter.id));
  applyTimes(currentChapter);
  renderSentences();
});

backButton.addEventListener("click", closeChapter);

async function init() {
  const data = window.KOUYU_CHAPTERS;
  chapters = data.chapters;
  if (!chapters.length) {
    chapterGrid.innerHTML = '<p class="empty-state">还没有章节文件。</p>';
    return;
  }
  renderChapterCards();
}

init();

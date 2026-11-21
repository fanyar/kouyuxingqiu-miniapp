const libraryPage = document.getElementById("library-page");
const bookGrid = document.getElementById("books");
const chapterPage = document.getElementById("chapter-page");
const chapterGrid = document.getElementById("chapters");
const reader = document.getElementById("reader");
const backLink = document.getElementById("back-link");
const contextLabel = document.getElementById("context-label");
const bookTitle = document.getElementById("chapter-page-title");
const readerLabel = document.getElementById("reader-label");
const readerTitle = document.getElementById("reader-title");
const sentenceList = document.getElementById("sentences");
const playButton = document.getElementById("play-button");
const pauseButton = document.getElementById("pause-button");
const prevChapterButton = document.getElementById("prev-chapter");
const nextChapterButton = document.getElementById("next-chapter");
const rewindButton = document.getElementById("rewind-button");
const progressInput = document.getElementById("progress");
const currentTimeLabel = document.getElementById("current-time");
const totalTimeLabel = document.getElementById("total-time");
const alignButton = document.getElementById("align-button");
const resetEstimateButton = document.getElementById("reset-estimate");

let books = [];
let currentBook = null;
let currentChapter = null;
let audio = null;
let sentenceTimes = [];
let activeSentenceId = null;
let playbackIntent = null;
let pendingSeek = null;
let alignMode = false;
let progressSaveTime = 0;
let audioSession = 0;
let playbackWatcher = 0;
let audioObjectUrl = null;

const SPEECH_HIGHLIGHT_DELAY = 0.16;
const NATURAL_SPEECH_GAP_MAX = 1.5;
const SKIPPED_GAP_PAUSE = 1;
const CHAPTER_INTRO_MAX_NATURAL_GAP = 2;
const CHAPTER_INTRO_SKIP_AT = 1.8;
const PLAYBACK_WATCH_INTERVAL = 50;

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function parseJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function progressKey(book, chapter) {
  return `kouyu-progress-${book.id}-${chapter.id}`;
}

function overridesKey(book, chapter) {
  return `kouyu-times-${book.id}-${chapter.id}-${chapter.timingVersion}`;
}

function readProgress(book, chapter) {
  const saved = parseJSON(progressKey(book, chapter));
  if (saved) return saved;

  if (book.id === "level1") {
    return parseJSON(`kouyu-progress-${chapter.id}`);
  }
  return null;
}

function saveProgress(book, chapter, currentTime, extra = {}) {
  const previous = readProgress(book, chapter) || {};
  const completed = extra.completed ?? false;
  localStorage.setItem(progressKey(book, chapter), JSON.stringify({
    ...previous,
    completed,
    currentTime,
    updatedAt: Date.now()
  }));
}

function loadSavedTimes(book, chapter) {
  const saved = parseJSON(overridesKey(book, chapter));
  if (saved) return saved;

  if (book.id === "level1") {
    return parseJSON(`kouyu-times-${chapter.id}-${chapter.timingVersion}`) || {};
  }
  return {};
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

function applyTimes(book, chapter) {
  currentChapter = chapter;
  const saved = loadSavedTimes(book, chapter);
  sentenceTimes = chapter.sentences.map((sentence) => ({
    ...sentence,
    start: saved[sentence.id]?.start ?? sentence.start,
    end: saved[sentence.id]?.end ?? sentence.end
  }));
}

function latestChapterProgress(book) {
  return book.chapters.reduce((latest, chapter) => {
    const progress = readProgress(book, chapter);
    if (!progress?.updatedAt) return latest;
    if (!latest || progress.updatedAt > latest.progress.updatedAt) {
      return { chapter, progress };
    }
    return latest;
  }, null);
}

function resumeChapterProgress(book) {
  const latest = latestChapterProgress(book);
  if (!latest) return null;

  if (!latest.progress.completed) {
    return { chapter: latest.chapter, label: "上次读到" };
  }

  const index = book.chapters.findIndex(({ id }) => id === latest.chapter.id);
  const next = index >= 0 ? book.chapters[index + 1] : null;
  return {
    chapter: next || latest.chapter,
    label: next ? "从这里开始读" : "已读完"
  };
}

function renderBooks() {
  bookGrid.replaceChildren();
  if (!books.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "还没有书籍文件。";
    bookGrid.append(empty);
    return;
  }
  books.forEach((book) => {
    const card = document.createElement("a");
    card.className = "book-card";
    card.href = `#/books/${encodeURIComponent(book.id)}`;
    card.setAttribute("aria-label", `打开${book.title}`);

    const name = document.createElement("span");
    name.className = "book-name";
    name.textContent = book.title;

    const meta = document.createElement("span");
    meta.className = "chapter-meta";
    const resume = resumeChapterProgress(book);
    meta.textContent = resume
      ? `${book.chapters.length} 章节 · 继续 ${resume.chapter.id}`
      : `${book.chapters.length} 章节`;

    card.append(name, meta);
    bookGrid.append(card);
  });
}

function renderChapterCards(book) {
  chapterGrid.replaceChildren();
  if (!book.chapters.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "这本书还没有章节。";
    chapterGrid.append(empty);
    return;
  }

  const resume = resumeChapterProgress(book);
  book.chapters.forEach((chapter) => {
    const card = document.createElement("a");
    card.className = "chapter-card";
    card.href = `#/books/${encodeURIComponent(book.id)}/chapters/${encodeURIComponent(chapter.id)}`;
    card.setAttribute("aria-label", `打开章节 ${chapter.title}`);

    const badge = document.createElement("span");
    badge.className = "chapter-badge";
    badge.textContent = chapter.id;

    const name = document.createElement("span");
    name.className = "chapter-name";
    name.textContent = chapter.title;

    if (resume?.chapter.id === chapter.id) {
      const chip = document.createElement("span");
      chip.className = "chapter-resume";
      chip.textContent = resume.label;
      card.classList.add("is-resume");
      card.setAttribute("aria-label", `${resume.label}：${chapter.title}`);
      card.append(chip);
    }

    const meta = document.createElement("span");
    meta.className = "chapter-meta";
    const saved = readProgress(book, chapter);
    meta.textContent = `${chapter.sentences.length} 句 · ${formatTime(chapter.duration)}${
      saved ? ` · 上次 ${formatTime(saved.currentTime)}` : ""
    }`;

    card.append(badge, name, meta);
    chapterGrid.append(card);
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
  playButton.hidden = isPlaying;
  pauseButton.hidden = !isPlaying;
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

function sentenceAt(time, useHighlightDelay = true) {
  const delay = useHighlightDelay ? SPEECH_HIGHLIGHT_DELAY : 0;
  return sentenceTimes.find(({ start, end }) => (
    time >= start + delay && time < end
  ));
}

function syncActiveSentence(time) {
  if (alignMode) return;
  if (playbackIntent?.type !== "chapter" && playbackIntent?.type !== "sentence") return;

  const sentence = sentenceAt(time);
  const isSentenceTarget = playbackIntent?.type !== "sentence" || sentence?.id === playbackIntent.id;
  setActiveSentence(sentence && isSentenceTarget ? sentence.id : null);
}

function maybeSkipSentenceGap(time) {
  if (playbackIntent?.type !== "chapter" || !audio || audio.paused || alignMode) return;
  if (sentenceAt(time, false)) return;

  let previous = null;
  let next = null;
  for (const sentence of sentenceTimes) {
    if (sentence.end <= time) previous = sentence;
    if (!next && sentence.start > time) next = sentence;
  }

  if (!previous && next) {
    if (next.start > CHAPTER_INTRO_MAX_NATURAL_GAP && time >= CHAPTER_INTRO_SKIP_AT) {
      seekTo(next.start);
    }
    return;
  }
  if (!previous || !next) return;

  const naturalGap = next.start - previous.end;
  if (naturalGap <= NATURAL_SPEECH_GAP_MAX) return;
  if (time < previous.end + SKIPPED_GAP_PAUSE) return;
  seekTo(next.start);
}

function updatePlaybackState(time) {
  currentTimeLabel.textContent = formatTime(time);
  progressInput.value = Math.round((time / (audio.duration || currentChapter.duration)) * 1000);

  syncActiveSentence(time);
  maybeSkipSentenceGap(time);

  if (time - progressSaveTime > 1 || time < progressSaveTime) {
    progressSaveTime = time;
    saveProgress(currentBook, currentChapter, time);
  }

  if (playbackIntent?.type === "sentence" && time >= playbackIntent.end) {
    audio.pause();
    playbackIntent = null;
    setActiveSentence(null);
  }
}

function updateCurrentTime(event) {
  if (!currentBook || !currentChapter || !audio || event.target !== audio) return;
  updatePlaybackState(audio.currentTime);
}

function applyPendingSeek() {
  if (!audio || pendingSeek == null || audio.readyState < 1) return;
  audio.currentTime = pendingSeek;
  pendingSeek = null;
}

async function configureAudio(book, chapter, startTime = 0) {
  stopPlaybackWatcher();
  audio?.pause();
  const session = ++audioSession;
  audio = new Audio();
  audio.preload = "auto";
  playbackIntent = null;
  pendingSeek = startTime > 0 ? startTime : null;

  try {
    const response = await fetch(chapter.audio, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (session !== audioSession) return;
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = URL.createObjectURL(blob);
    audio.src = audioObjectUrl;
  } catch {
    if (session !== audioSession) return;
    audio.src = chapter.audio;
  }
  if (session !== audioSession) return;
  audio.load();
  audio.addEventListener("loadedmetadata", () => {
    if (session !== audioSession || currentChapter !== chapter) return;
    totalTimeLabel.textContent = formatTime(audio.duration || chapter.duration);
    applyPendingSeek();
  });
  audio.addEventListener("canplay", () => {
    if (session === audioSession) applyPendingSeek();
  });
  audio.addEventListener("canplaythrough", () => {
    if (session === audioSession) applyPendingSeek();
  });
  audio.addEventListener("progress", () => {
    if (session === audioSession) applyPendingSeek();
  });
  audio.addEventListener("timeupdate", updateCurrentTime);
  audio.addEventListener("play", () => {
    if (session === audioSession) {
      setPlayIcon(true);
      startPlaybackWatcher();
    }
  });
  audio.addEventListener("pause", () => {
    if (session === audioSession) {
      setPlayIcon(false);
      stopPlaybackWatcher();
      if (playbackIntent?.type === "sentence") setActiveSentence(null);
    }
  });
  audio.addEventListener("ended", () => {
    if (session !== audioSession || currentChapter !== chapter) return;
    setPlayIcon(false);
    saveProgress(book, chapter, 0, { completed: true });
  });
}

function stopPlaybackWatcher() {
  if (!playbackWatcher) return;
  clearInterval(playbackWatcher);
  playbackWatcher = 0;
}

function startPlaybackWatcher() {
  stopPlaybackWatcher();
  const session = audioSession;
  playbackWatcher = setInterval(() => {
    if (session !== audioSession || !audio || audio.paused) {
      stopPlaybackWatcher();
      return;
    }
    updatePlaybackState(audio.currentTime);
  }, PLAYBACK_WATCH_INTERVAL);
}

function seekTo(time) {
  const safeTime = Math.max(0, Math.min(time, audio.duration || currentChapter.duration));
  pendingSeek = safeTime;
  applyPendingSeek();
}

function saveTimes(book, chapter) {
  const saved = {};
  sentenceTimes.forEach(({ id, start, end }) => {
    saved[id] = { start, end };
  });
  localStorage.setItem(overridesKey(book, chapter), JSON.stringify(saved));
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
    saveTimes(currentBook, currentChapter);
    setActiveSentence(sentence.id);
    return;
  }

  const startTime = Math.max(0, sentence.start);
  seekTo(startTime);
  playbackIntent = {
    type: "sentence",
    id: sentence.id,
    end: sentence.end + 0.18
  };
  await audio.play();
}

playButton.addEventListener("click", async () => {
  if (!currentChapter) return;
  playbackIntent = { type: "chapter" };
  await audio.play();
});

pauseButton.addEventListener("click", () => {
  if (!currentChapter) return;
  audio.pause();
});

async function togglePlayPause() {
  if (!currentChapter || !audio) return;

  if (audio.paused) {
    if (audio.ended || audio.currentTime >= audio.duration - 0.05) {
      playbackIntent = { type: "chapter" };
      seekTo(0);
    } else if (!playbackIntent) {
      playbackIntent = { type: "chapter" };
    }
    await audio.play().catch(() => {});
    return;
  }

  audio.pause();
}

document.addEventListener("keydown", (event) => {
  if (
    event.code !== "Space" ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    reader.hidden
  ) return;

  event.preventDefault();
  void togglePlayPause();
});

function chapterAt(offset) {
  if (!currentBook || !currentChapter) return null;
  const list = currentBook.chapters;
  const index = list.findIndex((chapter) => chapter.id === currentChapter.id);
  return index < 0 ? null : list[index + offset] || null;
}

function goToChapter(chapter) {
  if (!chapter || !currentBook) return;
  location.hash = `#/books/${encodeURIComponent(currentBook.id)}/chapters/${encodeURIComponent(chapter.id)}`;
}

function updateChapterNav() {
  const previous = chapterAt(-1);
  const next = chapterAt(1);
  prevChapterButton.disabled = !previous;
  nextChapterButton.disabled = !next;
  prevChapterButton.title = previous ? `上一章：${previous.title}` : "已经是第一章";
  nextChapterButton.title = next ? `下一章：${next.title}` : "已经是最后一章";
}

prevChapterButton.addEventListener("click", () => goToChapter(chapterAt(-1)));
nextChapterButton.addEventListener("click", () => goToChapter(chapterAt(1)));

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
  if (!currentBook || !currentChapter) return;
  localStorage.removeItem(overridesKey(currentBook, currentChapter));
  applyTimes(currentBook, currentChapter);
  renderSentences();
});

function showPage(page) {
  libraryPage.hidden = page !== "library";
  chapterPage.hidden = page !== "chapters";
  reader.hidden = page !== "reader";
}

function resetReaderState() {
  audioSession += 1;
  currentBook = null;
  currentChapter = null;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = null;
  }
  audio = null;
  sentenceTimes = [];
  activeSentenceId = null;
  playbackIntent = null;
  pendingSeek = null;
  alignMode = false;
  stopPlaybackWatcher();
  alignButton.setAttribute("aria-pressed", "false");
  sentenceList.replaceChildren();
  setPlayIcon(false);
}

function parseRoute() {
  const path = location.hash.replace(/^#/, "");
  if (!path || path === "/") return { page: "library" };

  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 2 && parts[0] === "books") {
    return { page: "chapters", bookId: parts[1] };
  }
  if (
    parts.length === 4 &&
    parts[0] === "books" &&
    parts[2] === "chapters"
  ) {
    return { page: "reader", bookId: parts[1], chapterId: parts[3] };
  }
  return null;
}

function replaceWithLibrary() {
  location.replace("#/");
}

async function renderRoute() {
  const route = parseRoute();
  if (!route) {
    replaceWithLibrary();
    return;
  }

  resetReaderState();
  window.scrollTo({ top: 0 });

  if (route.page === "library") {
    showPage("library");
    contextLabel.textContent = "书架";
    backLink.hidden = true;
    renderBooks();
    return;
  }

  const book = books.find(({ id }) => id === route.bookId);
  if (!book) {
    replaceWithLibrary();
    return;
  }
  currentBook = book;

  if (route.page === "chapters") {
    showPage("chapters");
    contextLabel.textContent = "章节";
    backLink.hidden = false;
    backLink.href = "#/";
    backLink.setAttribute("aria-label", "返回书架");
    backLink.title = "返回书架";
    bookTitle.textContent = book.title;
    renderChapterCards(book);
    return;
  }

  const chapter = book.chapters.find(({ id }) => id === route.chapterId);
  if (!chapter) {
    location.replace(`#/books/${encodeURIComponent(book.id)}`);
    return;
  }

  currentChapter = chapter;
  applyTimes(book, chapter);
  renderSentences();
  showPage("reader");
  contextLabel.textContent = "跟读";
  backLink.hidden = false;
  backLink.href = `#/books/${encodeURIComponent(book.id)}`;
  backLink.setAttribute("aria-label", "返回章节");
  backLink.title = "返回章节";
  readerLabel.textContent = `${book.title} · ${chapter.id}`;
  readerTitle.textContent = chapter.title;
  updateChapterNav();

  // 章节从原始音频开头播放；过长的前奏由播放调度在约 2 秒时跳过。
  const startTime = 0;
  await configureAudio(book, chapter, startTime);
  currentTimeLabel.textContent = formatTime(startTime);
  totalTimeLabel.textContent = formatTime(chapter.duration);
  progressInput.value = Math.round((startTime / chapter.duration) * 1000);
  playbackIntent = { type: "chapter" };
  audio.play().catch(() => {
    // 浏览器可能阻止自动播放，此时保持暂停，用户可点击播放按钮
  });
}

function init() {
  books = window.KOUYU_LIBRARY?.books || [];
  const debugMode = new URLSearchParams(location.search).get("debug") === "1";
  alignButton.hidden = !debugMode;
  resetEstimateButton.hidden = !debugMode;
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

init();

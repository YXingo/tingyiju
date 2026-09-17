(function () {
  "use strict";

  var segmenter = window.TingYiJuSegmenter;
  var playerApi = window.TingYiJuPlayer;
  var STATES = playerApi.STATES;
  var SpeechPlayer = playerApi.SpeechPlayer;
  var SAMPLE_TEXT = "认真学习党的理论知识，积极参加集体活动。\n把对党的认识写进真实经历，把对未来的承诺落实到每一天。";
  var DEFAULT_VOICE_ID = "zf_001";
  var DEFAULT_MIN_LENGTH = 10;
  var DEFAULT_MAX_LENGTH = 18;
  var VOICES = [
    { id: "zf_001", label: "女声 · 清晰" },
    { id: "zf_004", label: "女声 · 温和" },
    { id: "zm_010", label: "男声 · 稳重" },
    { id: "zm_025", label: "男声 · 清朗" }
  ];
  var elements = {
    articleInput: document.getElementById("articleInput"),
    characterCount: document.getElementById("characterCount"),
    editHint: document.getElementById("editHint"),
    sampleButton: document.getElementById("sampleButton"),
    startButton: document.getElementById("startButton"),
    startButtonLabel: document.getElementById("startButtonLabel"),
    voiceSelect: document.getElementById("voiceSelect"),
    refreshVoicesButton: document.getElementById("refreshVoicesButton"),
    voiceValue: document.getElementById("voiceValue"),
    voiceHint: document.getElementById("voiceHint"),
    rateInput: document.getElementById("rateInput"),
    rateValue: document.getElementById("rateValue"),
    minLengthInput: document.getElementById("minLengthInput"),
    maxLengthInput: document.getElementById("maxLengthInput"),
    lengthValue: document.getElementById("lengthValue"),
    intervalInput: document.getElementById("intervalInput"),
    intervalValue: document.getElementById("intervalValue"),
    readerCard: document.getElementById("readerCard"),
    statusLabel: document.getElementById("statusLabel"),
    currentIndex: document.getElementById("currentIndex"),
    totalSentences: document.getElementById("totalSentences"),
    currentSentence: document.getElementById("currentSentence"),
    cycleMessage: document.getElementById("cycleMessage"),
    previousButton: document.getElementById("previousButton"),
    pauseButton: document.getElementById("pauseButton"),
    pauseButtonLabel: document.getElementById("pauseButtonLabel"),
    nextButton: document.getElementById("nextButton"),
    nextButtonLabel: document.getElementById("nextButtonLabel"),
    feedback: document.getElementById("feedback"),
    sentenceList: document.getElementById("sentenceList"),
    queueCount: document.getElementById("queueCount"),
    toast: document.getElementById("toast")
  };

  var toastTimer = null;
  var isComposing = false;
  var serviceAvailable = false;
  var player = new SpeechPlayer({
    onStateChange: renderState,
    onCurrentChange: renderCurrent
  });

  function stateLabel(state) {
    return {
      idle: "待开始",
      speaking: "朗读中",
      waiting: "等待重复",
      paused: "已暂停",
      completed: "已完成",
      error: "播放错误"
    }[state] || "待开始";
  }

  function setFeedback(message, tone) {
    elements.feedback.textContent = message || "";
    if (tone && tone !== "default") elements.feedback.dataset.tone = tone;
    else delete elements.feedback.dataset.tone;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(function () {
      elements.toast.classList.remove("is-visible");
    }, 2600);
  }

  function updateCharacterCount() {
    elements.characterCount.textContent = String(elements.articleInput.value.trim().length);
  }

  function renderSentenceList(sentences, currentIndex) {
    elements.sentenceList.textContent = "";
    elements.queueCount.textContent = sentences.length + " 句";
    if (!sentences.length) {
      var empty = document.createElement("li");
      empty.className = "empty-list-item";
      empty.textContent = "开始朗读后，分好的句子会出现在这里。";
      elements.sentenceList.appendChild(empty);
      return;
    }
    sentences.forEach(function (sentence, index) {
      var item = document.createElement("li");
      item.textContent = sentence;
      if (index === currentIndex) {
        item.classList.add("is-current");
        item.setAttribute("aria-current", "true");
      }
      elements.sentenceList.appendChild(item);
    });
    var activeItem = elements.sentenceList.querySelector(".is-current");
    if (activeItem) activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderCurrent(info) {
    var hasCurrent = info.index >= 0 && info.sentence;
    elements.currentIndex.textContent = hasCurrent ? String(info.index + 1) : "—";
    elements.totalSentences.textContent = String(info.total || 0);
    elements.currentSentence.textContent = hasCurrent ? info.sentence : "你的第一句，会在这里停住。";
    elements.currentSentence.classList.toggle("sentence-text-placeholder", !hasCurrent);
    renderSentenceList(player.sentences, hasCurrent ? info.index : -1);
  }

  function renderState(snapshot, event) {
    var state = snapshot.state;
    elements.readerCard.dataset.state = state;
    elements.statusLabel.textContent = stateLabel(state);
    elements.startButtonLabel.textContent = state === STATES.IDLE ? "开始朗读" : "从第一句开始";
    elements.pauseButtonLabel.textContent = state === STATES.PAUSED ? "继续" : state === STATES.ERROR ? "重试" : "暂停";
    elements.nextButtonLabel.textContent = snapshot.currentIndex === snapshot.total - 1 && snapshot.total > 0 ? "完成" : "下一句";
    elements.previousButton.disabled = snapshot.currentIndex <= 0 || !snapshot.total;
    elements.nextButton.disabled = !snapshot.total || snapshot.currentIndex < 0 || state === STATES.IDLE || state === STATES.COMPLETED;
    elements.pauseButton.disabled = ![STATES.SPEAKING, STATES.WAITING, STATES.PAUSED, STATES.ERROR].includes(state);

    if (state === STATES.SPEAKING) elements.cycleMessage.textContent = "这一句正在耳边播放；读完后会停一下，再从头开始。";
    else if (state === STATES.WAITING) elements.cycleMessage.textContent = "先留一点空白。下一轮仍然是这一句。";
    else if (state === STATES.PAUSED) elements.cycleMessage.textContent = "已停在这一句；继续时会从句首重新读起。";
    else if (state === STATES.COMPLETED) elements.cycleMessage.textContent = "这篇文章读完了。你可以结束，或重新从第一句开始。";
    else if (state === STATES.ERROR) elements.cycleMessage.textContent = "朗读没有继续；请检查本地服务后重试。";
    else elements.cycleMessage.textContent = "输入正文后，从第一句开始。";
    if (event && event.message) setFeedback(event.message, event.tone);
  }

  function voiceById(id) {
    return VOICES.find(function (voice) { return voice.id === id; }) || VOICES[0];
  }

  function applyVoice(voiceId, options) {
    var voice = voiceById(voiceId);
    elements.voiceSelect.value = voice.id;
    elements.voiceValue.textContent = voice.label.replace(" · ", " ");
    elements.voiceHint.textContent = "Kokoro 本地音色 " + voice.id + "；中文和 English 由同一模型连续朗读。";
    player.updateSettings({ voiceProfile: { voice: voice.id, label: voice.label } }, options);
  }

  function setupVoices() {
    elements.voiceSelect.textContent = "";
    var group = document.createElement("optgroup");
    group.label = "Kokoro 本地音色 · 4 选 1";
    VOICES.forEach(function (voice) {
      var option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.label;
      group.appendChild(option);
    });
    elements.voiceSelect.appendChild(group);
    applyVoice(DEFAULT_VOICE_ID, { silent: true });
  }

  async function checkService(showResult) {
    elements.refreshVoicesButton.disabled = true;
    elements.startButton.disabled = true;
    elements.voiceHint.textContent = "正在连接本机 Kokoro 服务…";
    try {
      var response = await window.fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("服务不可用");
      serviceAvailable = true;
      elements.startButton.disabled = false;
      elements.voiceSelect.disabled = false;
      applyVoice(elements.voiceSelect.value || DEFAULT_VOICE_ID, { silent: true });
      setFeedback("本地 Kokoro 已就绪。首次生成新句会稍慢，之后会自动复用缓存。", "success");
      if (showResult) showToast("本地语音服务已连接。");
    } catch (error) {
      serviceAvailable = false;
      elements.voiceSelect.disabled = true;
      elements.voiceHint.textContent = "未连接本地语音服务，请双击“启动听一句.command”。";
      setFeedback("请通过本地启动器打开听一句，不能直接双击 index.html。", "error");
      if (showResult) showToast("仍未连接到本地语音服务。");
    } finally {
      elements.refreshVoicesButton.disabled = false;
    }
  }

  function handleArticleInput() {
    updateCharacterCount();
    if (player.sentences.length > 0) {
      player.clearForContentChange();
      elements.editHint.textContent = "文章已修改，请重新开始朗读。";
      showToast("文章已修改，请重新开始。");
    } else {
      elements.editHint.textContent = "正文只留在本机当前页面，刷新后不会保留。";
    }
  }

  function startReading() {
    if (!serviceAvailable) {
      setFeedback("本地语音服务未连接，请先点击“重新连接”。", "error");
      return;
    }
    var sentences = segmenter.splitSentences(elements.articleInput.value, getLengthRange());
    if (!sentences.length) {
      setFeedback("先放入一段包含文字的正文；纯空白或纯标点不会开始朗读。", "error");
      elements.articleInput.focus();
      return;
    }
    renderSentenceList(sentences, 0);
    player.start(sentences);
  }

  function handlePause() {
    if (player.state === STATES.ERROR) player.retry();
    else player.togglePause();
  }

  function handleRateChange(silent) {
    var value = Number(elements.rateInput.value);
    elements.rateValue.textContent = value.toFixed(2) + "×";
    player.updateSettings({ rate: value }, silent ? { silent: true } : undefined);
  }

  function clampInteger(value, fallback) {
    var number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(60, Math.max(4, number));
  }

  function getLengthRange() {
    return {
      minLength: clampInteger(elements.minLengthInput.value, DEFAULT_MIN_LENGTH),
      maxLength: clampInteger(elements.maxLengthInput.value, DEFAULT_MAX_LENGTH)
    };
  }

  function previewLengthRange() {
    var minLength = Number(elements.minLengthInput.value);
    var maxLength = Number(elements.maxLengthInput.value);
    if (!Number.isFinite(minLength) || !Number.isFinite(maxLength) || minLength > maxLength) {
      elements.lengthValue.textContent = "请检查范围";
      return;
    }
    elements.lengthValue.textContent = Math.round(minLength) + "–" + Math.round(maxLength) + " 字";
  }

  function handleLengthChange(changedInput, silent) {
    var minLength = clampInteger(elements.minLengthInput.value, DEFAULT_MIN_LENGTH);
    var maxLength = clampInteger(elements.maxLengthInput.value, DEFAULT_MAX_LENGTH);
    if (minLength > maxLength) {
      if (changedInput === elements.minLengthInput) maxLength = minLength;
      else minLength = maxLength;
    }
    elements.minLengthInput.value = String(minLength);
    elements.maxLengthInput.value = String(maxLength);
    elements.minLengthInput.max = String(maxLength);
    elements.maxLengthInput.min = String(minLength);
    previewLengthRange();

    if (!silent && player.sentences.length) {
      player.clearForContentChange();
      elements.editHint.textContent = "分句范围已更新，请重新开始朗读。";
      setFeedback("已按新的字数范围准备重新分段。", "default");
      showToast("分句范围已更新，请重新开始。");
    }
  }

  function handleIntervalChange(silent) {
    var value = Number(elements.intervalInput.value);
    elements.intervalValue.textContent = value.toFixed(1) + " 秒";
    player.updateSettings({ repeatInterval: value }, silent ? { silent: true } : undefined);
  }

  function isEditingTarget(target) {
    return Boolean(target && target.tagName && (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.isContentEditable));
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.repeat || event.isComposing || isComposing || isEditingTarget(event.target)) return;
    if (event.key === "ArrowRight") { event.preventDefault(); player.next(); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); player.previous(); }
    else if (event.key === " " || event.code === "Space") { event.preventDefault(); handlePause(); }
    else if (event.key === "Escape") { event.preventDefault(); player.end(); }
  }

  elements.articleInput.addEventListener("input", handleArticleInput);
  elements.articleInput.addEventListener("compositionstart", function () { isComposing = true; });
  elements.articleInput.addEventListener("compositionend", function () { isComposing = false; });
  elements.sampleButton.addEventListener("click", function () {
    elements.articleInput.value = SAMPLE_TEXT;
    handleArticleInput();
    elements.articleInput.focus();
    showToast("示例已填入，可以直接开始朗读。");
  });
  elements.startButton.addEventListener("click", startReading);
  elements.previousButton.addEventListener("click", function () { player.previous(); });
  elements.pauseButton.addEventListener("click", handlePause);
  elements.nextButton.addEventListener("click", function () { player.next(); });
  elements.voiceSelect.addEventListener("change", function () { applyVoice(elements.voiceSelect.value); });
  elements.refreshVoicesButton.addEventListener("click", function () { checkService(true); });
  elements.rateInput.addEventListener("input", function () { handleRateChange(false); });
  elements.minLengthInput.addEventListener("input", previewLengthRange);
  elements.maxLengthInput.addEventListener("input", previewLengthRange);
  elements.minLengthInput.addEventListener("change", function () { handleLengthChange(elements.minLengthInput, false); });
  elements.maxLengthInput.addEventListener("change", function () { handleLengthChange(elements.maxLengthInput, false); });
  elements.intervalInput.addEventListener("input", function () { handleIntervalChange(false); });
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", function () { if (document.hidden) player.pauseForVisibility(); });

  setupVoices();
  updateCharacterCount();
  handleRateChange(true);
  handleLengthChange(null, true);
  handleIntervalChange(true);
  renderCurrent({ index: -1, sentence: "", total: 0 });
  renderState(player.getSnapshot(), { message: "正在连接本机 Kokoro 语音服务。", tone: "default" });
  checkService(false);
})();

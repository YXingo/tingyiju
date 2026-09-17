(function (global) {
  "use strict";

  var STATES = Object.freeze({
    IDLE: "idle",
    SPEAKING: "speaking",
    WAITING: "waiting",
    PAUSED: "paused",
    COMPLETED: "completed",
    ERROR: "error"
  });
  var noop = function () {};

  class SpeechPlayer {
    constructor(options) {
      var config = options || {};
      this.fetchFunction = config.fetchFunction || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
      this.AudioConstructor = config.AudioConstructor || global.Audio || null;
      this.URLApi = config.URLApi || global.URL || null;
      this.AbortControllerConstructor = config.AbortControllerConstructor || global.AbortController || null;
      this.endpoint = config.endpoint || "/api/tts";
      var timeoutFunction = config.setTimeout || global.setTimeout;
      var clearTimeoutFunction = config.clearTimeout || global.clearTimeout;
      this.setTimeout = function (callback, delay) { return timeoutFunction.call(global, callback, delay); };
      this.clearTimeout = function (timerId) { return clearTimeoutFunction.call(global, timerId); };
      this.onStateChange = config.onStateChange || noop;
      this.onCurrentChange = config.onCurrentChange || noop;
      this.sentences = [];
      this.currentIndex = -1;
      this.state = STATES.IDLE;
      this.version = 0;
      this.timer = null;
      this.audio = null;
      this.audioUrl = null;
      this.abortController = null;
      this.settings = { rate: 0.85, repeatInterval: 1, voiceProfile: null };
    }

    isSupported() {
      return Boolean(this.fetchFunction && this.AudioConstructor && this.URLApi && typeof this.URLApi.createObjectURL === "function");
    }

    getSnapshot() {
      return {
        state: this.state,
        currentIndex: this.currentIndex,
        total: this.sentences.length,
        settings: Object.assign({}, this.settings)
      };
    }

    _emitState(message, tone) {
      this.onStateChange(this.getSnapshot(), { message: message || "", tone: tone || "default" });
    }

    _setState(state, message, tone) {
      this.state = state;
      this._emitState(message, tone);
    }

    _emitCurrent() {
      this.onCurrentChange({
        index: this.currentIndex,
        sentence: this.currentIndex >= 0 ? this.sentences[this.currentIndex] || "" : "",
        total: this.sentences.length
      });
    }

    _releaseAudio() {
      if (this.audio) {
        this.audio.onended = null;
        this.audio.onerror = null;
        if (typeof this.audio.pause === "function") this.audio.pause();
        if (typeof this.audio.removeAttribute === "function") this.audio.removeAttribute("src");
        this.audio = null;
      }
      if (this.audioUrl && this.URLApi && typeof this.URLApi.revokeObjectURL === "function") {
        this.URLApi.revokeObjectURL(this.audioUrl);
      }
      this.audioUrl = null;
    }

    _invalidate() {
      this.version += 1;
      if (this.timer !== null) {
        this.clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      this._releaseAudio();
    }

    _scheduleRepeat(version) {
      if (version !== this.version || this.state !== STATES.SPEAKING) return;
      this._setState(STATES.WAITING, "当前句读完了，稍后会再读一遍。", "default");
      this.timer = this.setTimeout(() => {
        if (version !== this.version || this.state !== STATES.WAITING || !this.audio) return;
        this.timer = null;
        this.audio.currentTime = 0;
        this._setState(STATES.SPEAKING, "正在重复当前句。", "default");
        var playResult = this.audio.play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => this._handlePlaybackError(version));
        }
      }, Math.max(0, Number(this.settings.repeatInterval) || 0) * 1000);
    }

    _handlePlaybackError(version) {
      if (version !== this.version) return;
      this._releaseAudio();
      this._setState(STATES.ERROR, "音频没有顺利播放，请点击重试。", "error");
    }

    async _loadAndPlay(version, text) {
      var profile = this.settings.voiceProfile;
      var controller = this.AbortControllerConstructor ? new this.AbortControllerConstructor() : null;
      this.abortController = controller;
      try {
        var response = await this.fetchFunction(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text, voice: profile && profile.voice, speed: this.settings.rate }),
          signal: controller ? controller.signal : undefined
        });
        if (!response.ok) {
          var detail = "";
          try {
            var payload = await response.json();
            detail = payload && payload.error ? "：" + payload.error : "";
          } catch (ignored) {}
          throw new Error("本地语音服务返回错误" + detail);
        }
        var blob = await response.blob();
        if (version !== this.version || this.state !== STATES.SPEAKING) return;

        this.abortController = null;
        this.audioUrl = this.URLApi.createObjectURL(blob);
        var audio = new this.AudioConstructor();
        audio.preload = "auto";
        audio.src = this.audioUrl;
        audio.onended = () => this._scheduleRepeat(version);
        audio.onerror = () => this._handlePlaybackError(version);
        this.audio = audio;
        var playResult = audio.play();
        if (playResult && typeof playResult.catch === "function") await playResult;
      } catch (error) {
        if (version !== this.version || (error && error.name === "AbortError")) return;
        this.abortController = null;
        this._releaseAudio();
        var message = error && String(error.message || "").indexOf("本地语音服务返回错误") === 0
          ? error.message
          : "无法连接本地语音服务，请重新启动听一句后再重试。";
        this._setState(
          STATES.ERROR,
          message,
          "error"
        );
      }
    }

    _speakCurrent() {
      if (!this.isSupported() || this.currentIndex < 0 || this.currentIndex >= this.sentences.length) return false;
      if (!this.settings.voiceProfile || !this.settings.voiceProfile.voice) {
        this._setState(STATES.ERROR, "请先选择一个本地音色。", "error");
        return false;
      }
      var text = this.sentences[this.currentIndex];
      var version = this.version;
      this._setState(STATES.SPEAKING, "正在生成并播放当前句。首次生成会稍慢。", "default");
      this._loadAndPlay(version, text);
      return true;
    }

    start(sentences) {
      if (!this.isSupported()) {
        this._setState(STATES.ERROR, "当前浏览器无法播放本地语音，请使用最新版浏览器。", "error");
        return false;
      }
      var nextSentences = Array.isArray(sentences)
        ? sentences.map(function (sentence) { return String(sentence).trim(); }).filter(Boolean)
        : [];
      if (!nextSentences.length) {
        this._setState(STATES.ERROR, "请先放入一段包含文字的正文。", "error");
        return false;
      }
      this._invalidate();
      this.sentences = nextSentences;
      this.currentIndex = 0;
      this._emitCurrent();
      return this._speakCurrent();
    }

    previous() {
      if (!this.sentences.length || this.currentIndex <= 0) return false;
      this.currentIndex -= 1;
      this._invalidate();
      this._emitCurrent();
      return this._speakCurrent();
    }

    next() {
      if (!this.sentences.length || this.currentIndex < 0) return false;
      if (this.currentIndex >= this.sentences.length - 1) return this.complete();
      this.currentIndex += 1;
      this._invalidate();
      this._emitCurrent();
      return this._speakCurrent();
    }

    pause() {
      if (this.state !== STATES.SPEAKING && this.state !== STATES.WAITING) return false;
      this._invalidate();
      this._setState(STATES.PAUSED, "已暂停。继续时会从当前句句首重新朗读。", "default");
      return true;
    }

    resume() {
      if (this.state !== STATES.PAUSED) return false;
      return this._speakCurrent();
    }

    retry() {
      if (this.state !== STATES.ERROR || !this.isSupported()) return false;
      this._invalidate();
      return this._speakCurrent();
    }

    togglePause() { return this.state === STATES.PAUSED ? this.resume() : this.pause(); }

    complete() {
      if (this.currentIndex < 0 || !this.sentences.length) return false;
      this._invalidate();
      this._setState(STATES.COMPLETED, "已完成。文章仍保留，再次开始会从第一句读起。", "success");
      return true;
    }

    end() {
      this._invalidate();
      this.currentIndex = -1;
      this._emitCurrent();
      this._setState(STATES.IDLE, "朗读已结束，文章仍保留。", "default");
      return true;
    }

    clearForContentChange() {
      this._invalidate();
      this.sentences = [];
      this.currentIndex = -1;
      this._emitCurrent();
      this._setState(STATES.IDLE, "文章已修改，请重新开始。", "default");
      return true;
    }

    updateSettings(nextSettings, options) {
      var next = nextSettings || {};
      var rateChanged = next.rate !== undefined && Number(next.rate) !== this.settings.rate;
      var voiceProfileChanged = next.voiceProfile !== undefined && next.voiceProfile !== this.settings.voiceProfile;
      if (next.rate !== undefined) this.settings.rate = Number(next.rate);
      if (next.repeatInterval !== undefined) this.settings.repeatInterval = Math.max(0, Number(next.repeatInterval) || 0);
      if (next.voiceProfile !== undefined) this.settings.voiceProfile = next.voiceProfile || null;
      if ((rateChanged || voiceProfileChanged) && (this.state === STATES.SPEAKING || this.state === STATES.WAITING)) {
        this._invalidate();
        this._speakCurrent();
      }
      if (!options || !options.silent) this._emitState("设置已更新。", "default");
    }

    pauseForVisibility() {
      if (this.state !== STATES.SPEAKING && this.state !== STATES.WAITING) return false;
      this._invalidate();
      this._setState(STATES.PAUSED, "页面已切到后台，已暂停。回到页面后点击继续。", "default");
      return true;
    }
  }

  global.TingYiJuPlayer = { SpeechPlayer: SpeechPlayer, STATES: STATES };
  if (typeof module !== "undefined" && module.exports) module.exports = global.TingYiJuPlayer;
})(typeof globalThis !== "undefined" ? globalThis : this);

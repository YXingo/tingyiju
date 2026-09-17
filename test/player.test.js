const assert = require("node:assert/strict");
const test = require("node:test");
const { SpeechPlayer, STATES } = require("../player.js");

function createFakeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    runNext() {
      const first = timers.entries().next();
      if (first.done) return;
      const [id, timer] = first.value;
      timers.delete(id);
      timer.callback();
    },
    size() { return timers.size; }
  };
}

function createAudioHarness() {
  const instances = [];
  class FakeAudio {
    constructor() {
      this.src = "";
      this.currentTime = 0;
      this.playCount = 0;
      this.pauseCount = 0;
      this.onended = null;
      this.onerror = null;
      instances.push(this);
    }
    play() {
      this.playCount += 1;
      return Promise.resolve();
    }
    pause() { this.pauseCount += 1; }
    removeAttribute(name) { if (name === "src") this.src = ""; }
    finish() { if (this.onended) this.onended(); }
    fail() { if (this.onerror) this.onerror(); }
  }
  return { AudioConstructor: FakeAudio, instances };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup(fetchOverride) {
  const clock = createFakeClock();
  const audio = createAudioHarness();
  const requests = [];
  const revoked = [];
  const fetchFunction = fetchOverride || (async (url, options) => {
    requests.push({ url, payload: JSON.parse(options.body) });
    return { ok: true, blob: async () => ({ type: "audio/wav" }) };
  });
  const player = new SpeechPlayer({
    fetchFunction,
    AudioConstructor: audio.AudioConstructor,
    URLApi: {
      createObjectURL: () => `blob:test-${audio.instances.length + 1}`,
      revokeObjectURL: (url) => revoked.push(url)
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });
  player.updateSettings({ voiceProfile: { voice: "zf_001" } }, { silent: true });
  return { clock, audio, requests, revoked, player };
}

test("自然读完只等待并重放同一段音频", async () => {
  const { clock, audio, requests, player } = setup();
  player.start(["甲。", "乙。"]);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(audio.instances.length, 1);

  audio.instances[0].finish();
  assert.equal(player.currentIndex, 0);
  assert.equal(player.state, STATES.WAITING);
  assert.equal(clock.size(), 1);

  clock.runNext();
  assert.equal(player.state, STATES.SPEAKING);
  assert.equal(audio.instances[0].playCount, 2);
  assert.equal(requests.length, 1);
});

test("切句后旧音频回调不会复活", async () => {
  const { clock, audio, player } = setup();
  player.start(["甲。", "乙。"]);
  await flush();
  const oldAudio = audio.instances[0];
  player.next();
  await flush();
  assert.equal(player.currentIndex, 1);
  assert.equal(audio.instances.length, 2);
  oldAudio.finish();
  assert.equal(clock.size(), 0);
  assert.equal(player.state, STATES.SPEAKING);
});

test("暂停清除等待，继续时从本机缓存重新请求当前句", async () => {
  const { clock, audio, requests, player } = setup();
  player.start(["甲。"]);
  await flush();
  audio.instances[0].finish();
  player.pause();
  assert.equal(player.state, STATES.PAUSED);
  assert.equal(clock.size(), 0);
  player.resume();
  await flush();
  assert.equal(player.state, STATES.SPEAKING);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].payload.text, "甲。");
});

test("快速连续切句只播放最终句", async () => {
  const { audio, requests, player } = setup();
  player.start(["甲。", "乙。", "丙。", "丁。"]);
  player.next();
  player.next();
  player.next();
  await flush();
  assert.equal(player.currentIndex, 3);
  assert.equal(player.state, STATES.SPEAKING);
  assert.equal(requests.at(-1).payload.text, "丁。");
  assert.equal(audio.instances.length, 1);
});

test("最后一句点击下一句后完成并停止音频", async () => {
  const { audio, player } = setup();
  player.start(["甲。"]);
  await flush();
  player.next();
  assert.equal(player.state, STATES.COMPLETED);
  assert.equal(player.currentIndex, 0);
  assert.equal(audio.instances[0].pauseCount, 1);
});

test("请求包含选定音色与语速，中英混合文本不拆分", async () => {
  const { requests, player } = setup();
  player.updateSettings({
    voiceProfile: { voice: "zm_025" },
    rate: 1.1
  }, { silent: true });
  player.start(["你好，OpenAI。"]);
  await flush();
  assert.deepEqual(requests[0].payload, {
    text: "你好，OpenAI。",
    voice: "zm_025",
    speed: 1.1
  });
});

test("服务端错误进入可重试状态", async () => {
  const { player } = setup(async () => ({
    ok: false,
    json: async () => ({ error: "模型未就绪" })
  }));
  player.start(["甲。"]);
  await flush();
  assert.equal(player.state, STATES.ERROR);
});

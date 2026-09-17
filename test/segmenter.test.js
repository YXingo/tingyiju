const assert = require("node:assert/strict");
const test = require("node:test");
const { splitSentences, splitSpeechRuns } = require("../segmenter.js");

test("按中文和英文句末标点分句，并保留连续标点", () => {
  assert.deepEqual(splitSentences("第一句。第二句！第三句？"), ["第一句。", "第二句！", "第三句？"]);
  assert.deepEqual(splitSentences("真的？！好的。"), ["真的？！", "好的。"]);
});

test("把句末引号和括号留在上一句", () => {
  assert.deepEqual(splitSentences("他说：“请继续。”我点了下一句。"), [
    "他说：“请继续。”",
    "我点了下一句。"
  ]);
});

test("不拆数字中的点，并保留无句号的尾句", () => {
  assert.deepEqual(splitSentences("数值为3.14。下一项"), ["数值为3.14。", "下一项"]);
});

test("每个非空换行都是边界，并跳过空白和纯标点片段", () => {
  assert.deepEqual(splitSentences("  第一行\n\n！！！\n第二行  "), ["第一行", "第二行"]);
  assert.deepEqual(splitSentences("   ……？！  "), []);
});

test("逗号、顿号、分号和冒号不默认拆句", () => {
  assert.deepEqual(splitSentences("认真学习，积极实践；不断进步。"), ["认真学习，积极实践；不断进步。"]);
});

test("启用长度范围后优先使用自然停顿，并保持原文不变", () => {
  const text = "这是一个很长的句子，里面包含很多需要抄写的内容，而且我们希望它能够自然地分成长度相近的几个部分，避免等待太久。";
  const parts = splitSentences(text, { minLength: 10, maxLength: 18 });
  const lengths = parts.map((part) => Array.from(part).length);

  assert.equal(parts.join(""), text);
  assert.ok(parts[0].endsWith("，"));
  assert.ok(parts[1].endsWith("，"));
  assert.ok(lengths.every((length) => length <= 18));
  assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 6);
});

test("没有标点时也会均衡分段，并严格遵守最长上限", () => {
  const text = "甲".repeat(40) + "。";
  const parts = splitSentences(text, { minLength: 10, maxLength: 18 });
  const lengths = parts.map((part) => Array.from(part).length);

  assert.equal(parts.join(""), text);
  assert.ok(lengths.every((length) => length <= 18));
  assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1);
});

test("自适应分段避免切断中文词和英文单词", () => {
  const text = "我们希望它能够自然地分成长度相近的部分，并保留 English words 的完整边界。";
  const parts = splitSentences(text, { minLength: 8, maxLength: 14 });

  assert.equal(parts.join(""), text);
  parts.slice(0, -1).forEach((part, index) => {
    const previous = Array.from(part).at(-1);
    const next = Array.from(parts[index + 1])[0];
    assert.equal(/[A-Za-z0-9]/.test(previous) && /[A-Za-z0-9]/.test(next), false);
  });
  assert.equal(parts.some((part, index) => part.endsWith("长") && parts[index + 1]?.startsWith("度")), false);
});

test("最短与最长无法同时满足时，优先保证最长上限和长度均衡", () => {
  const text = "乙".repeat(19);
  const parts = splitSentences(text, { minLength: 10, maxLength: 10 });
  const lengths = parts.map((part) => Array.from(part).length);

  assert.deepEqual(lengths.sort((a, b) => a - b), [9, 10]);
  assert.equal(parts.join(""), text);
});

test("中英混杂时按文字切换朗读语言，数字留在当前语言", () => {
  assert.deepEqual(splitSpeechRuns("请打开 ChatGPT，然后输入 AI2.0。"), [
    { text: "请打开 ", lang: "zh" },
    { text: "ChatGPT，", lang: "en" },
    { text: "然后输入 ", lang: "zh" },
    { text: "AI2.0。", lang: "en" }
  ]);
});

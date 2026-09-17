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

test("中英混杂时按文字切换朗读语言，数字留在当前语言", () => {
  assert.deepEqual(splitSpeechRuns("请打开 ChatGPT，然后输入 AI2.0。"), [
    { text: "请打开 ", lang: "zh" },
    { text: "ChatGPT，", lang: "en" },
    { text: "然后输入 ", lang: "zh" },
    { text: "AI2.0。", lang: "en" }
  ]);
});

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createReadingPlan,
  splitSemanticClauses,
  splitSentences,
  splitSpeechRuns
} = require("../segmenter.js");

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

test("语义短句只在强弱标点处切分，并保持原文不变", () => {
  const text = "这是一个很长的句子，里面包含很多需要抄写的内容，而且我们希望它能够自然地分成长度相近的几个部分，避免等待太久。";
  const clauses = splitSemanticClauses(text, { minLength: 10, maxLength: 18 });

  assert.equal(clauses.map((clause) => clause.text).join(""), text);
  assert.deepEqual(clauses.map((clause) => clause.boundary), ["soft", "soft", "soft", "sentence"]);
});

test("逐段模式合并相邻短句，但不跨越分号和自然句", () => {
  const text = "先观察，再记录；然后核对，再提交。下一句很短。";
  const plan = createReadingPlan(text, { minLength: 8, maxLength: 14, mode: "segment" });

  assert.deepEqual(plan.map((item) => item.text), ["先观察，再记录；", "然后核对，再提交。", "下一句很短。"]);
  assert.equal(plan.map((item) => item.text).join(""), text);
});

test("目标长度是软约束，普通语义短句不会为了达标被硬切", () => {
  const text = "这是一个完整而且超过期望最长字数的语义短句，下一条很短。";
  const clauses = splitSemanticClauses(text, { minLength: 8, maxLength: 14 });

  assert.ok(Array.from(clauses[0].text).length > 14);
  assert.equal(clauses[0].boundary, "soft");
  assert.equal(clauses.map((clause) => clause.text).join(""), text);
});

test("极长且没有常规停顿的短句才启用顿号或词边界备用切分", () => {
  const listText = "苹果、香蕉、橘子、葡萄、桃子、梨子、草莓、蓝莓、樱桃、柚子都需要逐项登记。";
  const listClauses = splitSemanticClauses(listText, { minLength: 10, maxLength: 18 });
  const plainText = "我们希望它能够自然地分成长度相近的部分同时保留完整的英文单词 EnglishBoundary 并避免不必要的停顿。";
  const plainClauses = splitSemanticClauses(plainText, { minLength: 8, maxLength: 14 });

  assert.ok(listClauses.length > 1);
  assert.ok(listClauses[0].text.endsWith("、"));
  assert.equal(listClauses.map((clause) => clause.text).join(""), listText);
  assert.equal(plainClauses.map((clause) => clause.text).join(""), plainText);
  plainClauses.slice(0, -1).forEach((clause, index) => {
    const next = plainClauses[index + 1];
    assert.equal(/[A-Za-z0-9]$/.test(clause.text) && /^[A-Za-z0-9]/.test(next.text), false);
  });
});

test("跟写模式按完整短句滑动，并在新自然句重置重叠", () => {
  const text = "坚持理论联系实际，把学习成果转化为行动，把责任落实到具体工作中。新的一句，从这里开始。";
  const plan = createReadingPlan(text, { minLength: 8, maxLength: 18, mode: "follow" });

  assert.deepEqual(plan.map((item) => item.text), [
    "坚持理论联系实际，把学习成果转化为行动，",
    "把学习成果转化为行动，把责任落实到具体工作中。",
    "新的一句，从这里开始。"
  ]);
  assert.equal(plan[0].overlapText, "坚持理论联系实际，");
  assert.equal(plan[0].newText, "把学习成果转化为行动，");
  assert.equal(plan[2].overlapText, "新的一句，");
  assert.equal(plan[2].newText, "从这里开始。");
});

test("中英混杂时按文字切换朗读语言，数字留在当前语言", () => {
  assert.deepEqual(splitSpeechRuns("请打开 ChatGPT，然后输入 AI2.0。"), [
    { text: "请打开 ", lang: "zh" },
    { text: "ChatGPT，", lang: "en" },
    { text: "然后输入 ", lang: "zh" },
    { text: "AI2.0。", lang: "en" }
  ]);
});

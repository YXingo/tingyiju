(function (global) {
  "use strict";

  var SENTENCE_END = /[。！？!?]/;
  var SENTENCE_END_RUN = /[。！？!?]/;
  var STRONG_END = /[；;]/;
  var SOFT_END = /[，,：:]/;
  var WEAK_END = /[、]/;
  var CLOSING_MARK = /[”’」』〕〉》】）］｝〗〙〛"'\)\]\}>＞]/;
  var HAS_WORD = /[\p{L}\p{N}]/u;
  var ENGLISH_LETTER = /[A-Za-z]/;
  var ASCII_DIGIT = /[0-9]/;
  var ASCII_WORD = /[A-Za-z0-9]/;
  var OPENING_MARK = /[“‘「『〔〈《【（［｛"'\(\[\{<＜]/;
  var WHITESPACE = /\s/;

  function textLength(text) {
    return Array.from(text).length;
  }

  function isMeaningful(text) {
    return HAS_WORD.test(text);
  }

  function pushIfMeaningful(result, buffer) {
    var sentence = buffer.trim();
    if (sentence && isMeaningful(sentence)) result.push(sentence);
  }

  function splitNaturalSentences(input) {
    if (typeof input !== "string" || !input.trim()) return [];
    var text = input.replace(/\r\n?/g, "\n");
    var result = [];
    var buffer = "";

    for (var index = 0; index < text.length; index += 1) {
      var character = text[index];
      if (character === "\n") {
        pushIfMeaningful(result, buffer);
        buffer = "";
        continue;
      }
      buffer += character;
      if (SENTENCE_END.test(character)) {
        while (index + 1 < text.length && SENTENCE_END_RUN.test(text[index + 1])) {
          index += 1;
          buffer += text[index];
        }
        while (index + 1 < text.length && CLOSING_MARK.test(text[index + 1])) {
          index += 1;
          buffer += text[index];
        }
        pushIfMeaningful(result, buffer);
        buffer = "";
      }
    }
    pushIfMeaningful(result, buffer);
    return result;
  }

  function normalizeLengthOptions(options) {
    if (!options || options.minLength === undefined || options.maxLength === undefined) return null;
    var minLength = Math.round(Number(options.minLength));
    var maxLength = Math.round(Number(options.maxLength));
    if (!Number.isFinite(minLength) || !Number.isFinite(maxLength)) return null;
    minLength = Math.max(1, minLength);
    maxLength = Math.max(minLength, maxLength);
    return { minLength: minLength, maxLength: maxLength };
  }

  function collectWordBoundaries(text) {
    var boundaries = new Set();
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return boundaries;
    try {
      var segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
      Array.from(segmenter.segment(text)).forEach(function (segment) {
        if (!segment.isWordLike) return;
        boundaries.add(textLength(text.slice(0, segment.index + segment.segment.length)));
      });
    } catch (ignored) {}
    return boundaries;
  }

  function fallbackBoundaryPenalty(characters, end, wordBoundaries) {
    if (end >= characters.length) return 0;
    var previous = characters[end - 1] || "";
    var next = characters[end] || "";
    if (WEAK_END.test(previous)) return 0;
    if (WHITESPACE.test(previous) || WHITESPACE.test(next)) return 4;
    if (ASCII_WORD.test(previous) && ASCII_WORD.test(next)) return 1000;
    if (WEAK_END.test(next) || OPENING_MARK.test(previous)) return 500;
    if (wordBoundaries.has(end)) return 20;
    return 60;
  }

  function splitExtremeClause(text, options) {
    var characters = Array.from(text);
    var totalLength = characters.length;
    var partCount = Math.max(2, Math.round(totalLength / options.maxLength));
    var targetLength = totalLength / partCount;
    var wordBoundaries = collectWordBoundaries(text);
    var infinity = Number.POSITIVE_INFINITY;
    var costs = Array.from({ length: partCount + 1 }, function () {
      return Array(totalLength + 1).fill(infinity);
    });
    var previousCuts = Array.from({ length: partCount + 1 }, function () {
      return Array(totalLength + 1).fill(-1);
    });
    costs[0][0] = 0;

    for (var part = 1; part <= partCount; part += 1) {
      for (var end = part; end <= totalLength; end += 1) {
        for (var start = part - 1; start < end; start += 1) {
          if (!Number.isFinite(costs[part - 1][start])) continue;
          if (totalLength - end < partCount - part) continue;
          var length = end - start;
          var balanceCost = Math.pow(length - targetLength, 2);
          var boundaryCost = end < totalLength ? fallbackBoundaryPenalty(characters, end, wordBoundaries) : 0;
          var candidate = costs[part - 1][start] + balanceCost + boundaryCost;
          if (candidate < costs[part][end]) {
            costs[part][end] = candidate;
            previousCuts[part][end] = start;
          }
        }
      }
    }

    var cuts = [totalLength];
    var currentEnd = totalLength;
    for (var currentPart = partCount; currentPart > 0; currentPart -= 1) {
      currentEnd = previousCuts[currentPart][currentEnd];
      if (currentEnd < 0) return [text];
      cuts.push(currentEnd);
    }
    cuts.reverse();
    return cuts.slice(0, -1).map(function (start, index) {
      return characters.slice(start, cuts[index + 1]).join("");
    }).filter(isMeaningful);
  }

  function isNumericPunctuation(text, index) {
    return ASCII_DIGIT.test(text[index - 1] || "") && ASCII_DIGIT.test(text[index + 1] || "");
  }

  function splitClauseCandidates(sentence) {
    var result = [];
    var buffer = "";

    function emit(boundary) {
      var text = buffer;
      buffer = "";
      if (text && isMeaningful(text)) result.push({ text: text, boundary: boundary });
    }

    for (var index = 0; index < sentence.length; index += 1) {
      var character = sentence[index];
      buffer += character;
      var boundary = null;
      if (SENTENCE_END.test(character)) boundary = "sentence";
      else if (STRONG_END.test(character)) boundary = "strong";
      else if (SOFT_END.test(character) && !isNumericPunctuation(sentence, index)) boundary = "soft";
      if (!boundary) continue;
      while (index + 1 < sentence.length && CLOSING_MARK.test(sentence[index + 1])) {
        index += 1;
        buffer += sentence[index];
      }
      emit(boundary);
    }
    if (buffer && isMeaningful(buffer)) emit("tail");
    return result;
  }

  function expandExtremeCandidates(candidates, options, sentenceIndex) {
    var extremeLength = Math.max(options.maxLength * 2, options.maxLength + 12);
    var result = [];
    candidates.forEach(function (candidate) {
      if (textLength(candidate.text) <= extremeLength) {
        result.push({ text: candidate.text, boundary: candidate.boundary, sentenceIndex: sentenceIndex });
        return;
      }
      var chunks = splitExtremeClause(candidate.text, options);
      chunks.forEach(function (chunk, index) {
        result.push({
          text: chunk,
          boundary: index === chunks.length - 1 ? candidate.boundary : "fallback",
          sentenceIndex: sentenceIndex
        });
      });
    });
    return result;
  }

  function splitSemanticClauses(input, options) {
    var normalized = normalizeLengthOptions(options) || { minLength: 10, maxLength: 18 };
    return splitNaturalSentences(input).reduce(function (result, sentence, sentenceIndex) {
      return result.concat(expandExtremeCandidates(splitClauseCandidates(sentence), normalized, sentenceIndex));
    }, []);
  }

  function segmentCost(length, options) {
    var target = (options.minLength + options.maxLength) / 2;
    if (length < options.minLength) return Math.pow(options.minLength - length, 2) * 4 + 8;
    if (length > options.maxLength) return Math.pow(length - options.maxLength, 2) * 6 + 8;
    return Math.pow(length - target, 2) * 0.12 + 1;
  }

  function groupClauseSection(clauses, options) {
    if (!clauses.length) return [];
    var count = clauses.length;
    var costs = Array(count + 1).fill(Number.POSITIVE_INFINITY);
    var previous = Array(count + 1).fill(-1);
    costs[0] = 0;
    for (var end = 1; end <= count; end += 1) {
      var length = 0;
      for (var start = end - 1; start >= 0; start -= 1) {
        length += textLength(clauses[start].text);
        var candidate = costs[start] + segmentCost(length, options);
        if (candidate < costs[end]) {
          costs[end] = candidate;
          previous[end] = start;
        }
      }
    }
    var ranges = [];
    var cursor = count;
    while (cursor > 0) {
      var start = previous[cursor];
      if (start < 0) return clauses.map(function (clause) { return [clause]; });
      ranges.push([start, cursor]);
      cursor = start;
    }
    ranges.reverse();
    return ranges.map(function (range) { return clauses.slice(range[0], range[1]); });
  }

  function makePlanItem(clauses, overlapCount) {
    var overlap = clauses.slice(0, overlapCount).map(function (clause) { return clause.text; }).join("");
    var fresh = clauses.slice(overlapCount).map(function (clause) { return clause.text; }).join("");
    return {
      text: overlap + fresh,
      overlapText: overlap,
      newText: fresh,
      sentenceIndex: clauses[0].sentenceIndex,
      clauseCount: clauses.length
    };
  }

  function buildSegmentPlan(clauses, options) {
    var plan = [];
    var section = [];
    function flush() {
      groupClauseSection(section, options).forEach(function (group) { plan.push(makePlanItem(group, 0)); });
      section = [];
    }
    clauses.forEach(function (clause, index) {
      if (section.length && clause.sentenceIndex !== section[0].sentenceIndex) flush();
      section.push(clause);
      if (clause.boundary === "strong" || clause.boundary === "sentence" || index === clauses.length - 1) flush();
    });
    return plan;
  }

  function buildFollowPlan(clauses) {
    var plan = [];
    var sentenceClauses = [];
    function flush() {
      if (!sentenceClauses.length) return;
      if (sentenceClauses.length === 1) plan.push(makePlanItem(sentenceClauses, 0));
      else {
        for (var index = 1; index < sentenceClauses.length; index += 1) {
          plan.push(makePlanItem(sentenceClauses.slice(index - 1, index + 1), 1));
        }
      }
      sentenceClauses = [];
    }
    clauses.forEach(function (clause, index) {
      if (sentenceClauses.length && clause.sentenceIndex !== sentenceClauses[0].sentenceIndex) flush();
      sentenceClauses.push(clause);
      if (index === clauses.length - 1) flush();
    });
    return plan;
  }

  function createReadingPlan(input, options) {
    var normalized = normalizeLengthOptions(options) || { minLength: 10, maxLength: 18 };
    var clauses = splitSemanticClauses(input, normalized);
    if (options && options.mode === "follow") return buildFollowPlan(clauses);
    return buildSegmentPlan(clauses, normalized);
  }

  function splitSentences(input, options) {
    if (!normalizeLengthOptions(options)) return splitNaturalSentences(input);
    return createReadingPlan(input, options).map(function (item) { return item.text; });
  }

  function pushSpeechRun(result, buffer, language) {
    if (buffer) result.push({ text: buffer, lang: language });
  }

  function splitSpeechRuns(input) {
    if (typeof input !== "string" || !input) return [];
    var result = [];
    var buffer = "";
    var language = "zh";
    for (var index = 0; index < input.length; index += 1) {
      var character = input[index];
      var nextLanguage = language;
      if (ENGLISH_LETTER.test(character)) nextLanguage = "en";
      else if (HAS_WORD.test(character) && !ASCII_DIGIT.test(character)) nextLanguage = "zh";
      if (nextLanguage !== language && buffer) {
        pushSpeechRun(result, buffer, language);
        buffer = "";
      }
      language = nextLanguage;
      buffer += character;
    }
    pushSpeechRun(result, buffer, language);
    return result;
  }

  var api = {
    splitNaturalSentences: splitNaturalSentences,
    splitSemanticClauses: splitSemanticClauses,
    createReadingPlan: createReadingPlan,
    splitSentences: splitSentences,
    splitSpeechRuns: splitSpeechRuns
  };
  global.TingYiJuSegmenter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

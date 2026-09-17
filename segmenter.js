(function (global) {
  "use strict";

  var SENTENCE_END = /[。！？!?]/;
  var SENTENCE_END_RUN = /[。！？!?]/;
  var CLOSING_MARK = /[”’」』〕〉》】）］｝〉》〗〙〛"'\)\]\}>＞]/;
  var HAS_WORD = /[\p{L}\p{N}]/u;
  var ENGLISH_LETTER = /[A-Za-z]/;
  var ASCII_DIGIT = /[0-9]/;
  var ASCII_WORD = /[A-Za-z0-9]/;
  var SOFT_END = /[，,；;：:、]/;
  var OPENING_MARK = /[“‘「『〔〈《【（［｛\"'\(\[\{<＜]/;
  var WHITESPACE = /\s/;

  function isMeaningful(text) {
    return HAS_WORD.test(text);
  }

  function pushIfMeaningful(result, buffer) {
    var sentence = buffer.trim();
    if (sentence && isMeaningful(sentence)) {
      result.push(sentence);
    }
  }

  function splitNaturalSentences(input) {
    if (typeof input !== "string" || !input.trim()) {
      return [];
    }

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
    if (!options || options.minLength === undefined || options.maxLength === undefined) {
      return null;
    }
    var minLength = Math.round(Number(options.minLength));
    var maxLength = Math.round(Number(options.maxLength));
    if (!Number.isFinite(minLength) || !Number.isFinite(maxLength)) {
      return null;
    }
    minLength = Math.max(1, minLength);
    maxLength = Math.max(minLength, maxLength);
    return { minLength: minLength, maxLength: maxLength };
  }

  function collectWordBoundaries(text) {
    var boundaries = new Set();
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
      return boundaries;
    }
    try {
      var segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
      Array.from(segmenter.segment(text)).forEach(function (segment) {
        if (!segment.isWordLike) {
          return;
        }
        var endInCodeUnits = segment.index + segment.segment.length;
        boundaries.add(Array.from(text.slice(0, endInCodeUnits)).length);
      });
    } catch (ignored) {}
    return boundaries;
  }

  function boundaryPenalty(characters, end, wordBoundaries) {
    if (end >= characters.length) {
      return 0;
    }

    var previous = characters[end - 1] || "";
    var next = characters[end] || "";
    var semanticPrevious = previous;
    var cursor = end - 1;
    while (cursor >= 0 && CLOSING_MARK.test(characters[cursor])) {
      cursor -= 1;
      semanticPrevious = characters[cursor] || semanticPrevious;
    }

    if (SOFT_END.test(semanticPrevious)) {
      return 0;
    }
    if (WHITESPACE.test(previous) || WHITESPACE.test(next)) {
      return 3;
    }
    if (ASCII_WORD.test(previous) && ASCII_WORD.test(next)) {
      return 1000;
    }
    if (SOFT_END.test(next) || OPENING_MARK.test(previous)) {
      return 500;
    }
    if (wordBoundaries.has(end)) {
      return 22;
    }
    return 50;
  }

  function splitLongSentence(sentence, options) {
    var characters = Array.from(sentence.trim());
    var totalLength = characters.length;
    if (totalLength <= options.maxLength) {
      return [sentence.trim()];
    }

    var partCount = Math.ceil(totalLength / options.maxLength);
    var targetLength = totalLength / partCount;
    var wordBoundaries = collectWordBoundaries(characters.join(""));
    var infinity = Number.POSITIVE_INFINITY;
    var costs = Array.from({ length: partCount + 1 }, function () {
      return Array(totalLength + 1).fill(infinity);
    });
    var previousCuts = Array.from({ length: partCount + 1 }, function () {
      return Array(totalLength + 1).fill(-1);
    });
    costs[0][0] = 0;

    for (var part = 1; part <= partCount; part += 1) {
      var earliestEnd = part;
      var latestEnd = Math.min(totalLength, part * options.maxLength);
      for (var end = earliestEnd; end <= latestEnd; end += 1) {
        var earliestStart = Math.max(part - 1, end - options.maxLength);
        for (var start = earliestStart; start < end; start += 1) {
          if (!Number.isFinite(costs[part - 1][start])) {
            continue;
          }
          var remainingCharacters = totalLength - end;
          var remainingParts = partCount - part;
          if (remainingCharacters < remainingParts || remainingCharacters > remainingParts * options.maxLength) {
            continue;
          }

          var length = end - start;
          var balanceCost = Math.pow(length - targetLength, 2);
          var shortfall = Math.max(0, options.minLength - length);
          var shortfallCost = Math.pow(shortfall, 2) * 6;
          var cutCost = end < totalLength ? boundaryPenalty(characters, end, wordBoundaries) : 0;
          var candidateCost = costs[part - 1][start] + balanceCost + shortfallCost + cutCost;
          if (candidateCost < costs[part][end]) {
            costs[part][end] = candidateCost;
            previousCuts[part][end] = start;
          }
        }
      }
    }

    var cuts = [totalLength];
    var currentEnd = totalLength;
    for (var currentPart = partCount; currentPart > 0; currentPart -= 1) {
      currentEnd = previousCuts[currentPart][currentEnd];
      if (currentEnd < 0) {
        return [sentence.trim()];
      }
      cuts.push(currentEnd);
    }
    cuts.reverse();

    var result = [];
    for (var index = 0; index < cuts.length - 1; index += 1) {
      var chunk = characters.slice(cuts[index], cuts[index + 1]).join("");
      if (chunk && isMeaningful(chunk)) {
        result.push(chunk);
      }
    }
    return result;
  }

  function splitSentences(input, options) {
    var naturalSentences = splitNaturalSentences(input);
    var normalizedOptions = normalizeLengthOptions(options);
    if (!normalizedOptions) {
      return naturalSentences;
    }
    return naturalSentences.reduce(function (result, sentence) {
      return result.concat(splitLongSentence(sentence, normalizedOptions));
    }, []);
  }

  function pushSpeechRun(result, buffer, language) {
    if (buffer) {
      result.push({ text: buffer, lang: language });
    }
  }

  function splitSpeechRuns(input) {
    if (typeof input !== "string" || !input) {
      return [];
    }

    var result = [];
    var buffer = "";
    var language = "zh";

    for (var index = 0; index < input.length; index += 1) {
      var character = input[index];
      var nextLanguage = language;

      if (ENGLISH_LETTER.test(character)) {
        nextLanguage = "en";
      } else if (HAS_WORD.test(character) && !ASCII_DIGIT.test(character)) {
        nextLanguage = "zh";
      }

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
    splitSentences: splitSentences,
    splitSpeechRuns: splitSpeechRuns
  };
  global.TingYiJuSegmenter = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

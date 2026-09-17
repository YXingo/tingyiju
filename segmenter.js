(function (global) {
  "use strict";

  var SENTENCE_END = /[。！？!?]/;
  var SENTENCE_END_RUN = /[。！？!?]/;
  var CLOSING_MARK = /[”’」』〕〉》】）］｝〉》〗〙〛"'\)\]\}>＞]/;
  var HAS_WORD = /[\p{L}\p{N}]/u;
  var ENGLISH_LETTER = /[A-Za-z]/;
  var ASCII_DIGIT = /[0-9]/;

  function isMeaningful(text) {
    return HAS_WORD.test(text);
  }

  function pushIfMeaningful(result, buffer) {
    var sentence = buffer.trim();
    if (sentence && isMeaningful(sentence)) {
      result.push(sentence);
    }
  }

  function splitSentences(input) {
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

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import server


class RequestValidationTests(unittest.TestCase):
    def test_normalizes_valid_request(self):
        self.assertEqual(
            server.normalize_request({"text": " 你好。 ", "voice": "zf_001", "speed": 0.854}),
            ("你好。", "zf_001", 0.85),
        )

    def test_rejects_unknown_voice(self):
        with self.assertRaisesRegex(ValueError, "音色"):
            server.normalize_request({"text": "你好。", "voice": "unknown", "speed": 1})

    def test_rejects_out_of_range_speed(self):
        with self.assertRaisesRegex(ValueError, "0.5"):
            server.normalize_request({"text": "你好。", "voice": "zf_001", "speed": 2})

    def test_rejects_empty_text(self):
        with self.assertRaisesRegex(ValueError, "不能为空"):
            server.normalize_request({"text": "  ", "voice": "zf_001", "speed": 1})


class CacheKeyTests(unittest.TestCase):
    def test_same_input_has_same_cache_path(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(server, "CACHE_DIR", Path(directory)):
                left = server.audio_cache_path("你好。", "zf_001", 0.85)
                right = server.audio_cache_path("你好。", "zf_001", 0.85)
                self.assertEqual(left, right)

    def test_voice_and_speed_change_cache_path(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(server, "CACHE_DIR", Path(directory)):
                base = server.audio_cache_path("你好。", "zf_001", 0.85)
                self.assertNotEqual(base, server.audio_cache_path("你好。", "zf_004", 0.85))
                self.assertNotEqual(base, server.audio_cache_path("你好。", "zf_001", 1.0))


class LocalServerTests(unittest.TestCase):
    def test_binding_does_not_wait_for_reverse_dns(self):
        with mock.patch("socket.getfqdn", side_effect=AssertionError("不应调用反向 DNS")):
            http_server = server.LocalThreadingHTTPServer((server.HOST, 0), server.TingYiJuHandler)
            http_server.server_close()


if __name__ == "__main__":
    unittest.main()
